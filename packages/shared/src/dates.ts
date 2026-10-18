import { z } from "zod";
import { DateTime } from "luxon";
import { dateSchema, idSchema } from "./domain.js";

const optionalId = z.union([idSchema, z.literal("")]);
// Ordinary dates may be seen by staff. Bereavement dates are Session only and sealed.
export const ordinaryDateKinds = [
  "weddingAnniversary",
  "baptismAnniversary",
  "membershipAnniversary",
  "other",
] as const;
export const bereavementDateKinds = [
  "deathAnniversary",
  "lateSpouseBirthday",
  "lateWeddingAnniversary",
  "other",
] as const;
export const importantDateLabels: Record<string, string> = {
  weddingAnniversary: "Wedding anniversary",
  baptismAnniversary: "Baptism anniversary",
  membershipAnniversary: "Membership anniversary",
  deathAnniversary: "Anniversary of a death",
  lateSpouseBirthday: "Late spouse's birthday",
  lateWeddingAnniversary: "Wedding anniversary after a spouse's death",
  other: "Other date",
};
const recurrence = {
  // never: every year. year: through endYear. count: through the endCount-th anniversary.
  endKind: z.enum(["never", "year", "count"]).default("never"),
  endYear: z.number().int().min(0).max(2200).default(0),
  endCount: z.number().int().min(0).max(150).default(0),
  remindDaysBefore: z.number().int().min(0).max(30).default(3),
  remindUid: optionalId.default(""),
};
const endRule = <
  T extends { endKind: string; endYear: number; endCount: number },
>(
  row: T,
) =>
  (row.endKind !== "year" || row.endYear > 0) &&
  (row.endKind !== "count" || row.endCount > 0);
export const importantDateSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    personId: idSchema,
    kind: z.enum(ordinaryDateKinds),
    label: z.string().trim().max(80).default(""),
    date: dateSchema,
    ...recurrence,
  })
  .strict()
  .refine(endRule, "Choose when the reminders end")
  .refine(
    (row) => row.kind !== "other" || row.label.length > 0,
    "Name the date",
  );
export const bereavementDateSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    // The living person the Session cares for. The related person may be deceased.
    personId: idSchema,
    relatedPersonId: optionalId.default(""),
    kind: z.enum(bereavementDateKinds),
    date: dateSchema,
    note: z.string().trim().max(2000).default(""),
    ...recurrence,
  })
  .strict()
  .refine(endRule, "Choose when the reminders end")
  .refine(
    (row) => row.relatedPersonId !== row.personId,
    "Choose a different related person",
  );
export type ImportantDate = Omit<
  z.infer<typeof importantDateSchema>,
  "expectedRevision"
> & { revision: number };
export type BereavementDate = Omit<
  z.infer<typeof bereavementDateSchema>,
  "expectedRevision"
> & { revision: number };
type Recurring = Pick<
  ImportantDate,
  "date" | "endKind" | "endYear" | "endCount" | "remindDaysBefore"
>;

export const dateRemoveSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
// A Feb 29 date falls on Feb 28 in other years, so it stays within February.
export function occurrenceIn(date: string, year: number) {
  const [, month, day] = date.split("-").map(Number);
  const exact = DateTime.fromObject({ year, month, day });
  return exact.isValid
    ? exact.toISODate()!
    : DateTime.fromObject({ year, month, day: 28 }).toISODate()!;
}
export type DateOccurrence = {
  date: string;
  anniversary: number;
  remindOn: string;
};
export function occurrenceForYear(
  row: Recurring,
  year: number,
): DateOccurrence | null {
  const anniversary = year - Number(row.date.slice(0, 4));
  if (anniversary < 1) return null;
  if (row.endKind === "year" && year > row.endYear) return null;
  if (row.endKind === "count" && anniversary > row.endCount) return null;
  const date = occurrenceIn(row.date, year);
  return {
    date,
    anniversary,
    remindOn: DateTime.fromISO(date)
      .minus({ days: row.remindDaysBefore })
      .toISODate()!,
  };
}
// The next occurrence whose reminder day is today or later. Past reminders are never made up.
export function nextReminder(row: Recurring, today: string) {
  const year = Number(today.slice(0, 4));
  for (const candidate of [year, year + 1, year + 2]) {
    const occurrence = occurrenceForYear(row, candidate);
    if (occurrence && occurrence.remindOn >= today) return occurrence;
  }
  return null;
}
// The reminder due on exactly this church-local day, if any.
export function reminderDueOn(row: Recurring, today: string) {
  const next = nextReminder(row, today);
  return next?.remindOn === today ? next : null;
}
// Explains what an edit does to the reminder still waiting, for the editor preview.
export function reminderChange(
  before: Recurring | null,
  after: Recurring,
  today: string,
) {
  const old = before ? nextReminder(before, today) : null;
  const next = nextReminder(after, today);
  if (old && next && old.date === next.date && old.remindOn === next.remindOn)
    return `The reminder on ${next.remindOn} for ${next.date} is unchanged.`;
  return [
    old
      ? `The waiting reminder on ${old.remindOn} for ${old.date} will not be sent.`
      : "",
    next
      ? `The next reminder will be on ${next.remindOn} for ${next.date}.`
      : "No further reminders will be sent.",
  ]
    .filter(Boolean)
    .join(" ");
}
