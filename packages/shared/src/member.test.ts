import { describe, expect, it } from "vitest";
import {
  isAdultOn,
  memberContactSchema,
  memberRequestProgress,
  memberRequestSchema,
  memberReturnTab,
  photoMatchesType,
  safeReturnPath,
  sessionRequestTransition,
} from "./index";

describe("member sign-in return path", () => {
  it("keeps only known portal tabs on the portal origin", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/?tab=events")).toBe("/?tab=events");
    expect(safeReturnPath("/?tab=home")).toBe("/?tab=home");
    expect(memberReturnTab("/?tab=account")).toBe("account");
  });
  it("rejects other origins, paths and tabs", () => {
    for (const value of [
      null,
      "",
      "https://example.test/",
      "//example.test/",
      "/\\example.test",
      "/staff-security",
      "/?tab=unknown",
      "/?tab=events&next=https://example.test",
      "javascript:alert(1)",
      "/?tab=EVENTS",
    ])
      expect(safeReturnPath(value)).toBe("/");
  });
});

describe("member self-service rules", () => {
  it("needs a recorded birth date of eighteen years for household edits", () => {
    expect(isAdultOn("2008-10-18", "2026-10-18")).toBe(true);
    expect(isAdultOn("2008-10-19", "2026-10-18")).toBe(false);
    expect(isAdultOn("", "2026-10-18")).toBe(false);
    expect(isAdultOn("not-a-date", "2026-10-18")).toBe(false);
    // A leap-day birthday reaches eighteen on Feb 28.
    expect(isAdultOn("2008-02-29", "2026-02-28")).toBe(true);
    expect(isAdultOn("2008-02-29", "2026-02-27")).toBe(false);
  });
  it("checks image bytes against the declared type", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
    const webp = new Uint8Array([...Buffer.from("RIFF0000WEBPVP8 ")]);
    expect(photoMatchesType(jpeg, "image/jpeg")).toBe(true);
    expect(photoMatchesType(jpeg, "image/png")).toBe(false);
    expect(photoMatchesType(webp, "image/webp")).toBe(true);
    expect(
      photoMatchesType(new Uint8Array([...Buffer.from("<svg>")]), "image/jpeg"),
    ).toBe(false);
  });
  it("pairs every changed contact field with its starting value", () => {
    const ok = memberContactSchema.safeParse({
      changes: { mobilePhone: "2025550101" },
      expected: { mobilePhone: "" },
    });
    expect(ok.success).toBe(true);
    for (const value of [
      { changes: {}, expected: {} },
      { changes: { email: "a@example.test" }, expected: {} },
      { changes: { smsOptIn: true }, expected: { smsOptIn: false } },
      {
        changes: { email: "a@example.test" },
        expected: { email: "" },
        personId: "other",
      },
    ])
      expect(memberContactSchema.safeParse(value).success).toBe(false);
  });
});

describe("member requests", () => {
  it("routes by kind and accepts help fields only for practical requests", () => {
    const requestId = "6f1c1f7e-3d64-4c38-9a53-2f3b8c3a9e10";
    expect(
      memberRequestSchema.safeParse({ requestId, kind: "prayer", body: "Hi" })
        .success,
    ).toBe(true);
    for (const value of [
      { requestId, kind: "prayer", body: "Hi", category: "meals" },
      { requestId, kind: "practical", body: "Hi" },
      { requestId, kind: "prayer", body: "   " },
      { requestId, kind: "prayer", body: "Hi", audience: "deacons" },
      { requestId: "not-a-uuid", kind: "prayer", body: "Hi" },
    ])
      expect(memberRequestSchema.safeParse(value).success).toBe(false);
  });
  it("moves Session requests forward only", () => {
    expect(sessionRequestTransition("received", "acknowledged")).toBe(true);
    expect(sessionRequestTransition("received", "closed")).toBe(true);
    expect(sessionRequestTransition("acknowledged", "closed")).toBe(true);
    expect(sessionRequestTransition("closed", "acknowledged")).toBe(false);
    expect(sessionRequestTransition("acknowledged", "received")).toBe(false);
  });
  it("tells members progress without outcomes or reasons", () => {
    expect(memberRequestProgress("new")).toBe("Received");
    expect(memberRequestProgress("approved")).toBe("Deacons assigned");
    expect(memberRequestProgress("declined")).toBe("Closed");
    expect(memberRequestProgress("resolved")).toBe("Completed");
  });
});
