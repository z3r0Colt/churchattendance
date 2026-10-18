import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  afterCondition,
  hasRole,
  mercyOpen,
  occurrenceForYear,
  roleSchema,
  workflowStepSchema,
  workflowTriggerSchema,
  type ImportantDate,
  type MercyStatus,
  type Role,
  type RunHistory,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowTrigger,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { getChurchZone, queueMessage } from "../communications/queue.js";
import { protectRecord } from "../security/encryption.js";

type Subject = WorkflowRun["subject"];
const emptySubject: Subject = {
  personId: "",
  householdId: "",
  requestId: "",
  dateId: "",
  occurrence: "",
};
export class StepBlocked extends Error {}
const history = (
  step: Pick<WorkflowStep, "id" | "kind"> | { id: string; kind: "control" },
  outcome: string,
  detail: string,
  by = "system",
): RunHistory => ({
  stepId: step.id,
  kind: step.kind,
  outcome,
  detail,
  at: new Date().toISOString(),
  by,
});
export async function loadVersion(workflowId: string, version: number) {
  const row = await db.doc(`workflowVersions/${workflowId}_v${version}`).get();
  if (!row.exists) throw new StepBlocked("The workflow version is missing.");
  return {
    trigger: workflowTriggerSchema.parse(row.get("trigger")),
    steps: workflowStepSchema.array().parse(row.get("steps")),
  };
}

// Run IDs come from the workflow and the subject, so a repeated trigger finds the run already there.
async function createRun(
  workflowId: string,
  version: number,
  subjectKey: string,
  subject: Partial<Subject>,
  startedBy: string,
  now: Date,
) {
  const ref = db.doc(`workflowRuns/${workflowId}_${subjectKey}`);
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return;
    transaction.create(ref, {
      workflowId,
      version,
      subject: { ...emptySubject, ...subject },
      status: "active",
      stepIndex: 0,
      nextAt: Timestamp.fromDate(now),
      startedAt: Timestamp.fromDate(now),
      startedBy,
      waitingFor: null,
      error: "",
      history: [],
      lease: null,
      revision: 1,
      updatedAt: Timestamp.fromDate(now),
    });
  });
}
async function activeVersions() {
  const workflows = await db
    .collection("workflows")
    .where("status", "==", "active")
    .get();
  const rows = [];
  for (const workflow of workflows.docs) {
    const version = Number(workflow.get("publishedVersion") || 0);
    const published = version
      ? await loadVersion(workflow.id, version).catch(() => null)
      : null;
    if (published) rows.push({ id: workflow.id, version, ...published });
  }
  return rows;
}
export async function startRuns(
  matches: (trigger: WorkflowTrigger) => boolean,
  subjectKey: string,
  subject: Partial<Subject>,
  startedBy: string,
  now = new Date(),
) {
  for (const workflow of await activeVersions())
    if (matches(workflow.trigger))
      await createRun(
        workflow.id,
        workflow.version,
        subjectKey,
        subject,
        startedBy,
        now,
      );
}

// Important-date runs begin on exactly the day that is daysBefore the occurrence. Missed days never catch up.
export async function startDateRuns(now: Date) {
  const zone = await getChurchZone();
  const today = DateTime.fromJSDate(now, { zone }).startOf("day");
  for (const workflow of await activeVersions()) {
    const trigger = workflow.trigger;
    if (trigger.kind !== "importantDate") continue;
    const target = today.plus({ days: trigger.daysBefore });
    const dates = await db.collection(trigger.source).get();
    for (const row of dates.docs) {
      const record = row.data() as ImportantDate;
      if (trigger.dateKinds.length && !trigger.dateKinds.includes(record.kind))
        continue;
      const occurrence = occurrenceForYear(record, target.year);
      if (occurrence?.date !== target.toISODate()) continue;
      const person = await db.doc(`people/${record.personId}`).get();
      if (!person.exists || person.get("isDeceased")) continue;
      await createRun(
        workflow.id,
        workflow.version,
        `${row.id}_${occurrence.date}`,
        {
          personId: record.personId,
          householdId: person.get("householdId") || "",
          dateId: row.id,
          occurrence: occurrence.date,
        },
        "system",
        now,
      );
    }
  }
}

async function liveRoles(uid: string) {
  const user = await getAuth()
    .getUser(uid)
    .catch(() => null);
  return user && !user.disabled
    ? roleSchema.array().catch([]).parse(user.customClaims?.roles)
    : ([] as Role[]);
}
// Assignees are resolved and their live role checked at the moment the task is created.
async function assignee(
  step: Extract<WorkflowStep, { kind: "task" }>,
  subject: Subject,
) {
  if (step.assignTo === "account") {
    const roles = await liveRoles(step.uid);
    if (!hasRole(roles, [...SESSION_ROLES, "deacon"]))
      throw new StepBlocked(
        "The chosen officer no longer has an active church role.",
      );
    return { uid: step.uid, session: hasRole(roles, SESSION_ROLES) };
  }
  if (step.assignTo === "requestDeacons") {
    const request = await db.doc(`mercyRequests/${subject.requestId}`).get();
    for (const uid of (request.get("deaconUids") || []) as string[])
      if ((await liveRoles(uid)).includes("deacon"))
        return { uid, session: false };
    throw new StepBlocked("The request has no deacon with an active role.");
  }
  const person = await db.doc(`people/${subject.personId}`).get();
  const district = person.get("elderDistrictId")
    ? await db.doc(`elderDistricts/${person.get("elderDistrictId")}`).get()
    : null;
  const elder = district?.get("elderPersonId") as string | undefined;
  if (elder) {
    const users = await db
      .collection("users")
      .where("personId", "==", elder)
      .get();
    for (const user of users.docs)
      if (hasRole(await liveRoles(user.id), SESSION_ROLES))
        return { uid: user.id, session: true };
  }
  throw new StepBlocked(
    "The person has no elder district with a linked elder account.",
  );
}
async function taskStep(
  run: DocumentReference,
  step: Extract<WorkflowStep, { kind: "task" }>,
  subject: Subject,
  zone: string,
  now: Date,
) {
  const target = await assignee(step, subject);
  const dueDate = DateTime.fromJSDate(now, { zone })
    .plus({ days: step.dueInDays })
    .toISODate()!;
  const id = `wf_${run.id}_${step.id}`;
  let collection = target.session ? "followUps" : "diaconalTasks";
  let data: Record<string, unknown> = {
    personId: subject.personId,
    title: step.title,
    assignedToUid: target.uid,
    dueDate,
    done: false,
  };
  if (!target.session && subject.requestId) {
    const request = await db.doc(`mercyRequests/${subject.requestId}`).get();
    if (mercyOpen(request.get("status") as MercyStatus)) {
      collection = "mercyTasks";
      data = {
        requestId: subject.requestId,
        householdId: request.get("householdId"),
        title: step.title,
        assignedToUid: target.uid,
        dueDate,
        done: false,
      };
    }
  }
  if (!data.personId && collection !== "mercyTasks")
    throw new StepBlocked("This task needs a person on the roll.");
  const ref = db.doc(`${collection}/${id}`);
  // The task ID follows the run and step, so a retried step finds its task rather than adding one.
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return;
    transaction.create(
      ref,
      protectRecord(collection, ref.path, {
        ...data,
        revision: 1,
        createdAt: Timestamp.fromDate(now),
        authorUid: "workflow",
        updatedBy: "workflow",
        updatedAt: Timestamp.fromDate(now),
      }),
    );
  });
  return { path: ref.path, uid: target.uid };
}
async function conditionPassed(
  step: Extract<WorkflowStep, { kind: "condition" }>,
  subject: Subject,
  startedOn: string,
) {
  const person = subject.personId
    ? await db.doc(`people/${subject.personId}`).get()
    : null;
  switch (step.test) {
    case "stillVisitor":
      return person?.get("membershipStatus") === "visitor";
    case "hasEmailConsent":
      return person?.get("emailOptIn") === true && !!person.get("email");
    case "hasSmsConsent":
      return person?.get("smsOptIn") === true && !!person.get("mobilePhone");
    case "requestOpen":
      return mercyOpen(
        (await db.doc(`mercyRequests/${subject.requestId}`).get()).get(
          "status",
        ) as MercyStatus,
      );
    case "attendedSinceStart":
    case "notAttendedSinceStart": {
      const services = await db
        .collection("services")
        .where("date", ">=", startedOn)
        .get();
      const attended = services.docs.some(
        (row) => !!row.get(`present.${subject.personId}`),
      );
      return step.test === "attendedSinceStart" ? attended : !attended;
    }
  }
}

// Claims one due run with a short lease, then performs exactly its current step.
// Returns whether the run is still active and due, so immediate steps continue in the same tick.
async function processRun(id: string, now: Date, zone: string) {
  const ref = db.doc(`workflowRuns/${id}`);
  const key = randomUUID();
  const claimed = await db.runTransaction(async (transaction) => {
    const row = await transaction.get(ref);
    const workflow = row.exists
      ? await transaction.get(db.doc(`workflows/${row.get("workflowId")}`))
      : null;
    if (
      !row.exists ||
      row.get("status") !== "active" ||
      (row.get("nextAt") as Timestamp).toMillis() > now.getTime() ||
      Number(row.get("lease")?.until?.toMillis() ?? 0) > Date.now() ||
      workflow?.get("status") !== "active"
    )
      return null;
    transaction.update(ref, {
      lease: { key, until: Timestamp.fromMillis(Date.now() + 120_000) },
    });
    return row.data()!;
  });
  if (!claimed) return false;
  const subject = claimed.subject as Subject;
  const index = Number(claimed.stepIndex);
  const startedOn = DateTime.fromJSDate(
    (claimed.startedAt as Timestamp).toDate(),
    { zone },
  ).toISODate()!;
  let update: Record<string, unknown> = {};
  let entry: RunHistory;
  let logId = `step-${index + 1}`;
  try {
    const { steps } = await loadVersion(claimed.workflowId, claimed.version);
    const step = steps[index];
    if (step) logId = step.id;
    if (!step) {
      update = { status: "completed", stepIndex: steps.length };
      entry = history(
        { id: "end", kind: "control" },
        "finished",
        "All steps are done.",
      );
    } else if (step.kind === "wait") {
      update = {
        stepIndex: index + 1,
        nextAt: Timestamp.fromMillis(now.getTime() + step.days * 86_400_000),
      };
      entry = history(step, "waiting", `Waiting ${step.days} days.`);
    } else if (step.kind === "condition") {
      const passed = await conditionPassed(step, subject, startedOn);
      const next = afterCondition(steps, index, passed);
      update = {
        stepIndex: next,
        ...(next >= steps.length ? { status: "completed" } : {}),
      };
      entry = history(
        step,
        passed ? "passed" : "not met",
        passed
          ? "The condition was met."
          : next >= steps.length
            ? "The condition was not met, so the run ended."
            : "The condition was not met, so later steps were skipped.",
      );
    } else if (step.kind === "task") {
      const task = await taskStep(ref, step, subject, zone, now);
      update = step.waitForCompletion
        ? {
            status: "waiting",
            waitingFor: { kind: "task", stepId: step.id, path: task.path },
          }
        : { stepIndex: index + 1 };
      entry = history(step, "created", `Task created: ${step.title}.`);
    } else if (step.kind === "approval") {
      update = {
        status: "waiting",
        waitingFor: { kind: "approval", stepId: step.id, path: "" },
      };
      entry = history(step, "requested", `Approval requested: ${step.title}.`);
    } else {
      if (!subject.personId)
        throw new StepBlocked("This message needs a person on the roll.");
      // Consent, opt-outs and the run's state are checked again when the message is sent.
      const queued = await queueMessage(
        {
          requestId: `wf_${ref.id}_${step.id}`,
          channel: step.channel,
          subject: step.subject,
          body: step.body,
          audience: { kind: "people", ids: [subject.personId] },
          scheduledFor: null,
          confirmLarge: true,
        },
        "automation",
        {
          automatic: true,
          source: "workflow",
          workflowRun: { id: ref.id, stepId: step.id },
        },
      );
      update = { stepIndex: index + 1 };
      entry = history(
        step,
        queued.pending ? "queued" : "skipped",
        queued.pending
          ? "Message queued."
          : "Not sent: no consented address for this channel.",
      );
    }
    if (
      update.stepIndex !== undefined &&
      !update.status &&
      Number(update.stepIndex) >= steps.length
    )
      update.status = "completed";
  } catch (error) {
    update = {
      status: "blocked",
      error:
        error instanceof StepBlocked
          ? error.message
          : "This step could not be completed. Retry it, or cancel the run.",
    };
    entry = history(
      { id: logId, kind: "control" },
      "failed",
      String(update.error),
    );
  }
  // A pause or cancel during the step keeps its status. The dispatched work is still recorded.
  return db.runTransaction(async (transaction) => {
    const row = await transaction.get(ref);
    if (row.get("lease")?.key !== key) return false;
    const changed = row.get("status") !== "active";
    const status = changed ? row.get("status") : (update.status ?? "active");
    transaction.update(ref, {
      ...update,
      status,
      history: [...(row.get("history") || []), entry],
      lease: null,
      revision: Number(row.get("revision") || 0) + 1,
      updatedAt: Timestamp.fromDate(now),
    });
    const nextAt =
      (update.nextAt as Timestamp | undefined) ?? row.get("nextAt");
    return status === "active" && nextAt.toMillis() <= now.getTime();
  });
}
async function resumeFinishedTasks(now: Date) {
  const waiting = await db
    .collection("workflowRuns")
    .where("status", "==", "waiting")
    .get();
  for (const run of waiting.docs) {
    const waitingFor = run.get("waitingFor") as WorkflowRun["waitingFor"];
    if (waitingFor?.kind !== "task") continue;
    if ((await db.doc(waitingFor.path).get()).get("done") !== true) continue;
    await db.runTransaction(async (transaction) => {
      const row = await transaction.get(run.ref);
      if (
        row.get("status") !== "waiting" ||
        row.get("waitingFor")?.path !== waitingFor.path
      )
        return;
      transaction.update(run.ref, {
        status: "active",
        waitingFor: null,
        stepIndex: Number(row.get("stepIndex")) + 1,
        nextAt: Timestamp.fromDate(now),
        history: [
          ...(row.get("history") || []),
          history(
            { id: waitingFor.stepId, kind: "task" },
            "done",
            "The task was completed.",
          ),
        ],
        revision: Number(row.get("revision") || 0) + 1,
        updatedAt: Timestamp.fromDate(now),
      });
    });
  }
}
export async function processWorkflows(now: Date) {
  const zone = await getChurchZone();
  await startDateRuns(now);
  await resumeFinishedTasks(now);
  // Due runs are read per active workflow, so runs of a paused workflow never crowd out the rest.
  const workflows = await db
    .collection("workflows")
    .where("status", "==", "active")
    .get();
  for (const workflow of workflows.docs) {
    const due = await db
      .collection("workflowRuns")
      .where("workflowId", "==", workflow.id)
      .where("status", "==", "active")
      .where("nextAt", "<=", Timestamp.fromDate(now))
      .orderBy("nextAt")
      .limit(25)
      .get();
    for (const row of due.docs)
      for (let step = 0; step < 20; step++)
        if (!(await processRun(row.id, now, zone))) break;
  }
}
