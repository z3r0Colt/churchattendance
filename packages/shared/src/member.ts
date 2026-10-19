import { z } from "zod";
import { DateTime } from "luxon";
import { householdInputSchema, personInputSchema } from "./domain.js";
export const memberTabs = [
  "directory",
  "events",
  "profile",
  "privacy",
  "account",
] as const;
export type MemberTab = (typeof memberTabs)[number];
// Sign-in links can be forwarded or edited, so the return target is rebuilt
// from an allowlist and never followed as a URL.
export function safeReturnPath(value: string | null | undefined): string {
  const tab = memberReturnTab(value);
  return tab ? `/?tab=${tab}` : "/";
}
export function memberReturnTab(
  value: string | null | undefined,
): MemberTab | null {
  if (!value || !/^\/(\?tab=[a-z]+)?$/.test(value)) return null;
  const tab = value.slice(6);
  return (memberTabs as readonly string[]).includes(tab)
    ? (tab as MemberTab)
    : null;
}
// Each field a member changes carries the value they started from, so a
// stale form cannot overwrite a newer edit to the same field.
function patchSchema<T extends z.ZodRawShape>(shape: T) {
  const fields = z.object(shape).partial().strict();
  return z
    .object({ changes: fields, expected: fields })
    .strict()
    .refine(
      (row) =>
        Object.keys(row.changes).length > 0 &&
        Object.keys(row.changes).every((key) => key in row.expected) &&
        Object.keys(row.expected).every((key) => key in row.changes),
      "Change at least one field",
    );
}
export const memberContactSchema = patchSchema({
  preferredName: personInputSchema.shape.preferredName.unwrap(),
  email: z.union([z.email().max(254), z.literal("")]),
  mobilePhone: z.string().max(40),
});
export type MemberContactInput = z.infer<typeof memberContactSchema>;
export const memberHouseholdSchema = patchSchema({
  address: householdInputSchema.shape.address.unwrap(),
  homePhone: householdInputSchema.shape.homePhone.unwrap(),
});
export type MemberHouseholdInput = z.infer<typeof memberHouseholdSchema>;
export const memberPhotoTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MEMBER_PHOTO_BYTES = 1024 * 1024;
export const memberPhotoSchema = z
  .object({
    contentType: z.enum(memberPhotoTypes),
    // Base64 of at most MEMBER_PHOTO_BYTES.
    data: z
      .string()
      .min(8)
      .max(Math.ceil(MEMBER_PHOTO_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    expectedPhoto: z.boolean(),
  })
  .strict();
export const memberPhotoRemovalSchema = z
  .object({ expectedPhoto: z.literal(true) })
  .strict();
export const portalPhotoSchema = z
  .object({ personId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })
  .strict();
// The bytes must be the image they claim to be, not just carry its label.
export function photoMatchesType(
  bytes: Uint8Array,
  type: (typeof memberPhotoTypes)[number],
) {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (type === "image/png")
    return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return (
    starts(0x52, 0x49, 0x46, 0x46) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}
// A household address is changed by an adult in that household. Adulthood
// needs a recorded birth date; without one the church office makes the change.
export const ADULT_AGE = 18;
export function isAdultOn(birthDate: string, today: string) {
  if (!birthDate) return false;
  const born = DateTime.fromISO(birthDate, { zone: "utc" });
  const now = DateTime.fromISO(today, { zone: "utc" });
  if (!born.isValid || !now.isValid) return false;
  // Luxon moves Feb 29 to Feb 28 in other years, so a leap-day birthday
  // reaches adulthood on Feb 28.
  return born.plus({ years: ADULT_AGE }) <= now;
}
