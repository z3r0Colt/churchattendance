import { describe, expect, it } from "vitest";
import {
  annualStatistics,
  approvalOn,
  attendanceInputSchema,
  communionDecisionSchema,
  communionFlags,
  communionParticipation,
  healthIndicators,
  modeCounts,
  type CommunionDecision,
  type CommunionRecord,
  type Service,
} from "./index.js";

const decision = (
  id: string,
  extra: Partial<CommunionDecision>,
): CommunionDecision => ({
  id,
  personId: "amos",
  approved: true,
  kind: "member",
  effectiveOn: "2026-01-01",
  until: "",
  note: "",
  authorUid: "elder",
  createdAt: `2026-01-01T00:00:0${id.length}Z`,
  ...extra,
});
const service = (
  date: string,
  present: Service["present"],
  serviceTypeId = "am",
): Service => ({
  id: `${serviceTypeId}_${date}`,
  serviceTypeId,
  date,
  notes: "",
  present,
  lastAttendancePersonId: "",
});
const mark = (mode?: "inPerson" | "online") => ({
  at: null,
  method: "roll" as const,
  byUid: "u",
  ...(mode ? { mode } : {}),
});

describe("communion approval", () => {
  it("takes the latest decision on or before the date, and visiting approvals lapse", () => {
    const rows = [
      decision("a", { effectiveOn: "2026-01-01" }),
      decision("b", { effectiveOn: "2026-05-01", approved: false }),
      decision("c", {
        personId: "vera",
        kind: "visiting",
        effectiveOn: "2026-06-01",
        until: "2026-06-07",
      }),
    ];
    expect(approvalOn(rows, "amos", "2025-12-31")).toBeNull();
    expect(approvalOn(rows, "amos", "2026-03-01")?.approved).toBe(true);
    expect(approvalOn(rows, "amos", "2026-05-01")?.approved).toBe(false);
    expect(approvalOn(rows, "vera", "2026-06-07")?.approved).toBe(true);
    expect(approvalOn(rows, "vera", "2026-06-08")?.approved).toBe(false);
  });
  it("orders same-day decisions by when they were recorded", () => {
    const rows = [
      decision("x", { approved: false, createdAt: "2026-01-01T10:00:00Z" }),
      decision("y", { approved: true, createdAt: "2026-01-01T11:00:00Z" }),
    ];
    expect(approvalOn(rows, "amos", "2026-01-01")?.approved).toBe(true);
  });
  it("allows a last day only on a visiting approval", () => {
    const base = {
      id: "d",
      personId: "vera",
      approved: true,
      kind: "visiting",
      effectiveOn: "2026-06-01",
    };
    expect(
      communionDecisionSchema.safeParse({ ...base, until: "2026-06-07" })
        .success,
    ).toBe(true);
    expect(
      communionDecisionSchema.safeParse({
        ...base,
        kind: "member",
        until: "2026-06-07",
      }).success,
    ).toBe(false);
    expect(
      communionDecisionSchema.safeParse({ ...base, until: "2026-05-01" })
        .success,
    ).toBe(false);
  });
  it("flags partakers not approved, not marked present or worshipping online", () => {
    const at = service("2026-06-07", {
      amos: mark("inPerson"),
      beth: mark("online"),
    });
    expect(
      communionFlags(
        { personIds: ["amos", "beth", "cal"], date: "2026-06-07" },
        at,
        [decision("a", {}), decision("b", { personId: "beth" })],
      ),
    ).toEqual([
      { personId: "beth", flags: ["Marked as worshipping online"] },
      {
        personId: "cal",
        flags: ["Not on the approved list on this date", "Not marked present"],
      },
    ]);
  });
  it("summarizes the last 12 months of recorded communion services", () => {
    const records: CommunionRecord[] = [
      ["2025-09-01", ["amos"]],
      ["2026-01-04", ["amos"]],
      ["2026-04-05", []],
    ].map(([date, personIds]) => ({
      id: String(date),
      serviceId: `am_${date}`,
      serviceTypeId: "am",
      date: date as string,
      personIds: personIds as string[],
      revision: 1,
    }));
    const recent = communionParticipation(records, "amos", "2026-10-19");
    expect(recent).toEqual({ services: 2, partook: 1 });
    const indicator = healthIndicators(
      {
        attendancePercent: undefined,
        groups: 0,
        serving: 0,
        involvementRecorded: false,
        contact: undefined,
        lastVisit: "",
        visitRecordsSince: "",
        communion: recent,
      },
      {
        indicators: ["communion"],
        attendanceWeeks: 12,
        attendanceBelowPercent: 50,
        visitWithinDays: 365,
      },
      "2026-10-19",
    );
    expect(indicator[0]).toEqual({
      key: "communion",
      state: "info",
      explanation:
        "Partook at 1 of 2 recorded communion services in the last 12 months.",
    });
  });
});

describe("in-person and online worship", () => {
  it("counts each person once, with unrecorded modes as in person", () => {
    expect(
      modeCounts(
        service("2026-10-18", {
          a: mark(),
          b: mark("inPerson"),
          c: mark("online"),
        }),
      ),
    ).toEqual({ inPerson: 2, online: 1, unclassified: 1, total: 3 });
  });
  it("refuses an online kiosk mark", () => {
    expect(
      attendanceInputSchema.safeParse({
        personId: "a",
        present: true,
        method: "kiosk",
        mode: "online",
      }).success,
    ).toBe(false);
    expect(
      attendanceInputSchema.parse({
        personId: "a",
        present: true,
        method: "roll",
      }).mode,
    ).toBe("inPerson");
  });
  it("keeps the statistical average in person unless combined is chosen", () => {
    const services = [
      service("2026-10-04", { a: mark(), b: mark("online") }),
      service("2026-10-11", {
        a: mark("inPerson"),
        b: mark("online"),
        c: mark("online"),
      }),
    ];
    const measure = (mode: "inPerson" | "combined", name: string) =>
      annualStatistics([], [], [], services, 2026, ["am"], mode).find(
        (row) => row.Measure === name,
      )?.Count;
    expect(measure("inPerson", "Average recorded Lord's Day attendance")).toBe(
      1,
    );
    expect(measure("combined", "Average recorded Lord's Day attendance")).toBe(
      2.5,
    );
    expect(
      measure("inPerson", "Average recorded Lord's Day online attendance"),
    ).toBe(1.5);
  });
});
