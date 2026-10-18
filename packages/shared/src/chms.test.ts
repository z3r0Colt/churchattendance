import { describe, expect, it } from "vitest";
import {
  annualStatistics,
  directoryRows,
  eventOccurrences,
  eventSchema,
  groupSchema,
  kioskSetupSchema,
  meetingSummary,
  membershipAt,
  personInputSchema,
  reminderWindow,
  sacramentSchema,
  type ChurchEvent,
  type HistoryEvent,
  type Service,
} from "./index";
const person = {
  ...personInputSchema.parse({
    firstName: "Mara",
    lastName: "Willow",
    householdId: "willow",
    membershipStatus: "communicant",
  }),
  id: "mara",
};
const history: HistoryEvent[] = [
  {
    id: "z",
    personId: "mara",
    date: "2026-01-01",
    fromStatus: null,
    toStatus: "baptized",
    method: "initial",
    otherChurch: "",
    reason: "Initial roll",
  },
  {
    id: "a",
    personId: "mara",
    date: "2027-03-07",
    fromStatus: "baptized",
    toStatus: "communicant",
    method: "profession",
    otherChurch: "",
    reason: "Profession of faith",
  },
];
const event = {
  ...eventSchema.parse({
    id: "fellowship",
    title: "Fellowship",
    start: "2027-03-07T15:30:00Z",
    end: "2027-03-07T16:30:00Z",
    location: "Hall",
    recurrence: "weekly",
    until: "2027-03-28",
    capacity: 2,
  }),
  revision: 1,
} as ChurchEvent;
describe("event recurrence", () => {
  it("keeps the church wall time across daylight saving time", () => {
    const rows = eventOccurrences(
      event,
      "2027-03-01",
      "2027-03-31",
      "America/Indiana/Indianapolis",
    );
    expect(rows).toHaveLength(4);
    expect(rows[0].start).toBe("2027-03-07T15:30:00.000Z");
    expect(rows[1].start).toBe("2027-03-14T14:30:00.000Z");
  });
  it("respects an inclusive final date and a requested date window", () => {
    expect(
      eventOccurrences(
        event,
        "2027-03-14",
        "2027-03-21",
        "America/Indiana/Indianapolis",
      ).map((row) => row.date),
    ).toEqual(["2027-03-14", "2027-03-21"]);
  });
  it("does not move a monthly meeting on the 31st to the 28th", () => {
    expect(
      eventOccurrences(
        {
          ...event,
          start: "2027-01-31T15:30:00Z",
          end: "2027-01-31T16:30:00Z",
          recurrence: "monthly",
          until: "2027-05-31",
        },
        "2027-01-01",
        "2027-06-01",
        "America/Indiana/Indianapolis",
      ).map((row) => row.date),
    ).toEqual(["2027-01-31", "2027-03-31", "2027-05-31"]);
  });
  it("omits cancelled occurrences", () => {
    expect(
      eventOccurrences(
        { ...event, cancelled: true },
        "2027-01-01",
        "2027-12-31",
        "UTC",
      ),
    ).toEqual([]);
  });
  it("requires a finite recurrence and a valid duration", () => {
    expect(
      eventSchema.safeParse({
        ...event,
        revision: undefined,
        expectedRevision: 0,
        until: "",
      }).success,
    ).toBe(false);
    expect(
      eventSchema.safeParse({ ...event, revision: undefined, end: event.start })
        .success,
    ).toBe(false);
  });
});
describe("serving reminder time", () => {
  const row = {
    date: "2027-03-14",
    time: "10:30",
    reminderHours: 24,
    personId: "mara",
    cancelled: false,
  };
  it("becomes due at the reminder boundary and expires at the service", () => {
    expect(
      reminderWindow(
        row,
        new Date("2027-03-13T14:29:59Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toBe(false);
    expect(
      reminderWindow(
        row,
        new Date("2027-03-13T14:30:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toBe(true);
    expect(
      reminderWindow(
        row,
        new Date("2027-03-14T14:30:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toBe(false);
  });
  it("does not send a reminder for a gap or cancelled assignment", () => {
    expect(
      reminderWindow(
        { ...row, personId: "" },
        new Date("2027-03-14T12:00:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toBe(false);
    expect(
      reminderWindow(
        { ...row, cancelled: true },
        new Date("2027-03-14T12:00:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toBe(false);
  });
});
describe("historical statistics", () => {
  it("reconstructs baptized and communicant membership at year boundaries", () => {
    expect(membershipAt(person, history, "2026-12-31")).toBe("baptized");
    expect(membershipAt(person, history, "2027-12-31")).toBe("communicant");
    expect(membershipAt(person, history, "2025-12-31")).toBeNull();
  });
  it("chains changes on one day instead of ordering by random document ID", () => {
    expect(
      membershipAt(
        person,
        [...history.map((row) => ({ ...row, date: "2027-03-07" }))],
        "2027-03-07",
      ),
    ).toBe("communicant");
  });
  it("does not invent historical membership for people without history", () => {
    expect(membershipAt(person, [], "2026-01-01")).toBeNull();
    const rows = annualStatistics([person], [], [], [], 2027, []);
    expect(
      rows.find((row) => row.Measure === "People missing membership history")
        ?.Count,
    ).toBe(1);
  });
  it("counts profession from the baptized roll and explicit infant/adult baptisms", () => {
    const rows = annualStatistics(
      [person],
      history,
      [
        {
          id: "b",
          personId: "mara",
          type: "baptism",
          date: "2027-02-01",
          category: "adult",
        },
      ],
      [],
      2027,
      [],
    );
    expect(
      rows.find((row) => row.Measure === "Received by profession")?.Count,
    ).toBe(1);
    expect(rows.find((row) => row.Measure === "adult baptisms")?.Count).toBe(1);
    expect(rows.find((row) => row.Measure === "baptized at start")?.Count).toBe(
      1,
    );
  });
  it("averages only recorded selected Lord's Day services", () => {
    const service = (date: string, n: number) =>
      ({
        id: date,
        date,
        serviceTypeId: "am",
        present: Object.fromEntries(
          Array.from({ length: n }, (_, i) => [String(i), {}]),
        ),
      }) as Service;
    const rows = annualStatistics(
      [person],
      history,
      [],
      [
        service("2027-03-07", 10),
        service("2027-03-14", 20),
        service("2027-03-15", 90),
      ],
      2027,
      ["am"],
    );
    expect(
      rows.find(
        (row) => row.Measure === "Average recorded Lord's Day attendance",
      )?.Count,
    ).toBe(15);
  });
  it("keeps all twelve months and does not create unrecorded services", () => {
    const rows = meetingSummary([person], history, [], 2027, ["am"]);
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.Services === 0 && row.Average === 0)).toBe(
      true,
    );
  });
  it("requires a baptism classification", () => {
    expect(
      sacramentSchema.safeParse({
        id: "b",
        personId: "mara",
        type: "baptism",
        date: "2027-01-01",
        place: "Church",
        officiant: "Minister",
      }).success,
    ).toBe(false);
  });
  it("omits deceased, former and visitor people from the directory", () => {
    const rows = directoryRows(
      [
        person,
        { ...person, id: "dead", isDeceased: true },
        { ...person, id: "visitor", membershipStatus: "visitor" },
      ],
      [{ id: "willow", name: "Willow", address: "", homePhone: "" }],
    );
    expect(rows[0].people.map((row) => row.id)).toEqual(["mara"]);
  });
  it("validates group size and a nontrivial numeric kiosk PIN", () => {
    expect(
      groupSchema.safeParse({
        id: "g",
        name: "Choir",
        type: "choir",
        leaderPersonId: "",
        memberIds: [],
        schedule: "Weekly",
      }).success,
    ).toBe(true);
    expect(
      kioskSetupSchema.safeParse({ enabled: true, pin: "1234" }).success,
    ).toBe(false);
    expect(
      kioskSetupSchema.safeParse({ enabled: true, pin: "718294" }).success,
    ).toBe(true);
  });
});
