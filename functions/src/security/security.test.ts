import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, unseal, type KeyRing } from "./encryption.js";
import { hasAssurance, recentAuthentication } from "./policy.js";
const now = Date.now(),
  authTime = Math.floor(now / 1000);
const token = {
  auth_time: authTime,
  email_verified: true,
  firebase: { sign_in_second_factor: "totp" },
};
const access = { enabled: true, roles: ["elder"], validAfter: 0 };
const ring: KeyRing = {
  active: "one",
  keys: { one: randomBytes(32).toString("base64") },
};
describe("staff assurance", () => {
  it("requires completed signed MFA, verified email and enabled current access", () => {
    expect(hasAssurance(token, "elder", access, null, now)).toBe(true);
    expect(
      hasAssurance(
        { ...token, firebase: {}, assured: true },
        "elder",
        access,
        null,
        now,
      ),
    ).toBe(false);
    expect(
      hasAssurance(
        { ...token, email_verified: false },
        "elder",
        access,
        null,
        now,
      ),
    ).toBe(false);
    expect(
      hasAssurance(token, "elder", { ...access, enabled: false }, null, now),
    ).toBe(false);
    expect(
      hasAssurance(token, "elder", { ...access, locked: true }, null, now),
    ).toBe(false);
    expect(
      hasAssurance(
        token,
        "elder",
        { ...access, validAfter: authTime + 1 },
        null,
        now,
      ),
    ).toBe(false);
  });
  it("binds passkey assurance to a server session, owner, expiry and revocation generation", () => {
    const custom = { ...token, firebase: {}, passkeySession: "signed-nonce" },
      session = { uid: "elder", validAfter: 0, expiresAt: now + 1000 };
    expect(hasAssurance(custom, "elder", access, session, now)).toBe(true);
    expect(hasAssurance(custom, "elder", access, null, now)).toBe(false);
    expect(
      hasAssurance(
        custom,
        "elder",
        access,
        { ...session, uid: "another" },
        now,
      ),
    ).toBe(false);
    expect(
      hasAssurance(custom, "elder", access, { ...session, validAfter: 1 }, now),
    ).toBe(false);
    expect(
      hasAssurance(
        custom,
        "elder",
        access,
        { ...session, expiresAt: now },
        now,
      ),
    ).toBe(false);
  });
  it("rejects stale or future authentication for sensitive account changes", () => {
    expect(recentAuthentication(authTime, now)).toBe(true);
    expect(recentAuthentication(authTime - 301, now)).toBe(false);
    expect(recentAuthentication(authTime + 60, now)).toBe(false);
  });
});
describe("private record encryption", () => {
  it("authenticates record paths, randomizes ciphertext and detects tampering", () => {
    const secret = {
        body: "Fictional confidential care",
        disciplineHistory: [{ entry: "Fictional" }],
      },
      path = "careNotes/example";
    const first = seal(secret, path, ring),
      second = seal(secret, path, ring);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain(secret.body);
    expect(unseal(first, path, ring)).toEqual(secret);
    expect(() => unseal(first, "careNotes/another", ring)).toThrow();
    expect(() =>
      unseal({ ...first, tag: randomBytes(16).toString("base64") }, path, ring),
    ).toThrow();
    expect(() =>
      unseal(first, path, {
        active: "one",
        keys: { one: randomBytes(32).toString("base64") },
      }),
    ).toThrow();
  });
  it("keeps previous keys readable while rotated records use the active version", () => {
    const old = seal({ body: "Fictional" }, "careNotes/old", ring),
      rotated = {
        active: "two",
        keys: { ...ring.keys, two: randomBytes(32).toString("base64") },
      };
    expect(unseal(old, "careNotes/old", rotated)).toEqual({
      body: "Fictional",
    });
    const next = seal(
      unseal(old, "careNotes/old", rotated),
      "careNotes/old",
      rotated,
    );
    expect(next.key).toBe("two");
    expect(unseal(next, "careNotes/old", rotated)).toEqual({
      body: "Fictional",
    });
    expect(() => unseal(next, "careNotes/old", ring)).toThrow();
  });
});
