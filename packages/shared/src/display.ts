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
