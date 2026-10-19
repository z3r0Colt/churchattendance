import { DateTime } from "luxon";

// "PublicCalendar" reads as "Public calendar"; labels already in words stay.
export function columnLabel(key: string) {
  if (/\s/.test(key)) return key;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Calendar dates read as "Oct 11, 2026" and times as "6:30 PM" on screen.
// Exports keep ISO dates and 24-hour times.
export function displayValue(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = DateTime.fromISO(value);
    if (date.isValid) return date.toFormat("LLL d, yyyy");
  }
  if (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    return DateTime.fromFormat(value, "HH:mm").toFormat("h:mm a");
  return value as string | number | boolean | null | undefined;
}

export type StripWeek = {
  date: string;
  state: "present" | "absent" | "unrecorded";
};
// One square per Lord's Day, oldest first, ending on the latest Lord's Day on
// or before today. A Lord's Day with no recorded service is "unrecorded",
// never counted as an absence.
export function attendanceStrip(
  services: { date: string; present: Record<string, unknown> }[],
  personId: string,
  today: string,
  weeks = 26,
): StripWeek[] {
  const day = DateTime.fromISO(today, { zone: "utc" });
  if (!day.isValid) return [];
  const last = day.minus({ days: day.weekday % 7 });
  return Array.from({ length: weeks }, (_, index) => {
    const date = last.minus({ weeks: weeks - 1 - index }).toISODate()!;
    const held = services.filter((row) => row.date === date);
    return {
      date,
      state: !held.length
        ? "unrecorded"
        : held.some((row) => !!row.present[personId])
          ? "present"
          : "absent",
    };
  });
}

const messageStatusWords: Record<string, string> = {
  queued: "Waiting to send",
  sending: "Sending",
  completed: "Finished",
  cancelled: "Cancelled",
  failed: "Needs attention",
};
export const messageStatusLabel = (status: string) =>
  messageStatusWords[status] ??
  status.charAt(0).toUpperCase() + status.slice(1);
export const channelLabel = (channel: string) =>
  channel === "sms"
    ? "Text"
    : channel === "both"
      ? "Email and text"
      : channel === "email"
        ? "Email"
        : channel;
// Delivery totals grouped the way staff read them. Acceptance by Microsoft or
// Twilio and local simulation count as sent; neither confirms the person read it.
export function deliveryBreakdown(totals: Record<string, number> = {}) {
  const count = (...keys: string[]) =>
    keys.reduce((sum, key) => sum + (Number(totals[key]) || 0), 0);
  return {
    sent: count("simulated", "accepted", "delivered", "sent"),
    waiting: count("pending", "sending", "queued", "unknown"),
    skipped: count("skipped", "expired"),
    failed: count("failed", "undelivered"),
  };
}

// The tone of a status word, so tables can show it as a small label. The word
// itself always stays visible; tone never carries meaning alone.
export type StatusTone = "good" | "attention" | "problem" | "neutral";
const tones: [StatusTone, RegExp][] = [
  ["problem", /^(failed|declined|needs attention|undelivered)/i],
  [
    "attention",
    /^(contact gap|overdue|due|waiting|new|pending|changed|not shared|needs review|skipped|paused|unknown|weak|stray|lost)/i,
  ],
  [
    "good",
    /^(current|active|completed|complete|finished|resolved|approved|assigned|linked|as scheduled|on time|planned|sent|shared|healthy|in progress|ready)/i,
  ],
];
export function statusTone(text: string): StatusTone {
  return (
    tones.find(([, pattern]) => pattern.test(text.trim()))?.[0] ?? "neutral"
  );
}
