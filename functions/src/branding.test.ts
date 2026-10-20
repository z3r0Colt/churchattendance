import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, role: "admin", writes: 0 }));
vi.mock("firebase-functions/v2/https", async (original) => ({
  ...(await original<object>()), onCall: (handler: unknown) => handler,
}));
vi.mock("./communications/environment.js", () => ({ emulatorMode: () => true }));
vi.mock("./access.js", () => ({
  parse: (schema: { parse: (value: unknown) => unknown }, value: unknown) => schema.parse(value),
  requireRoles: async (_request: unknown, roles: string[]) => {
    if (!roles.includes(state.role)) throw new Error("permission-denied");
    return { uid: "fictional-admin" };
  },
}));
function snapshot() { return { exists: Object.keys(state.data).length > 0, data: () => state.data, get: (field: string) => state.data[field] }; }
vi.mock("./admin.js", () => ({ db: {
  doc: () => ({ get: async () => snapshot() }),
  runTransaction: async (fn: (tx: unknown) => unknown) => fn({
    get: async () => snapshot(), set: (_ref: unknown, value: Record<string, unknown>) => { state.data = value; state.writes++; },
  }),
} }));
import { getPublicBranding, getBrandingSettings, savePublicBranding } from "./branding.js";
const call = (handler: unknown, data: unknown = {}) => (handler as (request: { data: unknown }) => Promise<unknown>)({ data });
const fields = { churchName: "Cedar Reformed Church", appName: "Cedar" };
beforeEach(() => { vi.stubEnv("GCLOUD_PROJECT", "demo-sycamore"); vi.stubEnv("CHURCH_ID", "demo-church"); state.data = {}; state.role = "admin"; state.writes = 0; });
describe("branding API boundary", () => {
  it("publishes only reviewed fields and never copies legacy protected settings", async () => {
    await call(savePublicBranding, { ...fields, expectedRevision: 0 });
    state.data.privateAddress = "private"; state.data.provider = "secret";
    state.role = "anonymous";
    const result = await call(getPublicBranding) as Record<string, unknown>;
    expect(result.churchName).toBe(fields.churchName);
    expect(result).not.toHaveProperty("updatedBy"); expect(result).not.toHaveProperty("privateAddress"); expect(result).not.toHaveProperty("provider");
  });
  it("refuses unauthorized writes and protected settings reads", async () => {
    for (const role of ["anonymous", "readOnly", "elder", "deacon", "attendanceVolunteer"]) {
      state.role = role;
      await expect(call(savePublicBranding, { ...fields, expectedRevision: 0 })).rejects.toThrow("permission-denied");
      await expect(call(getBrandingSettings)).rejects.toThrow("permission-denied");
    }
    expect(state.writes).toBe(0);
  });
  it("uses revisions and supports explicit empty legacy migration without writes on reads", async () => {
    expect(await call(getBrandingSettings)).toEqual({ branding: null, revision: 0 });
    await expect(call(getPublicBranding)).rejects.toThrow("not configured");
    expect(state.writes).toBe(0);
    await call(savePublicBranding, { ...fields, expectedRevision: 0 });
    await expect(call(savePublicBranding, { ...fields, appName: "Overwrite", expectedRevision: 0 })).rejects.toThrow("changed");
    expect(state.data.appName).toBe("Cedar"); expect(state.writes).toBe(1);
  });
  it("fails closed on a branding/project mismatch", async () => {
    await call(savePublicBranding, { ...fields, expectedRevision: 0 });
    state.data.projectId = "other-project";
    await expect(call(getPublicBranding)).rejects.toThrow("not configured");
  });
  it("rejects fake PNG data even when its base64 prefix looks correct", async () => {
    await expect(call(savePublicBranding, { ...fields, expectedRevision: 0, logo: "data:image/png;base64,iVBORw0KGgoAAAAA" })).rejects.toThrow("PNG logo");
    expect(state.writes).toBe(0);
  });
});
