import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  eventFromRecord,
  eventOccurrences,
  eventReminderSchema,
  foldLine,
  icsText,
  occurrenceChangeSchema,
  reminderDue,
  reminderMessage,
  reminderVersion,
  type ChurchEvent,
} from "./index";

const zone = "America/Indiana/Indianapolis";
const series: ChurchEvent = {
  id: "study",
  title: "Bible study",
  start: "2027-03-07T15:30:00.000Z",
  end: "2027-03-07T16:30:00.000Z",
  location: "Hall",
  recurrence: "weekly",
  interval: 1,
  until: "2027-03-28",
  capacity: 0,
  cancelled: false,
  revision: 3,
};

describe("occurrence changes", () => {
  it("cancels or moves one date while the others keep their wall time", () => {
    const rows = eventOccurrences(
      {
        ...series,
        exceptions: {
          "2027-03-14": { cancelled: true },
          "2027-03-21": {
            start: "2027-03-22T23:00:00.000Z",
            end: "2027-03-23T00:00:00.000Z",
            location: "Manse",
          },
        },
      },
      "2027-03-01",
      "2027-03-31",
      zone,
    );
    expect(rows.map((row) => row.date)).toEqual([
      "2027-03-07",
      "2027-03-21",
      "2027-03-28",
    ]);
    expect(rows[1]).toMatchObject({
      id: "study_2027-03-21",
      start: "2027-03-22T23:00:00.000Z",
      location: "Manse",
      changed: true,
    });
    // Daylight saving time began on Mar 14; the wall time stays 10:30 AM.
    expect(rows[2].start).toBe("2027-03-28T14:30:00.000Z");
  });
  it("can list cancelled occurrences for calendar feeds", () => {
    const rows = eventOccurrences(
      { ...series, exceptions: { "2027-03-14": { cancelled: true } } },
      "2027-03-01",
      "2027-03-31",
      zone,
      { includeCancelled: true },
    );
    expect(rows.filter((row) => row.cancelled).map((row) => row.id)).toEqual([
      "study_2027-03-14",
    ]);
    expect(
      eventOccurrences(
        { ...series, cancelled: true },
        "2027-03-01",
        "2027-03-31",
        zone,
        {
          includeCancelled: true,
        },
      ).every((row) => row.cancelled),
    ).toBe(true);
  });
  it("reads Timestamp-like moments from stored records", () => {
    const at = (iso: string) => ({ toDate: () => new Date(iso) });
    const event = eventFromRecord("study", {
      ...series,
      start: at(series.start),
      end: at(series.end),
      exceptions: {
        "2027-03-21": {
          start: at("2027-03-22T23:00:00Z"),
          end: at("2027-03-23T00:00:00Z"),
        },
      },
    });
    expect(event.start).toBe(series.start);
    expect(event.exceptions?.["2027-03-21"].start).toBe(
      "2027-03-22T23:00:00.000Z",
    );
  });
  it("validates the change being made", () => {
    const base = { eventId: "study", date: "2027-03-14", expectedRevision: 3 };
    expect(
      occurrenceChangeSchema.safeParse({ ...base, action: "cancel" }).success,
    ).toBe(true);
    expect(
      occurrenceChangeSchema.safeParse({
        ...base,
        action: "reschedule",
        start: "2027-03-14T16:00:00Z",
        end: "2027-03-14T15:00:00Z",
        location: "",
      }).success,
    ).toBe(false);
    expect(
      occurrenceChangeSchema.safeParse({
        ...base,
        action: "cancel",
        start: "2027-03-14T16:00:00Z",
      }).success,
    ).toBe(false);
  });
});

describe("iCalendar feeds", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    expect(icsText("Hall; room 2, back\\side\nnext")).toBe(
      "Hall\\; room 2\\, back\\\\side\\nnext",
    );
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });
  it("writes stable UIDs, UTC times and cancelled status", () => {
    const text = buildCalendar({
      name: "Sycamore RPC",
      zone,
      now: new Date("2027-03-01T12:00:00Z"),
      entries: [
        {
          uid: "study_2027-03-14@sycamorerpc.org",
          title: "Bible study",
          start: "2027-03-14T14:30:00.000Z",
          end: "2027-03-14T15:30:00.000Z",
          location: "Hall",
          description: "",
          cancelled: true,
          sequence: 4,
        },
      ],
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text).toContain("UID:study_2027-03-14@sycamorerpc.org\r\n");
    expect(text).toContain("DTSTART:20270314T143000Z\r\n");
    expect(text).toContain("STATUS:CANCELLED\r\n");
    expect(text).toContain("SEQUENCE:4\r\n");
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
  });
});

describe("event reminders", () => {
  const reminder = {
    id: "day",
    minutesBefore: 1440,
    channel: "email" as const,
    audience: "attending" as const,
    groupId: "",
  };
  const occurrence = {
    title: "Bible study",
    start: "2027-03-14T22:00:00.000Z",
    end: "2027-03-14T23:00:00.000Z",
    location: "Hall",
    cancelled: false,
  };
  it("is due from its lead time until the start, never after", () => {
    expect(
      reminderDue(occurrence, reminder, new Date("2027-03-13T21:59:00Z")),
    ).toBe(false);
    expect(
      reminderDue(occurrence, reminder, new Date("2027-03-13T22:00:00Z")),
    ).toBe(true);
    expect(
      reminderDue(occurrence, reminder, new Date("2027-03-14T22:00:00Z")),
    ).toBe(false);
    expect(
      reminderDue(
        { ...occurrence, cancelled: true },
        reminder,
        new Date("2027-03-14T12:00:00Z"),
      ),
    ).toBe(false);
  });
  it("versions the details a reminder states", () => {
    const version = reminderVersion(occurrence, reminder);
    expect(reminderVersion({ ...occurrence }, { ...reminder })).toBe(version);
    for (const changed of [
      reminderVersion({ ...occurrence, location: "Manse" }, reminder),
      reminderVersion(
        { ...occurrence, start: "2027-03-14T23:00:00.000Z" },
        reminder,
      ),
      reminderVersion(occurrence, { ...reminder, channel: "sms" }),
      reminderVersion(occurrence, { ...reminder, audience: "responded" }),
    ])
      expect(changed).not.toBe(version);
  });
  it("accepts only listed lead times and a group only for group reminders", () => {
    expect(eventReminderSchema.safeParse(reminder).success).toBe(true);
    for (const value of [
      { ...reminder, minutesBefore: 5 },
      { ...reminder, groupId: "youth" },
      { ...reminder, audience: "group" },
      { ...reminder, audience: "everyone" },
    ])
      expect(eventReminderSchema.safeParse(value).success).toBe(false);
  });
  it("says Lord's Day and drops braces from event text", () => {
    expect(
      reminderMessage(
        { ...occurrence, title: "Study {FirstName}" },
        "America/Indiana/Indianapolis",
      ),
    ).toBe("Study FirstName is on the Lord's Day, March 14 at 6:00 PM, Hall.");
  });
});
