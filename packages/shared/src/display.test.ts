import { describe, expect, it } from "vitest";
import {
  attendanceStrip,
  channelLabel,
  columnLabel,
  deliveryBreakdown,
  displayValue,
  messageStatusLabel,
  statusTone,
} from "./index";

describe("table display", () => {
  it("turns field keys into plain column names", () => {
    expect(columnLabel("PublicCalendar")).toBe("Public calendar");
    expect(columnLabel("dueDate")).toBe("Due date");
    expect(columnLabel("Person")).toBe("Person");
    expect(columnLabel("Works until")).toBe("Works until");
    expect(columnLabel("last_used")).toBe("Last used");
  });
  it("shows calendar dates in words and leaves other values alone", () => {
    expect(displayValue("2026-10-11")).toBe("Oct 11, 2026");
    expect(displayValue("2026-02-30")).toBe("2026-02-30");
    expect(displayValue("2026-10-11T18:00:00Z")).toBe("2026-10-11T18:00:00Z");
    expect(displayValue("18:30")).toBe("6:30 PM");
    expect(displayValue("24:00")).toBe("24:00");
    expect(displayValue(4)).toBe(4);
    expect(displayValue("Calder")).toBe("Calder");
  });
});

describe("attendance strip", () => {
  const services = [
    { date: "2026-10-18", present: { ruth: {} } },
    { date: "2026-10-11", present: {} },
    { date: "2026-10-11", present: { ruth: {} } },
    { date: "2026-10-04", present: { james: {} } },
  ];
  it("marks each Lord's Day present, absent or unrecorded, oldest first", () => {
    const strip = attendanceStrip(services, "ruth", "2026-10-21", 4);
    expect(strip).toEqual([
      { date: "2026-09-27", state: "unrecorded" },
      { date: "2026-10-04", state: "absent" },
      { date: "2026-10-11", state: "present" },
      { date: "2026-10-18", state: "present" },
    ]);
  });
  it("ends on today when today is the Lord's Day", () => {
    expect(attendanceStrip(services, "ruth", "2026-10-18", 1)).toEqual([
      { date: "2026-10-18", state: "present" },
    ]);
  });
});

describe("message log wording", () => {
  it("uses plain words for status and channel", () => {
    expect(messageStatusLabel("queued")).toBe("Waiting to send");
    expect(messageStatusLabel("completed")).toBe("Finished");
    expect(messageStatusLabel("paused")).toBe("Paused");
    expect(channelLabel("sms")).toBe("Text");
    expect(channelLabel("both")).toBe("Email and text");
  });
  it("groups delivery totals into sent, waiting, skipped and failed", () => {
    expect(
      deliveryBreakdown({
        simulated: 2,
        accepted: 1,
        delivered: 3,
        pending: 1,
        unknown: 1,
        skipped: 5,
        failed: 1,
        undelivered: 2,
      }),
    ).toEqual({ sent: 6, waiting: 2, skipped: 5, failed: 3 });
    expect(deliveryBreakdown()).toEqual({
      sent: 0,
      waiting: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe("status tone", () => {
  it("reads common status words", () => {
    expect(statusTone("Contact gap")).toBe("attention");
    expect(statusTone("Overdue")).toBe("attention");
    expect(statusTone("Current")).toBe("good");
    expect(statusTone("Resolved")).toBe("good");
    expect(statusTone("Declined")).toBe("problem");
    expect(statusTone("Archived")).toBe("neutral");
    expect(statusTone("Waiting for triage")).toBe("attention");
  });
});
