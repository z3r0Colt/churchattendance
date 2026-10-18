import { grantTestStaff } from "./staff-fixture";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import { WORKFLOW_TEMPLATES } from "@sycamore/shared";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Workflow tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
const tokens: Record<string, string> = {};
async function loginToken(request: APIRequestContext, email: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await response.json()).idToken as string;
}
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  status = 200,
  account = "w9-elder",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
const tick = (request: APIRequestContext, now: DateTime) =>
  call(
    request,
    "runLocalCommunicationTick",
    { now: now.toUTC().toISO() },
    200,
    "pastor",
  );
const runDoc = (id: string) => db.doc(`workflowRuns/${id}`).get();
// Firestore triggers run asynchronously in the emulator.
async function waitForRun(id: string) {
  await expect
    .poll(async () => (await runDoc(id)).exists, { timeout: 20_000 })
    .toBe(true);
  return runDoc(id);
}
const workflowCollections = [
  "workflows",
  "workflowVersions",
  "workflowRuns",
  "mercyRequests",
  "mercyAssignments",
  "mercyTasks",
  "importantDates",
];
async function clean() {
  for (const name of workflowCollections)
    await db.recursiveDelete(db.collection(name));
  for (const id of ["w9-visitor", "w9-member"]) {
    await db.recursiveDelete(db.doc(`people/${id}`));
    await db.doc(`attendanceRoster/${id}`).delete();
  }
}
test.beforeAll(async ({ request }) => {
  tokens.pastor = await loginToken(request, "pastor@example.test");
  for (const [uid, roles, name, personId] of [
    ["w9-elder", ["elder"], "Elder Hollis", "w9-elder-person"],
    ["w9-clerk", ["clerk"], "Clerk Wren", ""],
    ["w9-admin", ["admin"], "Office Admin", ""],
    ["w9-deacon", ["deacon"], "Deacon Fenn", ""],
  ] as const) {
    await auth.getUser(uid).catch(() =>
      auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        displayName: name,
      }),
    );
    await grantTestStaff(uid, roles);
    await db
      .doc(`users/${uid}`)
      .set({ displayName: name, roles: [...roles], personId });
    tokens[uid] = await loginToken(request, `${uid}@example.test`);
  }
  await db
    .doc("elderDistricts/w9-north")
    .set({ name: "Fictional North", elderPersonId: "w9-elder-person" });
});
test.beforeEach(clean);
// Later specs tick the scheduler, so leave no active workflow behind.
test.afterAll(async () => {
  await clean();
  await db.doc("elderDistricts/w9-north").delete();
});
async function publish(
  request: APIRequestContext,
  id: string,
  draft: object,
  account = "w9-elder",
) {
  await call(
    request,
    "saveWorkflowDraft",
    { id, expectedRevision: 0, ...draft },
    200,
    account,
  );
  const preview = await call(request, "previewWorkflow", { id }, 200, account);
  expect(preview.problems).toEqual([]);
  await call(
    request,
    "publishWorkflow",
    { id, expectedRevision: preview.revision, confirmPreview: true },
    200,
    account,
  );
  return preview;
}
const person = (patch: object = {}) => ({
  firstName: "Nora",
  lastName: "Pell",
  preferredName: "",
  householdId: "moss",
  membershipStatus: "visitor",
  email: "nora@example.test",
  mobilePhone: "",
  birthDate: "",
  emailOptIn: true,
  smsOptIn: false,
  isDeceased: false,
  elderDistrictId: "",
  updatedBy: "w9-clerk",
  ...patch,
});
const start = DateTime.utc().plus({ hours: 1 }).startOf("minute");

test("runs one visitor follow-up, waits for the officer's task, respects pause and opt-outs", async ({
  request,
}) => {
  const visitor = WORKFLOW_TEMPLATES.visitorFollowUp;
  const steps = visitor.steps.map((step) =>
    step.kind === "task" ? { ...step, uid: "w9-elder" } : step,
  );
  // Without an officer for the task, the workflow cannot be activated.
  await call(request, "saveWorkflowDraft", {
    id: "w9-visitors",
    expectedRevision: 0,
    ...visitor,
  });
  const incomplete = await call(request, "previewWorkflow", {
    id: "w9-visitors",
  });
  expect(incomplete.problems).toEqual([
    "Step 3 needs someone to assign the task to.",
  ]);
  await call(
    request,
    "publishWorkflow",
    { id: "w9-visitors", expectedRevision: 1, confirmPreview: true },
    400,
  );
  await call(request, "saveWorkflowDraft", {
    id: "w9-visitors",
    expectedRevision: 1,
    ...visitor,
    steps,
  });
  const preview = await call(request, "previewWorkflow", {
    id: "w9-visitors",
  });
  expect(preview).toMatchObject({
    revision: 2,
    trigger: "A visitor is recorded",
    problems: [],
  });
  expect(preview.steps[2]).toBe(
    "Task for Elder Hollis: Welcome call to a new visitor, due in 3 days, then wait until it is done",
  );
  expect(preview.messages).toHaveLength(2);
  // A stale preview cannot activate a changed draft. An Admin outside the Session is refused.
  await call(
    request,
    "publishWorkflow",
    { id: "w9-visitors", expectedRevision: 1, confirmPreview: true },
    409,
  );
  await call(request, "getWorkflowData", {}, 403, "w9-admin");
  await call(
    request,
    "publishWorkflow",
    { id: "w9-visitors", expectedRevision: 2, confirmPreview: true },
    403,
    "w9-admin",
  );
  await call(request, "publishWorkflow", {
    id: "w9-visitors",
    expectedRevision: 2,
    confirmPreview: true,
  });

  await db.doc("people/w9-visitor").set(person());
  const runId = "w9-visitors_w9-visitor";
  await waitForRun(runId);
  // Recording the same visitor again finds the existing run.
  await db.doc("people/w9-visitor").delete();
  await db.doc("people/w9-visitor").set(person());
  // Two schedulers at once still send the thank-you once.
  await Promise.all([tick(request, start), tick(request, start)]);
  expect(
    (
      await db
        .collection("workflowRuns")
        .where("workflowId", "==", "w9-visitors")
        .get()
    ).size,
  ).toBe(1);
  expect((await db.doc(`messages/wf_${runId}_thank-you`).get()).exists).toBe(
    true,
  );
  let run = (await runDoc(runId)).data()!;
  expect(run).toMatchObject({ status: "active", stepIndex: 2, version: 1 });
  expect(
    run.history.filter((row: { stepId: string }) => row.stepId === "thank-you"),
  ).toHaveLength(1);

  await tick(request, start.plus({ days: 2, minutes: 1 }));
  run = (await runDoc(runId)).data()!;
  expect(run.status).toBe("waiting");
  const task = (
    await db.doc(`followUps/wf_${runId}_welcome-call`).get()
  ).data()!;
  expect(task).toMatchObject({ assignedToUid: "w9-elder", done: false });
  expect(JSON.stringify(task)).not.toContain("Welcome call");

  // Pausing holds the run even after the officer finishes the task.
  await call(request, "controlWorkflowRun", {
    id: runId,
    expectedRevision: run.revision,
    action: "pause",
  });
  await call(request, "saveFollowUp", {
    id: `wf_${runId}_welcome-call`,
    expectedRevision: 1,
    personId: "w9-visitor",
    title: "Welcome call to a new visitor",
    assignedToUid: "w9-elder",
    dueDate: task.dueDate,
    done: true,
  });
  await tick(request, start.plus({ days: 3 }));
  run = (await runDoc(runId)).data()!;
  expect(run).toMatchObject({ status: "paused", stepIndex: 2 });
  await call(request, "controlWorkflowRun", {
    id: runId,
    expectedRevision: run.revision,
    action: "resume",
  });
  await tick(request, start.plus({ days: 3, minutes: 1 }));
  run = (await runDoc(runId)).data()!;
  expect(run).toMatchObject({ status: "active", stepIndex: 4 });

  // The person withdrew email consent, so the last message is not sent.
  await db.doc("people/w9-visitor").update({ emailOptIn: false });
  await tick(request, start.plus({ days: 18 }));
  run = (await runDoc(runId)).data()!;
  expect(run.status).toBe("completed");
  expect(run.history.at(-1)).toMatchObject({
    stepId: "invite-back",
    outcome: "skipped",
  });
  const data = await call(request, "getWorkflowData", {});
  expect(data.runs[0]).toMatchObject({ id: runId, status: "completed" });
  expect(data.runs[0].lease).toBeUndefined();
});

test("refuses self-approval, keeps a run on its version until it is moved, and assigns the district elder", async ({
  request,
}) => {
  await publish(
    request,
    "w9-members",
    WORKFLOW_TEMPLATES.memberOnboarding,
    "w9-clerk",
  );
  await db.doc("people/w9-member").set(
    person({
      membershipStatus: "adherent",
      email: "",
      emailOptIn: false,
      householdId: "baker",
      elderDistrictId: "w9-north",
    }),
  );
  await db.collection("people/w9-member/membershipEvents").add({
    date: "2026-01-04",
    fromStatus: null,
    toStatus: "adherent",
    method: "initial",
    otherChurch: "",
    reason: "Initial roll entry",
  });
  await call(
    request,
    "savePerson",
    {
      id: "w9-member",
      changes: { membershipStatus: "communicant" },
      expected: { membershipStatus: "adherent" },
      membershipEvent: {
        date: DateTime.now().toISODate(),
        fromStatus: "adherent",
        toStatus: "communicant",
        method: "profession",
        reason: "Fictional profession of faith",
      },
    },
    200,
    "w9-clerk",
  );
  await expect
    .poll(
      async () =>
        (
          await db
            .collection("workflowRuns")
            .where("workflowId", "==", "w9-members")
            .get()
        ).size,
      { timeout: 20_000 },
    )
    .toBe(1);
  const runId = (
    await db
      .collection("workflowRuns")
      .where("workflowId", "==", "w9-members")
      .get()
  ).docs[0].id;
  await tick(request, start);
  let run = (await runDoc(runId)).data()!;
  expect(run).toMatchObject({
    status: "waiting",
    startedBy: "w9-clerk",
    waitingFor: { kind: "approval", stepId: "roll-check" },
  });
  // No email address, so the welcome is recorded as not sent.
  expect(run.history[0]).toMatchObject({
    stepId: "welcome",
    outcome: "skipped",
  });

  // A new version leaves the running person on version 1 until deliberately moved.
  await call(
    request,
    "saveWorkflowDraft",
    {
      id: "w9-members",
      expectedRevision: 2,
      ...WORKFLOW_TEMPLATES.memberOnboarding,
      steps: WORKFLOW_TEMPLATES.memberOnboarding.steps.slice(1),
    },
    200,
    "w9-clerk",
  );
  const next = await call(
    request,
    "previewWorkflow",
    { id: "w9-members" },
    200,
    "w9-clerk",
  );
  await call(
    request,
    "publishWorkflow",
    { id: "w9-members", expectedRevision: next.revision, confirmPreview: true },
    200,
    "w9-clerk",
  );
  expect((await runDoc(runId)).get("version")).toBe(1);
  await call(request, "controlWorkflowRun", {
    id: runId,
    expectedRevision: run.revision,
    action: "migrate",
  });
  run = (await runDoc(runId)).data()!;
  expect(run).toMatchObject({ version: 2, stepIndex: 0, status: "waiting" });

  for (const [account, message] of [
    ["w9-clerk", "You started this run, so another officer must approve it."],
    ["w9-elder", "Your role cannot approve this step."],
  ] as const) {
    const response = await request.post(`${base}/decideWorkflowApproval`, {
      headers: { Authorization: `Bearer ${tokens[account]}` },
      data: {
        data: {
          id: runId,
          expectedRevision: run.revision,
          decision: "approve",
        },
      },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.message).toBe(message);
  }
  await call(
    request,
    "decideWorkflowApproval",
    { id: runId, expectedRevision: run.revision, decision: "approve" },
    200,
    "pastor",
  );
  await tick(request, start.plus({ minutes: 1 }));
  run = (await runDoc(runId)).data()!;
  expect(run.status).toBe("completed");
  expect(
    (await db.doc(`followUps/wf_${runId}_elder-visit`).get()).get(
      "assignedToUid",
    ),
  ).toBe("w9-elder");
});

test("starts request and date workflows once, blocks on a revoked officer and retries", async ({
  request,
}) => {
  await publish(request, "w9-meals", {
    name: "Meals follow-up",
    trigger: { kind: "requestApproved", categories: ["meals"] },
    steps: [
      {
        id: "arrange",
        kind: "task",
        title: "Arrange the meal rota",
        assignTo: "requestDeacons",
        dueInDays: 1,
      },
      {
        id: "check-in",
        kind: "task",
        title: "Check in with the household",
        assignTo: "account",
        uid: "w9-deacon",
        dueInDays: 7,
      },
    ],
  });
  await call(request, "saveMercyRequest", {
    id: "w9-request",
    expectedRevision: 0,
    householdId: "calder",
    personId: "ruth",
    category: "meals",
    details: "Fictional meal need",
  });
  await call(request, "triageMercyRequest", {
    id: "w9-request",
    expectedRevision: 1,
    action: "approve",
    deaconUids: ["w9-deacon"],
  });
  const runId = "w9-meals_w9-request";
  await waitForRun(runId);
  // The officer chosen for step 2 lost the deacon role before it ran.
  await grantTestStaff("w9-deacon", ["readOnly"]);
  try {
    await tick(request, start);
    // Step 1 found no deacon with an active role either, so the run stopped there.
    let run = (await runDoc(runId)).data()!;
    expect(run).toMatchObject({
      status: "blocked",
      error: "The request has no deacon with an active role.",
    });
    await grantTestStaff("w9-deacon", ["deacon"]);
    await call(request, "controlWorkflowRun", {
      id: runId,
      expectedRevision: run.revision,
      action: "retry",
    });
    await tick(request, start.plus({ minutes: 1 }));
    run = (await runDoc(runId)).data()!;
    expect(run.status).toBe("completed");
    const mercy = (
      await db.doc(`mercyTasks/wf_${runId}_arrange`).get()
    ).data()!;
    expect(mercy).toMatchObject({
      requestId: "w9-request",
      assignedToUid: "w9-deacon",
    });
    expect(JSON.stringify(mercy)).not.toContain("meal rota");
    expect((await db.doc(`mercyTasks/wf_${runId}_check-in`).get()).exists).toBe(
      true,
    );
  } finally {
    await grantTestStaff("w9-deacon", ["deacon"]);
  }

  // An important-date workflow starts on exactly the day that many days before the date.
  await publish(request, "w9-anniversary", {
    name: "Anniversary card",
    trigger: {
      kind: "importantDate",
      source: "importantDates",
      dateKinds: ["weddingAnniversary"],
      daysBefore: 7,
    },
    steps: [
      {
        id: "card",
        kind: "task",
        title: "Send an anniversary card",
        assignTo: "account",
        uid: "w9-elder",
        dueInDays: 5,
      },
    ],
  });
  await call(request, "saveImportantDate", {
    id: "w9-wedding",
    personId: "ruth",
    kind: "weddingAnniversary",
    date: "2001-03-12",
  });
  const dateRuns = async () =>
    (
      await db
        .collection("workflowRuns")
        .where("workflowId", "==", "w9-anniversary")
        .get()
    ).docs.map((row) => row.id);
  await tick(request, DateTime.fromISO("2027-03-04T15:00:00Z"));
  expect(await dateRuns()).toEqual([]);
  await tick(request, DateTime.fromISO("2027-03-05T15:00:00Z"));
  await tick(request, DateTime.fromISO("2027-03-05T16:00:00Z"));
  await tick(request, DateTime.fromISO("2027-03-06T15:00:00Z"));
  expect(await dateRuns()).toEqual(["w9-anniversary_w9-wedding_2027-03-12"]);
  expect(
    (
      await db
        .doc("followUps/wf_w9-anniversary_w9-wedding_2027-03-12_card")
        .get()
    ).get("dueDate"),
  ).toBe("2027-03-10");
});

test("stops a cancelled run and drops a message still waiting for it", async ({
  request,
}) => {
  await publish(request, "w9-cancel", {
    name: "Short welcome",
    trigger: { kind: "visitorRecorded" },
    steps: [
      { id: "pause", kind: "wait", days: 1 },
      {
        id: "hello",
        kind: "message",
        channel: "email",
        subject: "Hello from {ChurchName}",
        body: "Dear {FirstName}, thank you for visiting.",
      },
    ],
  });
  await db.doc("people/w9-visitor").set(person());
  const runId = "w9-cancel_w9-visitor";
  await waitForRun(runId);
  await tick(request, start);
  let run = (await runDoc(runId)).data()!;
  expect(run).toMatchObject({ status: "active", stepIndex: 1 });
  // A message queued earlier for this run is still waiting when the run is cancelled.
  await db.doc("messages/w9-waiting").set({
    channel: "email",
    subject: "Hello",
    body: "Dear {FirstName}",
    audience: { kind: "people", ids: ["w9-visitor"] },
    scheduledFor: Timestamp.fromMillis(Date.now() - 60_000),
    status: "queued",
    createdByUid: "automation",
    selectedPersonIds: ["w9-visitor"],
    sessionOnly: false,
    workflowRun: { id: runId, stepId: "hello" },
    attachments: [],
    activeCount: 0,
    source: "workflow",
    serviceTime: "",
    dateLabel: "",
    expiresAt: null,
    totals: { pending: 1 },
  });
  await db.doc("messages/w9-waiting/recipients/w9-visitor_email").set({
    personId: "w9-visitor",
    channel: "email",
    address: "nora@example.test",
    status: "pending",
    providerId: "",
    attemptKey: "",
  });
  await call(request, "controlWorkflowRun", {
    id: runId,
    expectedRevision: run.revision,
    action: "cancel",
  });
  try {
    await tick(request, start.plus({ days: 2 }));
    run = (await runDoc(runId)).data()!;
    expect(run).toMatchObject({ status: "cancelled", stepIndex: 1 });
    expect(run.history.at(-1)).toMatchObject({
      outcome: "cancel",
      by: "w9-elder",
    });
    expect((await db.doc(`messages/wf_${runId}_hello`).get()).exists).toBe(
      false,
    );
    expect(
      (
        await db.doc("messages/w9-waiting/recipients/w9-visitor_email").get()
      ).get("status"),
    ).toBe("skipped");
    // A cancelled run cannot be resumed or retried.
    await call(
      request,
      "controlWorkflowRun",
      { id: runId, expectedRevision: run.revision, action: "resume" },
      400,
    );
  } finally {
    await db.recursiveDelete(db.doc("messages/w9-waiting"));
  }
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("w9-elder@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
}
test("builds a workflow from a template with the keyboard, previews it and activates it", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Care workflows · Session only" })
    .click();
  await page
    .getByRole("button", { name: "New from template: Visitor follow-up" })
    .click();
  await expect(page.getByText("Before activating: Step 3 needs")).toBeVisible();
  // The diagram nodes are buttons, so the step can be chosen from the keyboard.
  const node = page.getByRole("button", {
    name: /^Step 3: Task for a chosen officer/,
  });
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Step 3 · Assign a task")).toBeVisible();
  await page.getByLabel("Officer", { exact: true }).selectOption("w9-elder");
  await expect(
    page.getByRole("button", { name: /^Step 3: Task for Elder Hollis/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move step 3 earlier" }).click();
  await expect(
    page.getByRole("button", { name: /^Step 2: Task for Elder Hollis/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("region", { name: "Workflow preview" });
  await expect(preview).toContainText(
    "Only people who meet the trigger after activation are enrolled.",
  );
  await expect(preview).toContainText("Thank you for worshipping with us");
  await page.getByRole("button", { name: "Activate version 1" }).click();
  await expect(page.getByText("Version 1 is active")).toBeVisible();
  await page.screenshot({
    path: "test-results/phase9-workflow-builder.png",
    fullPage: true,
    animations: "disabled",
  });
});
