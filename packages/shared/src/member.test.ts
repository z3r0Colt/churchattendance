import { describe, expect, it } from "vitest";
import { memberReturnTab, safeReturnPath } from "./index";

describe("member sign-in return path", () => {
  it("keeps only known portal tabs on the portal origin", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/?tab=events")).toBe("/?tab=events");
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
