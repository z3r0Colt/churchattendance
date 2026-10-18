import { describe, expect, it } from "vitest";
import {
  archiveJsonParts,
  churchSettingsSchema,
  exportPageSchema,
  exportPathAllowed,
  saveServiceTypeSchema,
} from "./administration";
import { savePersonSchema } from "./domain";
describe("administration validation", () => {
  it("preserves Unicode and long document JSON across workbook cells", () => {
    const json = JSON.stringify({
      text: "a".repeat(29990) + "\u{1f333}" + "b".repeat(35000),
    });
    const parts = archiveJsonParts(json);
    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.every(
        (part) => part.length <= 30000 && !/[\uD800-\uDBFF]$/.test(part),
      ),
    ).toBe(true);
    expect(JSON.parse(parts.join(""))).toEqual(JSON.parse(json));
  });
  it("rejects invalid church zones, empty names and embedded credentials", () => {
    const base = {
      name: "Sycamore RPC",
      address: "",
      timeZone: "America/Indiana/Indianapolis",
    };
    expect(churchSettingsSchema.safeParse(base).success).toBe(true);
    expect(
      churchSettingsSchema.safeParse({ ...base, timeZone: "Church/Local" })
        .success,
    ).toBe(false);
    expect(churchSettingsSchema.safeParse({ ...base, name: " " }).success).toBe(
      false,
    );
    expect(
      churchSettingsSchema.safeParse({ ...base, password: "example" }).success,
    ).toBe(false);
  });
  it("requires a valid service time and revision", () => {
    const base = {
      id: "am",
      name: "Lord's Day Morning",
      dayOfWeek: 0,
      defaultTime: "10:30",
      isActive: true,
      expectedRevision: 0,
    };
    expect(saveServiceTypeSchema.safeParse(base).success).toBe(true);
    for (const patch of [
      { dayOfWeek: 7 },
      { defaultTime: "24:00" },
      { expectedRevision: -1 },
    ])
      expect(
        saveServiceTypeSchema.safeParse({ ...base, ...patch }).success,
      ).toBe(false);
  });
  it("keeps profile expectations partial and rejects private fields", () => {
    expect(
      savePersonSchema.parse({
        id: "alex",
        changes: { preferredName: "Al" },
        expected: { preferredName: "" },
      }).expected,
    ).toEqual({ preferredName: "" });
    expect(
      savePersonSchema.safeParse({
        id: "alex",
        changes: { disciplineFlag: true },
      }).success,
    ).toBe(false);
  });
  it("restricts export collections and nested document roots", () => {
    for (const collection of [
      "kioskConfiguration",
      "bulletinLinks",
      "communicationSuppressions",
      "portalBudgets",
      "messages",
    ])
      expect(exportPageSchema.safeParse({ collection }).success).toBe(false);
    expect(
      exportPathAllowed(
        "membershipEvents",
        "people/alex/membershipEvents/initial",
      ),
    ).toBe(true);
    expect(
      exportPathAllowed(
        "membershipEvents",
        "sessionPrivate/alex/membershipEvents/initial",
      ),
    ).toBe(false);
    expect(exportPathAllowed("rsvps", "events/meal/rsvps/date_alex")).toBe(
      true,
    );
    expect(exportPathAllowed("people", "people/alex/careNotes/private")).toBe(
      false,
    );
    expect(exportPathAllowed("settings", "settings/church")).toBe(true);
    expect(exportPathAllowed("settings", "settings/secret")).toBe(false);
  });
});
