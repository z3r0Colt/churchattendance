import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  afterCondition,
  approvalRefusal,
  describeStep,
  migrationIndex,
  workflowDraftSchema,
  workflowProblems,
  workflowStepSchema,
  type WorkflowStep,
} from "./index";

const visitor = WORKFLOW_TEMPLATES.visitorFollowUp;
const withAccount = (steps: WorkflowStep[]) =>
  steps.map((step) =>
    step.kind === "task" && step.assignTo === "account"
      ? { ...step, uid: "hollis" }
      : step,
  );

describe("workflow drafts", () => {
  it("accepts every template as a draft and lists what publishing needs", () => {
    for (const template of Object.values(WORKFLOW_TEMPLATES))
      expect(
        workflowDraftSchema.safeParse({ id: "w1", ...template }).success,
      ).toBe(true);
    expect(workflowProblems(visitor)).toEqual([
      "Step 3 needs someone to assign the task to.",
    ]);
    expect(
      workflowProblems({ ...visitor, steps: withAccount(visitor.steps) }),
    ).toEqual([]);
    expect(workflowProblems(WORKFLOW_TEMPLATES.memberOnboarding)).toEqual([]);
    expect(workflowProblems(WORKFLOW_TEMPLATES.bereavementCare)).toEqual([]);
  });
  it("allows only greeting merge fields in messages", () => {
    const message = (body: string) =>
      workflowStepSchema.safeParse({
        id: "m",
        kind: "message",
        channel: "sms",
        body,
      }).success;
    expect(message("Dear {FirstName} {LastName} of {ChurchName}")).toBe(true);
    expect(message("Your service is at {ServiceTime}")).toBe(false);
    expect(message("A stray { brace")).toBe(false);
    expect(message("")).toBe(false);
  });
  it("refuses backward skips, request-only steps elsewhere and a trailing wait", () => {
    const steps: WorkflowStep[] = [
      { id: "a", kind: "wait", days: 1 },
      {
        id: "b",
        kind: "condition",
        test: "requestOpen",
        onFalse: "skipTo",
        skipTo: "a",
      },
      {
        id: "c",
        kind: "task",
        title: "Bring a meal",
        assignTo: "requestDeacons",
        uid: "",
        dueInDays: 1,
        waitForCompletion: false,
      },
      { id: "d", kind: "wait", days: 2 },
    ];
    expect(
      workflowProblems({ trigger: { kind: "visitorRecorded" }, steps }),
    ).toEqual([
      "Step 2 checks a request, but this workflow does not start from one.",
      "Step 2 must skip forward to a later step.",
      "Step 3 goes to a request's deacons, but this workflow does not start from a request.",
      "End the workflow with an action, not a wait.",
    ]);
    expect(
      workflowDraftSchema.safeParse({
        id: "w",
        name: "Duplicate",
        trigger: { kind: "visitorRecorded" },
        steps: [steps[0], steps[0]],
      }).success,
    ).toBe(false);
  });
});

describe("workflow runs", () => {
  const approval = WORKFLOW_TEMPLATES.memberOnboarding.steps[1] as Extract<
    WorkflowStep,
    { kind: "approval" }
  >;
  it("refuses self-approval unless the step allows it, and roles outside the step", () => {
    expect(
      approvalRefusal(
        approval,
        { uid: "wren", roles: ["clerk"] },
        { startedBy: "wren" },
      ),
    ).toBe("You started this run, so another officer must approve it.");
    expect(
      approvalRefusal(
        approval,
        { uid: "hollis", roles: ["elder"] },
        { startedBy: "wren" },
      ),
    ).toBe("Your role cannot approve this step.");
    expect(
      approvalRefusal(
        approval,
        { uid: "calder", roles: ["pastor"] },
        { startedBy: "wren" },
      ),
    ).toBe("");
    expect(
      approvalRefusal(
        { ...approval, allowSelfApproval: true },
        { uid: "wren", roles: ["clerk"] },
        { startedBy: "wren" },
      ),
    ).toBe("");
  });
  it("moves a run to a new version only where its current step still exists", () => {
    const next = [visitor.steps[0], visitor.steps[2], visitor.steps[5]];
    expect(migrationIndex(visitor.steps, next, 2)).toBe(1);
    expect(migrationIndex(visitor.steps, next, 1)).toBe(-1);
    expect(migrationIndex(visitor.steps, next, 9)).toBe(-1);
  });
  it("continues, ends or skips forward after a condition", () => {
    const steps = visitor.steps;
    expect(afterCondition(steps, 4, true)).toBe(5);
    expect(afterCondition(steps, 4, false)).toBe(steps.length);
    const skipping = steps.map((step) =>
      step.id === "still-visiting"
        ? { ...step, onFalse: "skipTo" as const, skipTo: "invite-back" }
        : step,
    );
    expect(afterCondition(skipping, 4, false)).toBe(5);
  });
  it("describes steps in plain words", () => {
    expect(describeStep(visitor.steps[1])).toBe("Wait 2 days");
    expect(
      describeStep({ ...visitor.steps[2], uid: "hollis" } as WorkflowStep, {
        hollis: "Elder Hollis",
      }),
    ).toBe(
      "Task for Elder Hollis: Welcome call to a new visitor, due in 3 days, then wait until it is done",
    );
    expect(describeStep(approval)).toBe(
      "Approval by clerk, pastor: Confirm the roll entry and membership date (not by the person who started it)",
    );
  });
});
