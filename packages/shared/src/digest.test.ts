import { describe, expect, it } from "vitest";
import {
  absencePeople,
  communicationSettingsSchema,
  digestClock,
  digestText,
  mergeFields,
  personInputSchema,
  type Service,
} from "./index";

const zone = "America/Indiana/Indianapolis";
const settings = communicationSettingsSchema.parse({
  absenceEnabled: true,
  dailySummaryEnabled: true,
});

describe("digest schedule", () => {
  it("uses the church-local weekday and hour, not UTC", () => {
    // 1:30 AM UTC on Tuesday is still 9:30 PM Monday in the church time zone.
    expect(
      digestClock(new Date("2026-11-03T02:30:00Z"), zone, settings),
    ).toMatchObject({ date: "2026-11-02", weekly: true, daily: true });
    expect(
      digestClock(new Date("2026-11-02T13:59:00Z"), zone, settings),
    ).toMatchObject({ date: "2026-11-02", weekly: false, daily: true });
    expect(
      digestClock(new Date("2026-11-02T14:00:00Z"), zone, settings).weekly,
    ).toBe(true);
  });
  it("sends nothing when the digest and summary are turned off", () => {
    const off = communicationSettingsSchema.parse({});
    expect(
      digestClock(new Date("2026-11-02T20:00:00Z"), zone, off),
    ).toMatchObject({ weekly: false, daily: false });
  });
  it("bounds the configurable settings", () => {
    for (const bad of [
      { absenceWeeks: 1 },
      { digestWeekday: 0 },
      { digestHour: 24 },
      { digestChannel: "fax" },
    ])
      expect(communicationSettingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("digest text", () => {
  const sections = [
    { title: "Contact gaps", names: ["Mara Willow", "Tobias {Reed}"] },
    { title: "Overdue visits", names: [] },
    { title: "Visits today", names: ["6:00 PM · Willow"] },
  ];
  it("lists names by email and only counts by text, with no empty sections", () => {
    const email = digestText(sections, "email", "Nov 2, 2026");
    expect(email).toContain("Contact gaps (2)\nMara Willow\nTobias Reed");
    expect(email).not.toContain("Overdue visits");
    const sms = digestText(sections, "sms", "Nov 2, 2026");
    expect(sms).toBe(
      "Shepherding summary for {FirstName}, Nov 2, 2026: Contact gaps 2, Visits today 1. Open the church app for details.",
    );
    expect(sms).not.toContain("Mara");
    // Every digest must survive the queue's merge-field pass.
    expect(() => mergeFields(email, { FirstName: "Silas" })).not.toThrow();
  });
  it("returns nothing when there is nothing to report", () => {
    expect(
      digestText([{ title: "Contact gaps", names: [] }], "email", ""),
    ).toBe("");
  });
});

describe("configurable absence", () => {
  const person = {
    ...personInputSchema.parse({
      firstName: "Mara",
      lastName: "Willow",
      householdId: "willow",
      membershipStatus: "communicant",
    }),
    id: "mara",
  };
  const service = (date: string, present: string[] = []): Service => ({
    id: `am_${date}`,
    serviceTypeId: "am",
    date,
    notes: "",
    present: Object.fromEntries(
      present.map((id) => [id, { at: null, method: "roll", byUid: "u" }]),
    ),
    lastAttendancePersonId: "",
  });
  const monday = new Date("2026-11-02T15:00:00Z");
  it("requires every one of the configured recorded Lord's Days", () => {
    const three = [
      service("2026-11-01"),
      service("2026-10-25"),
      service("2026-10-18"),
    ];
    expect(absencePeople([person], three, "am", monday, zone, 3)).toHaveLength(
      1,
    );
    expect(absencePeople([person], three, "am", monday, zone, 4)).toHaveLength(
      0,
    );
    expect(
      absencePeople(
        [person],
        [...three, service("2026-10-11", ["mara"])],
        "am",
        monday,
        zone,
        4,
      ),
    ).toHaveLength(0);
    expect(
      absencePeople(
        [person],
        [...three.slice(0, 2), service("2026-10-18", ["mara"])],
        "am",
        monday,
        zone,
        2,
      ),
    ).toHaveLength(1);
  });
});

describe("deacon digest", () => {
  it("runs at the church-local hour only when turned on", () => {
    const on = communicationSettingsSchema.parse({
      deaconDigestEnabled: true,
      deaconDigestHour: 8,
    });
    // 12:30 UTC is 8:30 AM in the church time zone in November.
    expect(
      digestClock(new Date("2026-11-02T12:30:00Z"), zone, on).deacon,
    ).toBe(false);
    expect(
      digestClock(new Date("2026-11-02T13:30:00Z"), zone, on).deacon,
    ).toBe(true);
    expect(
      digestClock(new Date("2026-11-02T20:00:00Z"), zone, settings).deacon,
    ).toBe(false);
  });
  it("uses its own heading and still sends counts only by text", () => {
    const sections = [
      { title: "Your open requests", names: ["Calder · Meals"] },
    ];
    expect(
      digestText(sections, "email", "Nov 2, 2026", "Mercy ministry summary"),
    ).toContain("Mercy ministry summary for Nov 2, 2026.\n\nYour open requests (1)\nCalder · Meals");
    const text = digestText(
      sections,
      "sms",
      "Nov 2, 2026",
      "Mercy ministry summary",
    );
    expect(text).toContain("Mercy ministry summary for {FirstName}");
    expect(text).not.toContain("Calder");
  });
});
