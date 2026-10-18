import { describe, expect, it } from "vitest";
import {
  SUGGESTED_ASSESSMENT_LABELS,
  assessmentSchema,
  healthIndicators,
  healthSettingsSchema,
  type ContactFlag,
  type HealthInputs,
} from "./index";

const settings = healthSettingsSchema.parse({});
const today = "2027-03-01";
const inputs: HealthInputs = {
  attendancePercent: 75,
  groups: 1,
  serving: 2,
  involvementRecorded: true,
  contact: undefined,
  lastVisit: "",
  visitRecordsSince: "",
};
const flag = (state: ContactFlag["state"]): ContactFlag => ({
  personId: "mara",
  state,
  thresholdDays: 60,
  rule: "church",
  lastContact:
    state === "current"
      ? { personId: "mara", date: "2027-02-01", source: "call", refId: "n" }
      : null,
  measuredFrom: "2026-10-01",
  dueDate: "2026-11-30",
  daysPastDue: state === "gap" ? 91 : 0,
});
const byKey = (rows: ReturnType<typeof healthIndicators>) =>
  Object.fromEntries(rows.map((row) => [row.key, row.state]));

describe("health indicators", () => {
  it("restates recorded facts against the Session's policy", () => {
    expect(
      byKey(
        healthIndicators(
          {
            ...inputs,
            contact: flag("current"),
            lastVisit: "2026-09-01",
          },
          settings,
          today,
        ),
      ),
    ).toEqual({
      attendance: "within",
      involvement: "info",
      contact: "within",
      visit: "within",
      communion: "unknown",
      relationships: "unknown",
    });
    const below = healthIndicators(
      {
        ...inputs,
        attendancePercent: 40,
        contact: flag("gap"),
        lastVisit: "2025-12-01",
      },
      settings,
      today,
    );
    expect(byKey(below)).toMatchObject({
      attendance: "below",
      contact: "below",
      visit: "below",
    });
    expect(below.find((row) => row.key === "contact")!.explanation).toBe(
      "No qualifying contact for 151 days. Policy is 60 days.",
    );
  });
  it("keeps missing inputs unknown instead of treating them as concerns", () => {
    const rows = byKey(
      healthIndicators(
        {
          ...inputs,
          attendancePercent: "Review history",
          involvementRecorded: false,
          contact: flag("unknown"),
          visitRecordsSince: "2026-12-01",
        },
        settings,
        today,
      ),
    );
    expect(rows).toEqual({
      attendance: "unknown",
      involvement: "unknown",
      contact: "unknown",
      visit: "unknown",
      communion: "unknown",
      relationships: "unknown",
    });
    expect(
      byKey(
        healthIndicators(
          { ...inputs, attendancePercent: "No eligible services" },
          settings,
          today,
        ),
      ).attendance,
    ).toBe("unknown");
  });
  it("flags a missing visit only after records cover the policy period", () => {
    expect(
      byKey(
        healthIndicators(
          { ...inputs, visitRecordsSince: "2025-12-01" },
          settings,
          today,
        ),
      ).visit,
    ).toBe("below");
  });
  it("shows only the indicators the Session enabled", () => {
    expect(
      healthIndicators(
        inputs,
        { ...settings, indicators: ["attendance", "visit"] },
        today,
      ).map((row) => row.key),
    ).toEqual(["attendance", "visit"]);
  });
});

describe("assessments", () => {
  it("offers the suggested labels without requiring them", () => {
    expect(healthSettingsSchema.parse({}).labels).toEqual([]);
    expect(
      healthSettingsSchema.parse({ labels: SUGGESTED_ASSESSMENT_LABELS })
        .labels,
    ).toHaveLength(4);
    expect(
      healthSettingsSchema.safeParse({
        labels: [
          { id: "a", name: "First" },
          { id: "a", name: "Again" },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires reasons and a review date on or after the assessment", () => {
    const base = {
      id: "a1",
      personId: "mara",
      assessedOn: "2027-03-01",
      reviewOn: "2027-06-01",
    };
    expect(
      assessmentSchema.safeParse({ ...base, reasons: "Observed by the elder" })
        .success,
    ).toBe(true);
    expect(assessmentSchema.safeParse({ ...base, reasons: "" }).success).toBe(
      false,
    );
    expect(
      assessmentSchema.safeParse({
        ...base,
        reasons: "Observed",
        reviewOn: "2027-02-01",
      }).success,
    ).toBe(false);
  });
});
