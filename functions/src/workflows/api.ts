import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  approvalDecisionSchema,
  approvalRefusal,
  describeStep,
  emptySecuritySchema,
  migrationIndex,
  occurrenceForYear,
  runControlSchema,
  workflowControlSchema,
  workflowDraftSchema,
  workflowPreviewSchema,
  workflowProblems,
  workflowPublishSchema,
  workflowStepSchema,
  workflowTriggerLabels,
  workflowTriggerSchema,
  type ImportantDate,
  type RunHistory,
  type WorkflowStep,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { securityEvent } from "../security/audit.js";
import { getChurchZone } from "../communications/queue.js";
import { liveAccount } from "../shepherding/visits.js";
import { loadVersion } from "./engine.js";

// Workflows can reach bereavement dates and Session tasks, so every endpoint is Session only.
const plain = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value instanceof Timestamp ? value.toDate().toISOString() : value,
    ]),
  );
const control = (
  action: string,
  detail: string,
  by: string,
  stepId = "control",
): RunHistory => ({
  stepId,
  kind: "control",
  outcome: action,
  detail,
  at: new Date().toISOString(),
  by,
});
function draftOf(data: DocumentData) {
  return {
    trigger: workflowTriggerSchema.parse(data.trigger),
    steps: workflowStepSchema.array().parse(data.steps),
  };
}
async function accountNames(steps: WorkflowStep[]) {
  const names: Record<string, string> = {};
  for (const step of steps)
    if (step.kind === "task" && step.uid && !names[step.uid])
      names[step.uid] =
        (await getAuth()
          .getUser(step.uid)
          .then((user) => user.displayName || "")
          .catch(() => "")) || "Former account";
  return names;
}

export const saveWorkflowDraft = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(
    workflowDraftSchema,
    request.data,
  );
  const ref = db.doc(`workflows/${id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This workflow changed. Reopen it before saving.",
      );
    if (before.get("status") === "archived")
      throw new HttpsError(
        "failed-precondition",
        "An archived workflow cannot be edited.",
      );
    // Editing the draft never changes a published version or the runs using it.
    transaction.set(ref, {
      ...input,
      status: before.get("status") ?? "draft",
      publishedVersion: before.get("publishedVersion") ?? 0,
      revision: expectedRevision + 1,
      createdAt: before.get("createdAt") ?? Timestamp.now(),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { id };
});

// The preview names who the trigger would reach and shows each action before activation.
export const previewWorkflow = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id } = parse(workflowPreviewSchema, request.data);
  const row = await db.doc(`workflows/${id}`).get();
  if (!row.exists)
    throw new HttpsError("not-found", "That workflow could not be found.");
  const { trigger, steps } = draftOf(row.data()!);
  const zone = await getChurchZone();
  const today = DateTime.now().setZone(zone).startOf("day");
  const upcoming: {
    personId: string;
    name: string;
    startsOn: string;
    date: string;
  }[] = [];
  if (trigger.kind === "importantDate") {
    const [dates, people] = await Promise.all([
      db.collection(trigger.source).get(),
      db.collection("people").get(),
    ]);
    for (const date of dates.docs) {
      const record = date.data() as ImportantDate;
      if (trigger.dateKinds.length && !trigger.dateKinds.includes(record.kind))
        continue;
      const person = people.docs.find((p) => p.id === record.personId);
      if (!person || person.get("isDeceased")) continue;
      for (const year of [today.year, today.year + 1]) {
        const occurrence = occurrenceForYear(record, year);
        if (!occurrence) continue;
        const startsOn = DateTime.fromISO(occurrence.date)
          .minus({ days: trigger.daysBefore })
          .toISODate()!;
        if (
          startsOn >= today.toISODate()! &&
          startsOn <= today.plus({ days: 60 }).toISODate()!
        )
          upcoming.push({
            personId: record.personId,
            name: `${person.get("firstName")} ${person.get("lastName")}`,
            startsOn,
            date: occurrence.date,
          });
      }
    }
    upcoming.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  }
  await securityEvent(
    actor.uid,
    "workflow.preview",
    "success",
    "session",
    row.ref.path,
  );
  const names = await accountNames(steps);
  return {
    revision: Number(row.get("revision") || 0),
    trigger: workflowTriggerLabels[trigger.kind],
    enrollment:
      trigger.kind === "importantDate"
        ? `Runs start ${trigger.daysBefore} days before each date. These would start in the next 60 days. Dates already passed are never started late.`
        : "Only people who meet the trigger after activation are enrolled. No one already on the roll is added.",
    upcoming,
    steps: steps.map((step) => describeStep(step, names)),
    messages: steps
      .filter((step) => step.kind === "message")
      .map((step) => ({
        stepId: step.id,
        channel: step.channel,
        subject: step.subject,
        body: step.body,
      })),
    problems: workflowProblems({ trigger, steps }),
  };
});

export const publishWorkflow = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(workflowPublishSchema, request.data);
  const ref = db.doc(`workflows/${input.id}`);
  const current = await ref.get();
  if (!current.exists)
    throw new HttpsError("not-found", "That workflow could not be found.");
  const { steps } = draftOf(current.data()!);
  // Chosen officers must hold a live church role when the version is published.
  for (const step of steps)
    if (step.kind === "task" && step.assignTo === "account")
      await liveAccount(step.uid, [...SESSION_ROLES, "deacon"]);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (before.get("revision") !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This workflow changed after the preview. Preview it again before activating.",
      );
    if (before.get("status") === "archived")
      throw new HttpsError(
        "failed-precondition",
        "An archived workflow cannot be activated.",
      );
    const draft = draftOf(before.data()!);
    const problems = workflowProblems(draft);
    if (problems.length)
      throw new HttpsError("failed-precondition", problems[0]);
    const version = Number(before.get("publishedVersion") || 0) + 1;
    transaction.create(db.doc(`workflowVersions/${input.id}_v${version}`), {
      workflowId: input.id,
      version,
      name: before.get("name"),
      trigger: draft.trigger,
      steps: draft.steps,
      publishedAt: Timestamp.now(),
      publishedBy: actor.uid,
    });
    transaction.update(ref, {
      publishedVersion: version,
      status: before.get("status") === "paused" ? "paused" : "active",
      revision: input.expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { published: true };
});

export const controlWorkflow = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(workflowControlSchema, request.data);
  const ref = db.doc(`workflows/${input.id}`);
  await db.runTransaction(async (transaction) => {
    const [before, open] = await Promise.all([
      transaction.get(ref),
      transaction.get(
        db
          .collection("workflowRuns")
          .where("workflowId", "==", input.id)
          .where("status", "in", ["active", "waiting", "paused", "blocked"])
          .limit(1),
      ),
    ]);
    if (!before.exists || before.get("revision") !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This workflow changed. Reopen it before changing it.",
      );
    const status = before.get("status");
    const next =
      input.action === "pause"
        ? status === "active" && "paused"
        : input.action === "resume"
          ? status === "paused" && "active"
          : status !== "archived" && open.empty && "archived";
    if (!next)
      throw new HttpsError(
        "failed-precondition",
        input.action === "archive"
          ? "Finish or cancel this workflow's runs before archiving it."
          : `This workflow cannot ${input.action} from its current state.`,
      );
    transaction.update(ref, {
      status: next,
      revision: input.expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

export const controlWorkflowRun = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(runControlSchema, request.data);
  const ref = db.doc(`workflowRuns/${input.id}`);
  const run = await ref.get();
  if (!run.exists)
    throw new HttpsError("not-found", "That run could not be found.");
  // Migration is deliberate: the run moves only where its current step exists in the latest version.
  let migration: Record<string, unknown> = {};
  if (input.action === "migrate") {
    const workflow = await db.doc(`workflows/${run.get("workflowId")}`).get();
    const latest = Number(workflow.get("publishedVersion") || 0);
    if (latest <= run.get("version"))
      throw new HttpsError(
        "failed-precondition",
        "This run already uses the latest version.",
      );
    const [from, to] = await Promise.all([
      loadVersion(run.get("workflowId"), run.get("version")),
      loadVersion(run.get("workflowId"), latest),
    ]);
    const index = migrationIndex(from.steps, to.steps, run.get("stepIndex"));
    if (index < 0)
      throw new HttpsError(
        "failed-precondition",
        "This run's current step is not in the latest version, so it keeps its version.",
      );
    migration = { version: latest, stepIndex: index };
  }
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (before.get("revision") !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This run changed. Reopen it before changing it.",
      );
    const status = before.get("status") as string;
    const open = ["active", "waiting", "blocked"].includes(status);
    let update: Record<string, unknown> | null = null;
    if (input.action === "pause" && open)
      update = { status: "paused", pausedFrom: status };
    if (input.action === "resume" && status === "paused")
      update = {
        status: before.get("pausedFrom") || "active",
        nextAt: Timestamp.now(),
      };
    if (input.action === "cancel" && (open || status === "paused"))
      update = { status: "cancelled", waitingFor: null };
    if (input.action === "retry" && status === "blocked")
      update = { status: "active", error: "", nextAt: Timestamp.now() };
    if (
      input.action === "migrate" &&
      status !== "cancelled" &&
      status !== "completed"
    )
      update = migration;
    if (!update)
      throw new HttpsError(
        "failed-precondition",
        `This run cannot ${input.action} from its current state.`,
      );
    transaction.update(ref, {
      ...update,
      lease: null,
      history: [
        ...(before.get("history") || []),
        control(
          input.action,
          input.action === "migrate"
            ? `Moved to version ${String(migration.version)}.`
            : {
                pause: "Run paused.",
                resume: "Run resumed.",
                cancel: "Run cancelled.",
                retry: "Run retried.",
              }[input.action],
          actor.uid,
        ),
      ],
      revision: input.expectedRevision + 1,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

export const decideWorkflowApproval = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(approvalDecisionSchema, request.data);
  const ref = db.doc(`workflowRuns/${input.id}`);
  const run = await ref.get();
  const waiting = run.get("waitingFor");
  if (
    !run.exists ||
    run.get("status") !== "waiting" ||
    waiting?.kind !== "approval"
  )
    throw new HttpsError(
      "failed-precondition",
      "This run is not waiting for an approval.",
    );
  const { steps } = await loadVersion(
    run.get("workflowId"),
    run.get("version"),
  );
  const step = steps[run.get("stepIndex")];
  if (step?.kind !== "approval" || step.id !== waiting.stepId)
    throw new HttpsError("failed-precondition", "The approval step changed.");
  const refusal = approvalRefusal(step, actor, {
    startedBy: run.get("startedBy"),
  });
  if (refusal) {
    await securityEvent(
      actor.uid,
      "workflow.approval",
      "denied",
      "session",
      ref.path,
    );
    throw new HttpsError("permission-denied", refusal);
  }
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (
      before.get("revision") !== input.expectedRevision ||
      before.get("status") !== "waiting"
    )
      throw new HttpsError(
        "aborted",
        "This run changed. Reopen it before deciding.",
      );
    const approved = input.decision === "approve";
    const next = Number(before.get("stepIndex")) + 1;
    transaction.update(ref, {
      status: approved
        ? next >= steps.length
          ? "completed"
          : "active"
        : "completed",
      waitingFor: null,
      stepIndex: approved ? next : steps.length,
      nextAt: Timestamp.now(),
      history: [
        ...(before.get("history") || []),
        {
          stepId: step.id,
          kind: "approval",
          outcome: approved ? "approved" : "rejected",
          detail: approved ? "Approved." : "Not approved, so the run ended.",
          at: new Date().toISOString(),
          by: actor.uid,
        },
      ],
      revision: input.expectedRevision + 1,
      updatedAt: Timestamp.now(),
    });
  });
  await securityEvent(
    actor.uid,
    "workflow.approval",
    "success",
    "session",
    ref.path,
  );
  return { saved: true };
});

export const getWorkflowData = onCall(async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  const actor = await requireRoles(request, SESSION_ROLES);
  const [workflows, versions, runs] = await Promise.all([
    db.collection("workflows").get(),
    db.collection("workflowVersions").get(),
    db.collection("workflowRuns").orderBy("startedAt", "desc").limit(300).get(),
  ]);
  await securityEvent(actor.uid, "workflow.read", "success", "session");
  const rows = (snapshot: typeof workflows) =>
    snapshot.docs.map((row) => {
      const data = row.data();
      delete data.lease;
      return { ...plain(data), id: row.id };
    });
  return {
    workflows: rows(workflows),
    versions: rows(versions),
    runs: rows(runs),
  };
});
