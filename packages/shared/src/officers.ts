import { z } from "zod";
import { DateTime } from "luxon";
import {
  dateSchema,
  idSchema,
  statusSchema,
  type MembershipStatus,
  type Person,
} from "./domain.js";
import type { HistoryEvent } from "./chms.js";

export const officeRoles = ["pastor", "elder", "deacon"] as const;
export type OfficeRole = (typeof officeRoles)[number];
export const officeRoleLabels: Record<OfficeRole, string> = {
  pastor: "Pastor",
  elder: "Ruling elder",
  deacon: "Deacon",
};
export const officeEndReasons = [
  "termEnded",
  "rotated",
  "resigned",
  "retired",
  "transferred",
  "removed",
  "deceased",
  "other",
] as const;
export const officeEndReasonLabels: Record<
  (typeof officeEndReasons)[number],
  string
> = {
  termEnded: "Term ended",
  rotated: "Rotated off",
  resigned: "Resigned",
  retired: "Retired",
  transferred: "Moved to another congregation",
  removed: "Removed from office",
  deceased: "Died",
  other: "Other",
};
const optionalDate = z.union([dateSchema, z.literal("")]).default("");
// One record per period of active service in this congregation.
export const officeSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    personId: idSchema,
    role: z.enum(officeRoles),
    ordainedOn: optionalDate,
    installedOn: optionalDate,
    termEndsOn: optionalDate,
    endedOn: optionalDate,
    endReason: z.union([z.enum(officeEndReasons), z.literal("")]).default(""),
    emeritusOn: optionalDate,
  })
  .strict()
  .refine((row) => !!(row.ordainedOn || row.installedOn), {
    message: "Record an ordination or installation date",
    path: ["installedOn"],
  })
  .refine(
    (row) =>
      !row.ordainedOn || !row.installedOn || row.installedOn >= row.ordainedOn,
    {
      message: "Installation cannot be before ordination",
      path: ["installedOn"],
    },
  )
  .refine(
    (row) =>
      !row.termEndsOn || row.termEndsOn > (row.installedOn || row.ordainedOn),
    { message: "The term must end after it begins", path: ["termEndsOn"] },
  )
  .refine(
    (row) => !row.endedOn || row.endedOn >= (row.installedOn || row.ordainedOn),
    { message: "Service cannot end before it begins", path: ["endedOn"] },
  )
  .refine((row) => !!row.endedOn === !!row.endReason, {
    message: "Give an end date and a reason together",
    path: ["endReason"],
  })
  .refine(
    (row) =>
      !row.emeritusOn || (!!row.endedOn && row.emeritusOn >= row.endedOn),
    {
      message: "Emeritus status follows the end of active service",
      path: ["emeritusOn"],
    },
  );
export type OfficeInput = z.infer<typeof officeSchema>;
export type Office = Omit<OfficeInput, "expectedRevision"> & {
  revision: number;
};
export const officeRemoveSchema = z
  .object({
    id: idSchema,
    personId: idSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export type OfficeState =
  "serving" | "ended" | "emeritus" | "notYet" | "unknown";
export const officeStateLabels: Record<OfficeState, string> = {
  serving: "Serving",
  ended: "Ended",
  emeritus: "Emeritus",
  notYet: "Not yet installed",
  unknown: "Installation not recorded",
};
// Active service runs from installation up to, but not including, the end date.
export function officeState(office: Office, date: string): OfficeState {
  if (office.emeritusOn && office.emeritusOn <= date) return "emeritus";
  if (office.endedOn && office.endedOn <= date) return "ended";
  if (!office.installedOn) return "unknown";
  return office.installedOn > date ? "notYet" : "serving";
}
// Overlapping periods in the same office, or records that disagree with the person record.
export function officeConflicts(
  offices: Office[],
  people: Pick<Person, "id" | "isDeceased">[],
) {
  const problems: { officeId: string; message: string }[] = [];
  const start = (row: Office) => row.installedOn || row.ordainedOn;
  for (const row of offices) {
    for (const other of offices) {
      if (
        other.id <= row.id ||
        other.personId !== row.personId ||
        other.role !== row.role
      )
        continue;
      const overlap =
        start(row) < (other.endedOn || "9999-12-31") &&
        start(other) < (row.endedOn || "9999-12-31");
      if (overlap)
        for (const id of [row.id, other.id])
          problems.push({
            officeId: id,
            message: `Overlaps another ${officeRoleLabels[row.role].toLowerCase()} record for the same person`,
          });
    }
    const person = people.find((p) => p.id === row.personId);
    if (!person)
      problems.push({ officeId: row.id, message: "Person not found" });
    else if (person.isDeceased && !row.endedOn)
      problems.push({
        officeId: row.id,
        message: "The person has died but this service has no end date",
      });
    if (!row.installedOn)
      problems.push({
        officeId: row.id,
        message: "Installation date not recorded",
      });
  }
  return problems;
}
export function wouldOverlap(office: OfficeInput, existing: Office[]) {
  const start = (row: Pick<Office, "installedOn" | "ordainedOn">) =>
    row.installedOn || row.ordainedOn;
  return existing.some(
    (other) =>
      other.id !== office.id &&
      other.personId === office.personId &&
      other.role === office.role &&
      start(office) < (other.endedOn || "9999-12-31") &&
      start(other) < (office.endedOn || "9999-12-31"),
  );
}
export const TERM_REVIEW_DAYS = 60;
// Terms of active officers that end within the window, or have already passed without an end date.
export function termReviews(
  offices: Office[],
  today: string,
  days = TERM_REVIEW_DAYS,
) {
  const until = DateTime.fromISO(today).plus({ days }).toISODate()!;
  return offices
    .filter(
      (row) =>
        row.termEndsOn &&
        !row.endedOn &&
        officeState(row, today) === "serving" &&
        row.termEndsOn <= until,
    )
    .map((row) => ({
      ...row,
      review: (row.termEndsOn < today ? "overdue" : "due") as "overdue" | "due",
    }))
    .sort((a, b) => a.termEndsOn.localeCompare(b.termEndsOn));
}

// Eligibility criteria the Session adopts. Nothing here judges a call to office or character.
export const eligibilityRoles = ["elder", "deacon"] as const;
export const officerPolicySchema = z
  .object({
    role: z.enum(eligibilityRoles),
    expectedRevision: z.number().int().nonnegative().default(0),
    statuses: z.array(statusSchema).min(1).max(6).default(["communicant"]),
    minimumAge: z.number().int().min(0).max(100).default(0),
    minimumMemberYears: z.number().int().min(0).max(50).default(0),
    excludeUnderDiscipline: z.boolean().default(true),
    source: z.string().trim().max(500).default(""),
  })
  .strict();
export type OfficerPolicy = Omit<
  z.infer<typeof officerPolicySchema>,
  "expectedRevision"
> & { revision: number };
export const officerDecisions = [
  "approved",
  "notApproved",
  "deferred",
] as const;
export const officerDecisionLabels: Record<
  (typeof officerDecisions)[number],
  string
> = {
  approved: "Approved by the Session",
  notApproved: "Not approved",
  deferred: "Deferred",
};
export const officerDecisionSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    personId: idSchema,
    role: z.enum(eligibilityRoles),
    decision: z.enum(officerDecisions),
    decidedOn: dateSchema,
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
export type OfficerDecision = Omit<
  z.infer<typeof officerDecisionSchema>,
  "expectedRevision"
> & { revision: number };
export type CriterionState = "met" | "notMet" | "unknown";
export type EligibilityRow = {
  personId: string;
  role: (typeof eligibilityRoles)[number];
  result: CriterionState;
  serving: boolean;
  criteria: { label: string; state: CriterionState; detail: string }[];
  decision?: OfficerDecision;
};
export function ageOn(birthDate: string, date: string) {
  if (!birthDate) return null;
  // A Feb 29 birthday counts from Feb 28 in other years.
  const birth = DateTime.fromISO(birthDate);
  const on = DateTime.fromISO(date);
  let age = on.year - birth.year;
  const day =
    birth.month === 2 && birth.day === 29 && !on.isInLeapYear ? 28 : birth.day;
  if (on.month < birth.month || (on.month === birth.month && on.day < day))
    age--;
  return age;
}
// The date a person last entered one of the statuses, from recorded reception history.
// An "initial" entry is when the record was made, not when they were received.
export function statusSince(
  personId: string,
  events: HistoryEvent[],
  statuses: readonly MembershipStatus[],
  date: string,
): { since: string } | { unknown: string } {
  const rows = events
    .filter((row) => row.personId === personId && row.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!rows.length) return { unknown: "No membership history recorded" };
  let since = "",
    fromInitial = false;
  for (const row of rows) {
    const was = row.fromStatus && statuses.includes(row.fromStatus);
    const now = statuses.includes(row.toStatus);
    if (now && !was) {
      since = row.date;
      fromInitial = row.method === "initial";
    } else if (!now) since = "";
  }
  if (!since) return { unknown: "Not in a qualifying status" };
  return fromInitial
    ? { unknown: "Date received was not recorded (entered with the roll)" }
    : { since };
}
export function officerEligibility({
  people,
  history,
  offices,
  policy,
  decisions,
  disciplinedOn,
  statusOn,
  asOf,
}: {
  people: Person[];
  history: HistoryEvent[];
  offices: Office[];
  policy: OfficerPolicy;
  decisions: OfficerDecision[];
  // True or false from dated discipline entries, or null when the record cannot say.
  disciplinedOn: (personId: string, date: string) => boolean | null;
  // Membership status on the date, or null when history cannot say.
  statusOn: (person: Person, date: string) => MembershipStatus | null;
  asOf: string;
}): EligibilityRow[] {
  return people
    .filter(
      (person) => !person.isDeceased && person.membershipStatus !== "former",
    )
    .map((person) => {
      const criteria: EligibilityRow["criteria"] = [];
      const status = statusOn(person, asOf);
      criteria.push(
        status === null
          ? {
              label: "Membership",
              state: "unknown",
              detail: "Membership history needs review",
            }
          : {
              label: "Membership",
              state: policy.statuses.includes(status) ? "met" : "notMet",
              detail: policy.statuses.includes(status)
                ? "Qualifying status"
                : "Not a qualifying status",
            },
      );
      if (policy.minimumAge) {
        const age = ageOn(person.birthDate, asOf);
        criteria.push(
          age === null
            ? {
                label: "Age",
                state: "unknown",
                detail: "Birth date not recorded",
              }
            : {
                label: "Age",
                state: age >= policy.minimumAge ? "met" : "notMet",
                detail: `${age} years. Policy is ${policy.minimumAge} or older.`,
              },
        );
      }
      if (policy.minimumMemberYears) {
        const since = statusSince(person.id, history, policy.statuses, asOf);
        if ("unknown" in since)
          criteria.push({
            label: "Years as member",
            state: "unknown",
            detail: since.unknown,
          });
        else {
          const years = Math.floor(
            DateTime.fromISO(asOf).diff(DateTime.fromISO(since.since), "years")
              .years,
          );
          criteria.push({
            label: "Years as member",
            state: years >= policy.minimumMemberYears ? "met" : "notMet",
            detail: `Since ${since.since}. Policy is ${policy.minimumMemberYears} years.`,
          });
        }
      }
      if (policy.excludeUnderDiscipline) {
        const disciplined = disciplinedOn(person.id, asOf);
        criteria.push({
          label: "Discipline",
          state:
            disciplined === null ? "unknown" : disciplined ? "notMet" : "met",
          detail:
            disciplined === null
              ? "Discipline record has no dated entries"
              : disciplined
                ? "Under discipline"
                : "Not under discipline",
        });
      }
      const result: CriterionState = criteria.some((c) => c.state === "notMet")
        ? "notMet"
        : criteria.some((c) => c.state === "unknown")
          ? "unknown"
          : "met";
      const decision = decisions
        .filter((row) => row.personId === person.id && row.role === policy.role)
        .sort(
          (a, b) =>
            b.decidedOn.localeCompare(a.decidedOn) || b.id.localeCompare(a.id),
        )[0];
      return {
        personId: person.id,
        role: policy.role,
        result,
        serving: offices.some(
          (row) =>
            row.personId === person.id &&
            row.role === policy.role &&
            officeState(row, asOf) === "serving",
        ),
        criteria,
        ...(decision ? { decision } : {}),
      };
    });
}
