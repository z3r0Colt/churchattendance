import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  steps: [] as string[],
  local: { type: "LOCAL" },
  session: { type: "SESSION" },
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
  browserLocalPersistence: mocks.local,
  browserSessionPersistence: mocks.session,
  setPersistence: vi.fn(async () => {
    mocks.steps.push("setPersistence");
  }),
  signInWithCustomToken: vi.fn(async () => {
    mocks.steps.push("signInWithCustomToken");
    return {};
  }),
}));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn() }));

import { setPersistence, signInWithCustomToken } from "firebase/auth";
import { browserStaffSignIn } from "./security";

const part = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
// The shape of a Firebase custom token, unsigned as the Auth emulator makes it.
const tokenFor = (uid: string) =>
  `${part({ alg: "none", typ: "JWT" })}.${part({ uid, claims: { passkeySession: "fictional" } })}.`;

describe("browserStaffSignIn", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.steps.length = 0;
    mocks.auth.currentUser = null;
    mocks.answer = () => ({ pending: true });
    vi.clearAllMocks();
    // Read the timers when called, so fake timers apply.
    vi.stubGlobal("window", {
      open: vi.fn(),
      setTimeout: (run: () => void, ms: number) =>
        globalThis.setTimeout(run, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) =>
        globalThis.clearTimeout(id),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it("lasts until the app closes when Keep this PC signed in is off", async () => {
    mocks.answer = () => ({ token: tokenFor("fictional-elder") });
    await browserStaffSignIn(() => {}, { keep: false });
    expect(mocks.steps).toEqual(["setPersistence", "signInWithCustomToken"]);
    expect(setPersistence).toHaveBeenCalledWith(mocks.auth, mocks.session);
  });

  it("keeps the PC signed in when Keep this PC signed in is on", async () => {
    mocks.answer = () => ({ token: tokenFor("fictional-elder") });
    await browserStaffSignIn(() => {}, { keep: true });
    expect(mocks.steps).toEqual(["setPersistence", "signInWithCustomToken"]);
    expect(setPersistence).toHaveBeenCalledWith(mocks.auth, mocks.local);
  });

  it("leaves the current choice alone when confirming or opening security", async () => {
    mocks.auth.currentUser = { uid: "fictional-elder" };
    mocks.answer = () => ({ token: tokenFor("fictional-elder") });
    // Confirm in browser.
    await browserStaffSignIn(() => {}, { sameAccount: true });
    // Open browser sign-in and passkeys on the Account security page.
    await browserStaffSignIn(() => {});
    expect(signInWithCustomToken).toHaveBeenCalledTimes(2);
    expect(setPersistence).not.toHaveBeenCalled();
  });

  it("changes nothing when cancelled as the browser answers", async () => {
    const controller = new AbortController();
    mocks.answer = () => {
      controller.abort();
      return { token: tokenFor("fictional-elder") };
    };
    await expect(
      browserStaffSignIn(() => {}, { keep: true, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(setPersistence).not.toHaveBeenCalled();
    expect(signInWithCustomToken).not.toHaveBeenCalled();
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

  it("does not start when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.answer = () => ({ token: tokenFor("fictional-elder") });
    await expect(
      browserStaffSignIn(() => {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.calls).toEqual([]);
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("stops waiting at once when cancelled between checks", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const controller = new AbortController();
    const outcome = browserStaffSignIn(() => {}, {
      signal: controller.signal,
    }).catch((cause: unknown) => cause);
    // The first check has been answered and the 1.5 second wait has begun.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    expect(mocks.calls).toHaveLength(1);
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(vi.getTimerCount()).toBe(0);
    expect(await outcome).toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.calls).toHaveLength(1);
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("signs nobody in when cancelled while the browser answers", async () => {
    const controller = new AbortController();
    mocks.answer = () => {
      controller.abort();
      return { token: tokenFor("fictional-elder") };
    };
    await expect(
      browserStaffSignIn(() => {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("stops polling when cancelled during a check", async () => {
    const controller = new AbortController();
    mocks.answer = () => {
      controller.abort();
      return { pending: true };
    };
    await expect(
      browserStaffSignIn(() => {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.calls).toHaveLength(1);
  });
});
