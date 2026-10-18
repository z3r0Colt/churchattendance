import { describe, expect, it } from "vitest";
import {
  canCompleteVisit,
  completeVisitSchema,
  personInputSchema,
  roundCoverage,
  visitReminderDue,
  visitRoundSchema,
  visitSchema,
  visitState,
  visitWorkload,
  visitableHouseholds,
} from "./index";

const zone = "America/Indiana/Indianapolis";
const plan = {
  id: "v1",
  householdId: "willow",
  start: "2026-11-02T23:00:00.000Z",
  officerUids: ["elder-a"],
};
const visit = (
  id: string,
  start: string,
  status: "planned" | "completed" | "cancelled",
  officerUids = ["elder-a"],
) => ({ id, start, status, durationMinutes: 60, officerUids });

describe("visit plans", () => {
  it("defaults a plan and refuses a completed status from the planning form", () => {
    const row = visitSchema.parse(plan);
    expect(row).toMatchObject({
      status: "planned",
      durationMinutes: 60,
      reminderHours: 24,
      deaconUids: [],
      purpose: "",
    });
    expect(
      visitSchema.safeParse({ ...plan, status: "completed" }).success,
    ).toBe(false);
  });
  it("requires distinct participants and keeps deacons out of the officer list", () => {
    expect(
      visitSchema.safeParse({ ...plan, officerUids: ["elder-a", "elder-a"] })
        .success,
    ).toBe(false);
    expect(
      visitSchema.safeParse({ ...plan, deaconUids: ["elder-a"] }).success,
    ).toBe(false);
    expect(visitSchema.safeParse({ ...plan, officerUids: [] }).success).toBe(
      false,
    );
  });
  it("asks for a reason when a visit is cancelled", () => {
    expect(
      visitSchema.safeParse({ ...plan, status: "cancelled" }).success,
    ).toBe(false);
    expect(
      visitSchema.safeParse({
        ...plan,
        status: "cancelled",
        cancelReason: "Family away",
      }).success,
    ).toBe(true);
  });
  it("accepts one completion record shape at a time", () => {
    const base = { id: "v1", expectedRevision: 1 };
    expect(
      completeVisitSchema.safeParse({ ...base, record: { kind: "none" } })
        .success,
    ).toBe(true);
    expect(
      completeVisitSchema.safeParse({
        ...base,
        record: { kind: "create", noteId: "n1", personId: "mara", body: "" },
      }).success,
    ).toBe(false);
    expect(
      completeVisitSchema.safeParse({
        ...base,
        record: { kind: "link", careNoteId: "n1", body: "extra" },
      }).success,
    ).toBe(false);
  });
  it("bounds a visit round to about a year", () => {
    const round = { id: "r", name: "2027 visits" };
    expect(
      visitRoundSchema.safeParse({
        ...round,
        startDate: "2027-01-01",
        endDate: "2027-12-31",
      }).success,
    ).toBe(true);
    expect(
      visitRoundSchema.safeParse({
        ...round,
        startDate: "2027-01-01",
        endDate: "2026-12-31",
      }).success,
    ).toBe(false);
    expect(
      visitRoundSchema.safeParse({
        ...round,
        startDate: "2027-01-01",
        endDate: "2028-06-30",
      }).success,
    ).toBe(false);
  });
});

describe("visit state and workload", () => {
  const now = new Date("2026-11-10T15:00:00.000Z");
  it("keeps a passed plan overdue rather than treating scheduling as contact", () => {
    expect(
      visitState(visit("a", "2026-11-12T15:00:00.000Z", "planned"), now),
    ).toBe("upcoming");
    expect(
      visitState(visit("b", "2026-11-09T15:00:00.000Z", "planned"), now),
    ).toBe("overdue");
    // The visit is still in progress during its scheduled hour.
    expect(
      visitState(visit("c", "2026-11-10T14:30:00.000Z", "planned"), now),
    ).toBe("upcoming");
    expect(
      visitState(visit("d", "2026-11-09T15:00:00.000Z", "cancelled"), now),
    ).toBe("cancelled");
  });
  it("completes only planned visits whose start has passed", () => {
    expect(
      canCompleteVisit({ status: "planned", start: now.toISOString() }, now),
    ).toBe(true);
    expect(
      canCompleteVisit(
        { status: "planned", start: "2026-11-10T15:00:01.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      canCompleteVisit(
        { status: "completed", start: "2026-11-01T15:00:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
  it("counts each officer once per visit and limits finished work to the chosen church dates", () => {
    const rows = visitWorkload(
      [
        visit("up", "2026-11-12T15:00:00.000Z", "planned", ["a", "b"]),
        visit("late", "2026-10-01T15:00:00.000Z", "planned", ["a"]),
        visit("done", "2026-11-01T15:00:00.000Z", "completed", ["a"]),
        visit("old", "2025-11-01T15:00:00.000Z", "completed", ["a"]),
        // 9:30 PM in Indiana on Oct 31, although it is Nov 1 in UTC.
        visit("edge", "2026-11-01T01:30:00.000Z", "cancelled", ["b"]),
      ],
      now,
      zone,
      "2026-11-01",
      "2026-11-30",
    );
    expect(rows).toEqual([
      {
        uid: "a",
        upcoming: ["up"],
        overdue: ["late"],
        completed: ["done"],
        cancelled: [],
      },
      {
        uid: "b",
        upcoming: ["up"],
        overdue: [],
        completed: [],
        cancelled: [],
      },
    ]);
  });
  it("sends a reminder only inside its window and never for cancelled or past plans", () => {
    const row = {
      status: "planned" as const,
      start: "2026-11-11T14:00:00.000Z",
      reminderHours: 24,
    };
    expect(visitReminderDue(row, now)).toBe(true);
    expect(visitReminderDue({ ...row, reminderHours: 12 }, now)).toBe(false);
    expect(visitReminderDue({ ...row, reminderHours: 0 }, now)).toBe(false);
    expect(visitReminderDue({ ...row, status: "cancelled" }, now)).toBe(false);
    expect(
      visitReminderDue({ ...row, start: "2026-11-10T14:00:00.000Z" }, now),
    ).toBe(false);
  });
});

describe("visit rounds", () => {
  const person = (
    id: string,
    householdId: string,
    membershipStatus: string,
  ) => ({
    ...personInputSchema.parse({
      firstName: id,
      lastName: householdId,
      householdId,
      membershipStatus,
    }),
    id,
  });
  const households = ["willow", "ash", "fern", "reed"].map((id) => ({
    id,
    name: id,
    address: "",
    homePhone: "",
  }));
  it("includes households with a member or adherent and leaves out visitor-only or former households", () => {
    expect(
      visitableHouseholds(
        [
          person("a", "willow", "communicant"),
          person("b", "ash", "adherent"),
          person("c", "fern", "visitor"),
          person("d", "reed", "former"),
        ],
        households,
      ).map((row) => row.id),
    ).toEqual(["willow", "ash"]);
  });
  it("uses only visits assigned to the round and prefers a completed visit", () => {
    expect(
      roundCoverage(
        "r1",
        [
          {
            id: "1",
            roundId: "r1",
            householdId: "willow",
            status: "cancelled",
          },
          {
            id: "2",
            roundId: "r1",
            householdId: "willow",
            status: "completed",
          },
          { id: "3", roundId: "r1", householdId: "ash", status: "planned" },
          { id: "4", roundId: "", householdId: "fern", status: "completed" },
        ],
        households.slice(0, 3),
      ),
    ).toEqual([
      { householdId: "willow", state: "visited", visitIds: ["1", "2"] },
      { householdId: "ash", state: "planned", visitIds: ["3"] },
      { householdId: "fern", state: "notScheduled", visitIds: [] },
    ]);
  });
});
