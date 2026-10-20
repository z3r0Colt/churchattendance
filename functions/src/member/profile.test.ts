import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  person: {
    photoPath: "photos/member/old.jpg" as string | undefined,
    photoVersion: 4,
  },
  deleted: [] as string[],
  uploaded: "",
  cleanupFails: false,
}));
vi.mock("firebase-functions/v2/https", async (original) => ({
  ...(await original<object>()),
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("../portal.js", () => ({
  portalOptions: {},
  member: async () => ({ uid: "member", person: { id: "member" } }),
}));
vi.mock("../communications/queue.js", () => ({
  getChurchZone: async () => "UTC",
}));
vi.mock("../admin.js", () => ({
  db: {
    doc: (path: string) => ({ path, delete: async () => undefined }),
    runTransaction: async (run: (transaction: unknown) => unknown) =>
      run({
        get: async (ref: { path: string }) => ({
          exists: true,
          get: (key: string) =>
            ref.path.startsWith("portalAccess/")
              ? (
                  { enabled: true, personId: "member" } as Record<
                    string,
                    unknown
                  >
                )[key]
              : (
                  {
                    ...state.person,
                    membershipStatus: "communicant",
                    isDeceased: false,
                  } as Record<string, unknown>
                )[key],
        }),
        set: () => undefined,
        update: (_ref: unknown, patch: Record<string, unknown>) =>
          Object.assign(state.person, patch),
      }),
  },
}));
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => ({
        save: async () => {
          state.uploaded = path;
        },
        delete: async () => {
          if (path.endsWith("old.jpg") && state.cleanupFails)
            throw new Error("cleanup failed");
          state.deleted.push(path);
        },
      }),
    }),
  }),
}));
import { saveMyPhoto } from "./profile.js";
const save = saveMyPhoto as unknown as (request: {
  data: unknown;
}) => Promise<unknown>;
const input = {
  expectedPhoto: true,
  expectedPhotoVersion: 4,
  contentType: "image/jpeg",
  data: Buffer.from([255, 216, 255, 224, 0, 0]).toString("base64"),
};
beforeEach(() => {
  state.person = { photoPath: "photos/member/old.jpg", photoVersion: 4 };
  state.deleted = [];
  state.uploaded = "";
  state.cleanupFails = false;
});
describe("photo commit and cleanup boundaries", () => {
  it("keeps the committed replacement when deleting the old object fails", async () => {
    state.cleanupFails = true;
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await expect(save({ data: input })).resolves.toEqual({ saved: true });
      expect(state.person.photoPath).toBe(state.uploaded);
      expect(state.person.photoVersion).toBe(5);
      expect(state.deleted).not.toContain(state.uploaded);
    } finally {
      warning.mockRestore();
    }
  });
  it("rejects a second replacement from the same existing-photo version", async () => {
    await save({ data: input });
    const committed = state.person.photoPath;
    await expect(save({ data: input })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(state.person.photoPath).toBe(committed);
    expect(state.deleted).toContain(state.uploaded);
    expect(state.deleted).not.toContain(committed);
  });
});
