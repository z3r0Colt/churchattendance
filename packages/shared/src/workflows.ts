import { z } from "zod";
import { idSchema, type Role } from "./domain.js";
import { mercyCategories } from "./mercy.js";

const optionalId = z.union([idSchema, z.literal("")]);
const stepId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const plainTitle = z.string().trim().min(1).max(150);
// Workflow messages may greet the person and name the church, and nothing else.
const workflowMergeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) =>
        !/[{}]/.test(value.replace(/\{(FirstName|LastName|ChurchName)\}/g, "")),
      "Use only the FirstName, LastName and ChurchName merge fields",
    );

export const workflowTriggerKinds = [
  "visitorRecorded",
  "membershipReceived",
  "requestApproved",
  "importantDate",
] as const;
export type WorkflowTriggerKind = (typeof workflowTriggerKinds)[number];
export const workflowTriggerLabels: Record<WorkflowTriggerKind, string> = {
  visitorRecorded: "A visitor is recorded",
  membershipReceived: "Someone is received into membership",
  requestApproved: "A practical-help request is approved",
  importantDate: "An important date is coming",
};
export const workflowTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visitorRecorded") }).strict(),
  z
    .object({
      kind: z.literal("membershipReceived"),
      statuses: z
        .array(z.enum(["communicant", "baptized"]))
        .min(1)
        .default(["communicant"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("requestApproved"),
      // Empty means every kind of practical help.
      categories: z.array(z.enum(mercyCategories)).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("importantDate"),
      source: z.enum(["importantDates", "bereavementDates"]),
      // Empty means every kind of date in the source.
      dateKinds: z
        .array(
          z.enum([
            "weddingAnniversary",
            "baptismAnniversary",
            "membershipAnniversary",
            "deathAnniversary",
            "lateSpouseBirthday",
            "lateWeddingAnniversary",
            "other",
          ]),
        )
        .default([]),
      daysBefore: z.number().int().min(0).max(30).default(7),
    })
    .strict(),
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

export const conditionTests = [
  "stillVisitor",
  "attendedSinceStart",
  "notAttendedSinceStart",
  "requestOpen",
  "hasEmailConsent",
  "hasSmsConsent",
] as const;
export type ConditionTest = (typeof conditionTests)[number];
export const conditionLabels: Record<ConditionTest, string> = {
  stillVisitor: "The person is still a visitor",
  attendedSinceStart: "The person has attended since this run started",
  notAttendedSinceStart: "The person has not attended since this run started",
  requestOpen: "The request is still open",
  hasEmailConsent: "The person accepts church email",
  hasSmsConsent: "The person accepts church texts",
};
export const taskAssignees = [
  "districtElder",
  "account",
  "requestDeacons",
] as const;
export const workflowStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: stepId,
      kind: z.literal("wait"),
      days: z.number().int().min(1).max(365),
    })
    .strict(),
  z
    .object({
      id: stepId,
      kind: z.literal("condition"),
      test: z.enum(conditionTests),
      onFalse: z.enum(["end", "skipTo"]).default("end"),
      skipTo: z.union([stepId, z.literal("")]).default(""),
    })
    .strict(),
  z
    .object({
      id: stepId,
      kind: z.literal("task"),
      title: plainTitle,
      assignTo: z.enum(taskAssignees),
      uid: optionalId.default(""),
      dueInDays: z.number().int().min(0).max(60).default(3),
      waitForCompletion: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      id: stepId,
      kind: z.literal("approval"),
      title: plainTitle,
      approverRoles: z
        .array(z.enum(["pastor", "clerk", "elder"]))
        .min(1)
        .default(["pastor", "clerk", "elder"]),
      allowSelfApproval: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      id: stepId,
      kind: z.literal("message"),
      channel: z.enum(["email", "sms"]),
      subject: workflowMergeText(0, 150).default(""),
      body: workflowMergeText(1, 2000),
    })
    .strict(),
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export const workflowDraftSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    trigger: workflowTriggerSchema,
    steps: z.array(workflowStepSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (row) =>
      new Set(row.steps.map((step) => step.id)).size === row.steps.length,
    "Give each step its own ID",
  );
export type WorkflowDraft = Omit<
  z.infer<typeof workflowDraftSchema>,
  "expectedRevision"
>;
// A draft can be saved with gaps. Publishing requires none.
export function workflowProblems(
  draft: Pick<WorkflowDraft, "trigger" | "steps">,
) {
  const problems: string[] = [];
  draft.steps.forEach((step, index) => {
    const label = `Step ${index + 1}`;
    if (step.kind === "condition") {
      if (
        step.test === "requestOpen" &&
        draft.trigger.kind !== "requestApproved"
      )
        problems.push(
          `${label} checks a request, but this workflow does not start from one.`,
        );
      if (step.onFalse === "skipTo") {
        const target = draft.steps.findIndex((row) => row.id === step.skipTo);
        if (target <= index)
          problems.push(`${label} must skip forward to a later step.`);
      }
    }
    if (step.kind === "task") {
      if (step.assignTo === "account" && !step.uid)
        problems.push(`${label} needs someone to assign the task to.`);
      if (
        step.assignTo === "requestDeacons" &&
        draft.trigger.kind !== "requestApproved"
      )
        problems.push(
          `${label} goes to a request's deacons, but this workflow does not start from a request.`,
        );
    }
    if (step.kind === "message" && step.channel === "email" && !step.subject)
      problems.push(`${label} needs an email subject.`);
  });
  if (draft.steps.at(-1)?.kind === "wait")
    problems.push("End the workflow with an action, not a wait.");
  return problems;
}
export const workflowPublishSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().positive(),
    confirmPreview: z.literal(true),
  })
  .strict();
export const workflowControlSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().positive(),
    action: z.enum(["pause", "resume", "archive"]),
  })
  .strict();
export const runControlSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().positive(),
    action: z.enum(["pause", "resume", "cancel", "retry", "migrate"]),
  })
  .strict();
export const approvalDecisionSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export const workflowPreviewSchema = z.object({ id: idSchema }).strict();

export const workflowStatuses = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];
export type Workflow = WorkflowDraft & {
  status: WorkflowStatus;
  publishedVersion: number;
  revision: number;
};
export type WorkflowVersion = {
  id: string;
  workflowId: string;
  version: number;
  name: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  publishedAt: string;
  publishedBy: string;
};
export const runStatuses = [
  "active",
  "waiting",
  "paused",
  "blocked",
  "cancelled",
  "completed",
] as const;
export type RunStatus = (typeof runStatuses)[number];
export const runStatusLabels: Record<RunStatus, string> = {
  active: "Running",
  waiting: "Waiting",
  paused: "Paused",
  blocked: "Needs attention",
  cancelled: "Cancelled",
  completed: "Finished",
};
export type RunHistory = {
  stepId: string;
  kind: WorkflowStep["kind"] | "control";
  outcome: string;
  detail: string;
  at: string;
  by: string;
};
export type WorkflowRun = {
  id: string;
  workflowId: string;
  version: number;
  subject: {
    personId: string;
    householdId: string;
    requestId: string;
    dateId: string;
    occurrence: string;
  };
  status: RunStatus;
  stepIndex: number;
  nextAt: string;
  startedAt: string;
  startedBy: string;
  waitingFor: {
    kind: "task" | "approval";
    stepId: string;
    path: string;
  } | null;
  error: string;
  history: RunHistory[];
  revision: number;
};

// Self-approval is refused unless the step allows it. The starter is whoever caused the run to begin.
export function approvalRefusal(
  step: Extract<WorkflowStep, { kind: "approval" }>,
  actor: { uid: string; roles: readonly Role[] },
  run: Pick<WorkflowRun, "startedBy">,
) {
  if (
    !actor.roles.some((role) => (step.approverRoles as Role[]).includes(role))
  )
    return "Your role cannot approve this step.";
  if (!step.allowSelfApproval && actor.uid === run.startedBy)
    return "You started this run, so another officer must approve it.";
  return "";
}
// A running instance moves to a newer version only where its current step still exists.
export function migrationIndex(
  from: WorkflowStep[],
  to: WorkflowStep[],
  stepIndex: number,
) {
  if (stepIndex >= from.length) return -1;
  return to.findIndex((step) => step.id === from[stepIndex].id);
}
export function afterCondition(
  steps: WorkflowStep[],
  index: number,
  passed: boolean,
) {
  const step = steps[index];
  if (passed || step.kind !== "condition") return index + 1;
  if (step.onFalse === "skipTo") {
    const target = steps.findIndex((row) => row.id === step.skipTo);
    if (target > index) return target;
  }
  return steps.length;
}
const assigneeLabels = {
  districtElder: "the person's district elder",
  account: "a chosen officer",
  requestDeacons: "the request's deacons",
};
export function describeStep(
  step: WorkflowStep,
  names: Record<string, string> = {},
) {
  switch (step.kind) {
    case "wait":
      return `Wait ${step.days} day${step.days === 1 ? "" : "s"}`;
    case "condition":
      return `Continue if ${conditionLabels[step.test].toLowerCase()}, otherwise ${
        step.onFalse === "end" ? "end" : `skip to ${step.skipTo}`
      }`;
    case "task":
      return `Task for ${
        step.assignTo === "account" && names[step.uid]
          ? names[step.uid]
          : assigneeLabels[step.assignTo]
      }: ${step.title}, due in ${step.dueInDays} day${step.dueInDays === 1 ? "" : "s"}${
        step.waitForCompletion ? ", then wait until it is done" : ""
      }`;
    case "approval":
      return `Approval by ${step.approverRoles.join(", ")}: ${step.title}${
        step.allowSelfApproval ? "" : " (not by the person who started it)"
      }`;
    case "message":
      return `${step.channel === "email" ? "Email" : "Text"} the person${
        step.subject ? `: ${step.subject}` : ""
      }`;
  }
}

// Editable starting points. Accounts are chosen before publishing.
export const WORKFLOW_TEMPLATES: Record<
  "visitorFollowUp" | "memberOnboarding" | "bereavementCare",
  Omit<WorkflowDraft, "id">
> = {
  visitorFollowUp: {
    name: "Visitor follow-up",
    description:
      "Thank a new visitor, arrange a welcome call and invite them back.",
    trigger: { kind: "visitorRecorded" },
    steps: [
      {
        id: "thank-you",
        kind: "message",
        channel: "email",
        subject: "Thank you for worshipping with us",
        body: "Dear {FirstName},\n\nThank you for joining us for worship at {ChurchName}. We were glad to meet you.",
      },
      { id: "pause", kind: "wait", days: 2 },
      {
        id: "welcome-call",
        kind: "task",
        title: "Welcome call to a new visitor",
        assignTo: "account",
        uid: "",
        dueInDays: 3,
        waitForCompletion: true,
      },
      { id: "two-weeks", kind: "wait", days: 14 },
      {
        id: "still-visiting",
        kind: "condition",
        test: "stillVisitor",
        onFalse: "end",
        skipTo: "",
      },
      {
        id: "invite-back",
        kind: "message",
        channel: "email",
        subject: "You are welcome at {ChurchName}",
        body: "Dear {FirstName},\n\nWe would be glad to see you again on the Lord's Day.",
      },
    ],
  },
  memberOnboarding: {
    name: "New member welcome",
    description:
      "Welcome a new member, arrange a household visit and confirm the roll.",
    trigger: { kind: "membershipReceived", statuses: ["communicant"] },
    steps: [
      {
        id: "welcome",
        kind: "message",
        channel: "email",
        subject: "Welcome to the membership of {ChurchName}",
        body: "Dear {FirstName},\n\nThe Session gives thanks for your membership and looks forward to serving you.",
      },
      {
        id: "roll-check",
        kind: "approval",
        title: "Confirm the roll entry and membership date",
        approverRoles: ["clerk", "pastor"],
        allowSelfApproval: false,
      },
      {
        id: "elder-visit",
        kind: "task",
        title: "Visit the new member's household",
        assignTo: "districtElder",
        uid: "",
        dueInDays: 30,
        waitForCompletion: false,
      },
    ],
  },
  bereavementCare: {
    name: "Bereavement care",
    description: "Reach out before and after the anniversary of a loss.",
    trigger: {
      kind: "importantDate",
      source: "bereavementDates",
      dateKinds: [],
      daysBefore: 7,
    },
    steps: [
      {
        id: "before",
        kind: "task",
        title: "Call or visit before an anniversary",
        assignTo: "districtElder",
        uid: "",
        dueInDays: 5,
        waitForCompletion: false,
      },
      { id: "after-date", kind: "wait", days: 8 },
      {
        id: "after",
        kind: "task",
        title: "Follow up after an anniversary",
        assignTo: "districtElder",
        uid: "",
        dueInDays: 3,
        waitForCompletion: false,
      },
    ],
  },
};
