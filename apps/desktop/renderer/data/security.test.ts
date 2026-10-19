import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  calls: [] as { name: string; input: unknown }[],
  answer: (() => ({ pending: true })) as (
    name: string,
    input: unknown,
  ) => unknown,
}));
vi.mock("./firebase", () => ({ auth: mocks.auth, functions: {} }));
vi.mock("../platform", () => ({
  native: undefined,
  staffSecurityUrl: () => "http://localhost:5174/staff-security",
}));
vi.mock("firebase/functions", () => ({
  httpsCallable:
    (_functions: unknown, name: string) => async (input: unknown) => {
      mocks.calls.push({ name, input });
      return { data: mocks.answer(name, input) };
    },
}));
vi.mock("firebase/auth", () => ({
  signInWithCustomToken: vi.fn(async () => ({})),
}));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn() }));

import { signInWithCustomToken } from "firebase/auth";
import { browserStaffSignIn } from "./security";

const part = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
// The shape of a Firebase custom token, unsigned as the Auth emulator makes it.
const tokenFor = (uid: string) =>
  `${part({ alg: "none", typ: "JWT" })}.${part({ uid, claims: { passkeySession: "fictional" } })}.`;

describe("browserStaffSignIn", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.auth.currentUser = null;
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      open: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  it("signs in whichever account approves from the sign-in screen", async () => {
    mocks.answer = () => ({ token: tokenFor("fictional-other") });
    await browserStaffSignIn(() => {});
    expect(mocks.calls[0].input).not.toHaveProperty("sameAccount");
    expect(signInWithCustomToken).toHaveBeenCalledWith(
      mocks.auth,
      tokenFor("fictional-other"),
    );
  });

  it("asks the server for the same account and signs in when it matches", async () => {
    mocks.auth.currentUser = { uid: "fictional-elder" };
    mocks.answer = () => ({ token: tokenFor("fictional-elder") });
    await browserStaffSignIn(() => {}, { sameAccount: true });
    expect(mocks.calls[0]).toMatchObject({
      name: "completeDesktopSignIn",
      input: { sameAccount: true },
    });
    expect(signInWithCustomToken).toHaveBeenCalledTimes(1);
  });

  it("stops before signing in when another account approved", async () => {
    mocks.auth.currentUser = { uid: "fictional-elder" };
    mocks.answer = () => ({ token: tokenFor("fictional-other") });
    await expect(
      browserStaffSignIn(() => {}, { sameAccount: true }),
    ).rejects.toThrow("Approve with the account signed in on this PC.");
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("stops before signing in when no one is signed in on this PC", async () => {
    mocks.answer = () => ({ token: tokenFor("fictional-elder") });
    await expect(
      browserStaffSignIn(() => {}, { sameAccount: true }),
    ).rejects.toThrow("Approve with the account signed in on this PC.");
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });
});
