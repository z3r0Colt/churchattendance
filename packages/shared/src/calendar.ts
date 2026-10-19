import { z } from "zod";
import { DateTime } from "luxon";
import { dateSchema, idSchema } from "./domain.js";

// Change one dated occurrence of an event series. Restore removes the change.
export const occurrenceChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      eventId: idSchema,
      date: dateSchema,
      expectedRevision: z.number().int().nonnegative(),
      action: z.enum(["cancel", "restore"]),
    })
    .strict(),
  z
    .object({
      eventId: idSchema,
      date: dateSchema,
      expectedRevision: z.number().int().nonnegative(),
      action: z.literal("reschedule"),
      start: z.iso.datetime({ offset: true }),
      end: z.iso.datetime({ offset: true }),
      location: z.string().max(300),
    })
    .strict()
    .refine(
      (row) =>
        Date.parse(row.end) > Date.parse(row.start) &&
        Date.parse(row.end) - Date.parse(row.start) <= 7 * 86400000,
      "Use an end time after the start, within seven days",
    ),
]);
export type OccurrenceChange = z.infer<typeof occurrenceChangeSchema>;

// Private subscriptions. The URL carries a random feed token, never an
// account credential; only its hash is stored, and it can be revoked.
export const calendarFeedScopes = ["member", "staff"] as const;
export type CalendarFeedScope = (typeof calendarFeedScopes)[number];
export const CALENDAR_FEED_DAYS = 365;
export const createCalendarFeedSchema = z
  .object({ label: z.string().trim().min(1).max(60) })
  .strict();
export const revokeCalendarFeedSchema = z
  .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type CalendarFeed = {
  id: string;
  label: string;
  scope: CalendarFeedScope;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
};
export const feedTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type CalendarEntry = {
  uid: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  cancelled: boolean;
  sequence: number;
};

// RFC 5545 text values escape backslashes, separators and line breaks.
export function icsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
// Content lines fold at 75 octets without splitting a UTF-8 character.
export function foldLine(line: string) {
  const parts: string[] = [];
  let current = "",
    size = 0,
    limit = 75;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
const stamp = (iso: string) =>
  DateTime.fromISO(iso, { zone: "utc" }).toFormat("yyyyMMdd'T'HHmmss'Z'");
// Each occurrence is its own VEVENT in UTC, expanded with the church time
// zone, so daylight-saving changes and per-date changes need no RRULE support.
export function buildCalendar(input: {
  name: string;
  zone: string;
  now: Date;
  entries: CalendarEntry[];
}) {
  const now = stamp(input.now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sycamore RPC//Church Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(input.name)}`,
    `X-WR-TIMEZONE:${icsText(input.zone)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const entry of [...input.entries].sort((a, b) =>
    a.start.localeCompare(b.start),
  ))
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(entry.uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(entry.start)}`,
      `DTEND:${stamp(entry.end)}`,
      `SEQUENCE:${entry.sequence}`,
      `STATUS:${entry.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      `SUMMARY:${icsText(entry.cancelled ? `Cancelled: ${entry.title}` : entry.title)}`,
      ...(entry.location ? [`LOCATION:${icsText(entry.location)}`] : []),
      ...(entry.description
        ? [`DESCRIPTION:${icsText(entry.description)}`]
        : []),
      "END:VEVENT",
    );
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
