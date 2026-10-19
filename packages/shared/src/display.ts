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

// Calendar dates read as "Oct 11, 2026" on screen. Exports keep ISO dates.
export function displayValue(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = DateTime.fromISO(value);
    if (date.isValid) return date.toFormat("LLL d, yyyy");
  }
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
