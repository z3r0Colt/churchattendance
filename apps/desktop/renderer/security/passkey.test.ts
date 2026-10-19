import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase/auth";

const mocks = vi.hoisted(() => ({
  steps: [] as string[],
  session: { type: "SESSION" },
}));
vi.mock("firebase/auth", () => ({
  browserSessionPersistence: mocks.session,
  setPersistence: vi.fn(async () => {
    mocks.steps.push("setPersistence");
  }),
  signInWithCustomToken: vi.fn(async () => {
    mocks.steps.push("signInWithCustomToken");
    return {};
  }),
}));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(async () => {
    mocks.steps.push("startAuthentication");
    return { id: "fictional-credential", type: "public-key" };
  }),
}));

import { setPersistence, signInWithCustomToken } from "firebase/auth";
import { passkeySignIn } from "./passkey";

const auth = { name: "fictional-auth" } as unknown as Auth;
const part = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
// The shape of a Firebase custom token, unsigned as the Auth emulator makes it.
const tokenFor = (uid: string) =>
  `${part({ alg: "none", typ: "JWT" })}.${part({ uid, claims: { passkeySession: "fictional" } })}.`;
function server(uid: string) {
  return vi.fn(async (name: string) => {
    mocks.steps.push(name);
    return name === "beginPasskeySignIn"
      ? { id: "fictional-challenge", options: { challenge: "abc" } }
      : { token: tokenFor(uid) };
  }) as unknown as <T>(name: string, input: unknown) => Promise<T>;
}

describe("passkeySignIn", () => {
  beforeEach(() => {
    mocks.steps.length = 0;
    vi.clearAllMocks();
  });

  it("keeps the sign-in to this tab before signing in", async () => {
    await passkeySignIn(auth, server("fictional-elder"), "elder@example.test");
    expect(mocks.steps).toEqual([
      "beginPasskeySignIn",
      "startAuthentication",
      "finishPasskeySignIn",
      "setPersistence",
      "signInWithCustomToken",
    ]);
    expect(setPersistence).toHaveBeenCalledWith(auth, mocks.session);
    expect(signInWithCustomToken).toHaveBeenCalledWith(
      auth,
      tokenFor("fictional-elder"),
    );
  });

  it("signs in when the passkey is for the expected account", async () => {
    await passkeySignIn(
      auth,
      server("fictional-elder"),
      "elder@example.test",
      "fictional-elder",
    );
    expect(setPersistence).toHaveBeenCalledWith(auth, mocks.session);
    expect(signInWithCustomToken).toHaveBeenCalledTimes(1);
  });

  it("stops before signing in when the passkey is for another account", async () => {
    await expect(
      passkeySignIn(
        auth,
        server("fictional-other"),
        "elder@example.test",
        "fictional-elder",
      ),
    ).rejects.toThrow();
    expect(setPersistence).not.toHaveBeenCalled();
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("stops before signing in when the token carries no account", async () => {
    await expect(
      passkeySignIn(
        auth,
        vi.fn(async (name: string) =>
          name === "beginPasskeySignIn"
            ? { id: "fictional-challenge", options: { challenge: "abc" } }
            : { token: "not-a-token" },
        ) as unknown as <T>(name: string, input: unknown) => Promise<T>,
        "elder@example.test",
        "fictional-elder",
      ),
    ).rejects.toThrow();
    expect(setPersistence).not.toHaveBeenCalled();
    expect(signInWithCustomToken).not.toHaveBeenCalled();
  });
});
