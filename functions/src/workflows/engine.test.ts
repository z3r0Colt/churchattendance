import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
const state = vi.hoisted(() => ({
  run: {} as Record<string, unknown>,
  action: "paused",
}));
vi.mock("../admin.js", () => ({
  db: {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    runTransaction: async (run: (transaction: unknown) => unknown) =>
      run({
        get: async (ref: { path: string }) => snapshot(ref.path),
        update: (_ref: unknown, patch: Record<string, unknown>) =>
          Object.assign(state.run, patch),
      }),
  },
}));
function snapshot(path: string) {
  const data: Record<string, unknown> = path.startsWith("workflowRuns/")
    ? state.run
    : path.startsWith("workflowVersions/")
      ? {
          trigger: { kind: "visitorRecorded" },
          steps: [
            {
              id: "greeting",
              kind: "message",
              channel: "email",
              subject: "Welcome",
              body: "Welcome {FirstName}",
            },
          ],
        }
      : { status: "active" };
  return {
    exists: true,
    get: (key: string) => data[key],
    data: () => ({ ...data }),
  };
}
vi.mock("../communications/queue.js", () => ({
  getChurchZone: async () => "UTC",
  queueMessage: async () => {
    state.run.status = state.action;
    state.run.pausedFrom = "active";
    state.run.history = [
      { stepId: "control", kind: "control", outcome: state.action },
    ];
    return { pending: 1 };
  },
}));
import { processRun } from "./engine.js";
beforeEach(() => {
  state.action = "paused";
  state.run = {
    workflowId: "welcome",
    version: 1,
    subject: { personId: "fictional" },
    status: "active",
    stepIndex: 0,
    nextAt: Timestamp.fromMillis(0),
    startedAt: Timestamp.fromMillis(0),
    history: [],
    revision: 1,
    lease: null,
  };
});
describe("workflow completion accounting", () => {
  for (const action of ["paused", "cancelled"])
    it(`records queued work when ${action} during delivery creation`, async () => {
      state.action = action;
      expect(await processRun("welcome_fictional", new Date(), "UTC")).toBe(
        false,
      );
      expect(state.run.status).toBe(action);
      expect(state.run.stepIndex).toBe(1);
      expect(state.run.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stepId: "greeting", outcome: "queued" }),
        ]),
      );
      expect(state.run.lease).toBeNull();
      if (action === "paused") expect(state.run.pausedFrom).toBe("completed");
    });
});
