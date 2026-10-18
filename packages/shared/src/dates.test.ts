import { describe, expect, it } from "vitest";
import {
  bereavementDateSchema,
  importantDateSchema,
  nextReminder,
  occurrenceForYear,
  occurrenceIn,
  reminderChange,
  reminderDueOn,
} from "./index";

const row = (patch: object = {}) =>
  importantDateSchema.parse({
    id: "d1",
    personId: "ruth",
    kind: "weddingAnniversary",
    date: "2001-06-09",
    remindDaysBefore: 3,
    ...patch,
  });

describe("important date occurrences", () => {
  it("places Feb 29 on Feb 28 in other years and keeps it in leap years", () => {
    expect(occurrenceIn("2024-02-29", 2025)).toBe("2025-02-28");
    expect(occurrenceIn("2024-02-29", 2028)).toBe("2028-02-29");
    expect(occurrenceIn("2001-06-09", 2026)).toBe("2026-06-09");
  });
  it("counts anniversaries and honors the end conditions", () => {
    expect(occurrenceForYear(row(), 2001)).toBeNull();
    expect(occurrenceForYear(row(), 2026)).toMatchObject({
      date: "2026-06-09",
      anniversary: 25,
      remindOn: "2026-06-06",
    });
    const death = row({ date: "2025-03-10", endKind: "count", endCount: 3 });
    expect(occurrenceForYear(death, 2028)?.anniversary).toBe(3);
    expect(occurrenceForYear(death, 2029)).toBeNull();
    expect(
      occurrenceForYear(row({ endKind: "year", endYear: 2026 }), 2027),
    ).toBeNull();
    expect(
      importantDateSchema.safeParse({
        id: "d1",
        personId: "ruth",
        kind: "weddingAnniversary",
        date: "2001-06-09",
        endKind: "count",
      }).success,
    ).toBe(false);
  });
  it("never makes up a reminder whose day has passed", () => {
    expect(nextReminder(row(), "2026-06-07")).toMatchObject({
      date: "2027-06-09",
      remindOn: "2027-06-06",
    });
    expect(reminderDueOn(row(), "2026-06-06")?.date).toBe("2026-06-09");
    expect(reminderDueOn(row(), "2026-06-07")).toBeNull();
    expect(reminderDueOn(row(), "2026-06-05")).toBeNull();
  });
  it("crosses the new year when the reminder comes before Jan 1", () => {
    const newYear = row({ date: "2000-01-01", remindDaysBefore: 3 });
    expect(reminderDueOn(newYear, "2026-12-29")?.date).toBe("2027-01-01");
    expect(nextReminder(newYear, "2026-12-30")?.date).toBe("2028-01-01");
  });
  it("uses the Feb 28 reminder for a leap-day date", () => {
    const leap = row({ date: "2024-02-29", remindDaysBefore: 0 });
    expect(reminderDueOn(leap, "2025-02-28")?.date).toBe("2025-02-28");
    expect(reminderDueOn(leap, "2025-03-01")).toBeNull();
  });
  it("explains what an edit does to the waiting reminder", () => {
    expect(reminderChange(row(), row(), "2026-05-01")).toBe(
      "The reminder on 2026-06-06 for 2026-06-09 is unchanged.",
    );
    expect(
      reminderChange(row(), row({ date: "2001-07-01" }), "2026-05-01"),
    ).toBe(
      "The waiting reminder on 2026-06-06 for 2026-06-09 will not be sent. The next reminder will be on 2026-06-28 for 2026-07-01.",
    );
    expect(
      reminderChange(
        row(),
        row({ endKind: "year", endYear: 2025 }),
        "2026-05-01",
      ),
    ).toContain("No further reminders will be sent.");
  });
  it("keeps bereavement dates about a living person and a different related person", () => {
    const base = {
      id: "b1",
      personId: "ruth",
      relatedPersonId: "james",
      kind: "deathAnniversary",
      date: "2025-03-10",
    };
    expect(bereavementDateSchema.safeParse(base).success).toBe(true);
    expect(
      bereavementDateSchema.safeParse({ ...base, relatedPersonId: "ruth" })
        .success,
    ).toBe(false);
  });
});
