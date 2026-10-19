import { describe, expect, it } from "vitest";
import {
  guessMapping,
  importChanges,
  importDecisionSchema,
  importHouseholdId,
  importStartSchema,
  looksLikeFormula,
  normalizeImportRow,
  parseImportDate,
  parseImportStatus,
  previewImport,
} from "./index.js";

const defaults = { status: "" as const, statusDate: "2026-10-19" };
const roll = [
  {
    id: "p1",
    firstName: "Ivy",
    lastName: "Thorne",
    email: "ivy@example.test",
    mobilePhone: "+12025550111",
    birthDate: "1980-04-04",
  },
];

describe("imports", () => {
  it("suggests columns from common header names, once each", () => {
    expect(
      guessMapping([
        "First Name",
        "Surname",
        "E-mail",
        "Cell",
        "Phone",
        "Notes",
      ]),
    ).toEqual(["firstName", "lastName", "email", "mobilePhone", "", ""]);
  });
  it("reads ISO and US dates and refuses two-digit years", () => {
    expect(parseImportDate("2021-05-09")).toBe("2021-05-09");
    expect(parseImportDate("5/9/2021")).toBe("2021-05-09");
    expect(parseImportDate("5/9/21")).toBeNull();
    expect(parseImportDate("2021-02-30")).toBeNull();
    expect(parseImportDate("")).toBe("");
  });
  it("reads status codes, labels and common spellings", () => {
    expect(parseImportStatus("Communicant Member")).toBe("communicant");
    expect(parseImportStatus("non-resident")).toBe("nonResident");
    expect(parseImportStatus("Baptised")).toBe("baptized");
    expect(parseImportStatus("member")).toBeNull();
  });
  it("refuses formula-like cells but keeps phone numbers and signed numbers", () => {
    expect(looksLikeFormula("=SUM(A1)")).toBe(true);
    expect(looksLikeFormula("@cmd")).toBe(true);
    expect(looksLikeFormula("+1 202 555 0100")).toBe(false);
    expect(looksLikeFormula("-")).toBe(true);
    const { errors } = normalizeImportRow(
      {
        firstName: "=HYPERLINK(1)",
        lastName: "Row",
        membershipStatus: "visitor",
      },
      defaults,
      1,
    );
    expect(errors).toEqual(["First name looks like a spreadsheet formula"]);
  });
  it("normalizes contacts and defaults, and groups households", () => {
    const { value } = normalizeImportRow(
      {
        firstName: " Ivy ",
        lastName: "Thorne",
        email: "IVY@Example.test",
        mobilePhone: "(202) 555-0111",
        address: "1 Elm St",
      },
      { status: "adherent", statusDate: "2026-10-19" },
      4,
    );
    expect(value).toMatchObject({
      firstName: "Ivy",
      email: "ivy@example.test",
      mobilePhone: "+12025550111",
      membershipStatus: "adherent",
      statusDate: "2026-10-19",
      method: "initial",
      householdKey: "thorne|1 elm st",
      householdName: "Thorne",
      emailConsent: false,
    });
    expect(importHouseholdId("b1", "thorne|1 elm st")).toBe(
      importHouseholdId("b1", "thorne|1 elm st"),
    );
    expect(importHouseholdId("b1", "a")).not.toBe(importHouseholdId("b1", "b"));
  });
  it("reports bad rows, duplicates in the file and possible matches without writing", () => {
    const rows = previewImport(
      [
        { firstName: "Ivy", lastName: "Thorne", membershipStatus: "visitor" },
        {
          firstName: "Max",
          lastName: "Reed",
          email: "max@example",
          membershipStatus: "visitor",
        },
        {
          firstName: "Lu",
          lastName: "Fenn",
          membershipStatus: "visitor",
          emailConsent: "maybe",
        },
        {
          firstName: "Ana",
          lastName: "Wells",
          email: "ana@example.test",
          membershipStatus: "visitor",
        },
        {
          firstName: "Ana",
          lastName: "Wells",
          email: "ana@example.test",
          membershipStatus: "visitor",
        },
        { firstName: "New", lastName: "Person" },
      ],
      roll,
      defaults,
    );
    expect(rows.map((row) => [row.row, row.errors, row.candidates])).toEqual([
      [1, [], [{ personId: "p1", reason: "Same name" }]],
      [2, ["Email is not valid"], []],
      [3, ["Email consent must be yes or no"], []],
      [4, [], []],
      [5, ["Looks like the same person as row 4"], []],
      [6, ["Membership status is missing or not recognized"], []],
    ]);
  });
  it("needs consent evidence named before consent columns count", () => {
    const row = {
      row: 1,
      value: normalizeImportRow(
        { firstName: "A", lastName: "B", membershipStatus: "visitor" },
        defaults,
        1,
      ).value!,
      decision: { action: "create" },
    };
    const start = {
      batchId: "batch-0001",
      fileName: "roll.csv",
      consentReviewed: true,
      rows: [row],
    };
    expect(importStartSchema.safeParse(start).success).toBe(false);
    expect(
      importStartSchema.safeParse({ ...start, consentSource: "Signed cards" })
        .success,
    ).toBe(true);
    expect(
      importStartSchema.safeParse({
        ...start,
        consentReviewed: false,
        rows: [row, row],
      }).success,
    ).toBe(false);
  });
  it("updates only non-empty changed contact fields", () => {
    const { value } = normalizeImportRow(
      {
        firstName: "Ivy",
        lastName: "Thorne",
        email: "ivy@example.test",
        mobilePhone: "2025550199",
        membershipStatus: "communicant",
      },
      defaults,
      1,
    );
    expect(
      importChanges(value!, {
        email: "ivy@example.test",
        mobilePhone: "+12025550111",
        birthDate: "1980-04-04",
      }),
    ).toEqual({ mobilePhone: "+12025550199" });
    expect(
      importDecisionSchema.safeParse({
        action: "update",
        personId: "p1",
        expected: { membershipStatus: "visitor" },
      }).success,
    ).toBe(false);
  });
});
