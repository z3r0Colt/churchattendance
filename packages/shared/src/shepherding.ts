import { z } from "zod";
import { DateTime } from "luxon";
import { dateSchema, idSchema, type Household, type Person } from "./domain.js";

const optionalId = z.union([idSchema, z.literal("")]);
const revision = {
  id: idSchema,
  expectedRevision: z.number().int().nonnegative().default(0),
};
const distinct = (ids: string[]) => new Set(ids).size === ids.length;

export const visitRoundSchema = z
  .object({
    ...revision,
    name: z.string().trim().min(1).max(150),
    startDate: dateSchema,
    endDate: dateSchema,
    archived: z.boolean().default(false),
  })
  .strict()
  .refine(
    (row) => row.endDate >= row.startDate,
    "End the round after it starts",
  )
  .refine(
    (row) =>
      DateTime.fromISO(row.endDate).diff(
        DateTime.fromISO(row.startDate),
        "days",
      ).days <= 400,
    "Keep a visit round within about one year",
  );
export type VisitRound = Omit<
  z.infer<typeof visitRoundSchema>,
  "expectedRevision"
> & { revision: number };

export const visitStatuses = ["planned", "completed", "cancelled"] as const;
export type VisitStatus = (typeof visitStatuses)[number];
// Completion has its own audited action, so a plan can never be saved as completed.
export const visitSchema = z
  .object({
    ...revision,
    householdId: idSchema,
    personIds: z.array(idSchema).max(20).default([]),
    roundId: optionalId.default(""),
    followUpId: optionalId.default(""),
    start: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    location: z.string().trim().max(300).default(""),
    officerUids: z.array(idSchema).min(1).max(4),
    deaconUids: z.array(idSchema).max(4).default([]),
    purpose: z.string().trim().max(4000).default(""),
    reminderHours: z.number().int().min(0).max(168).default(24),
    status: z.enum(["planned", "cancelled"]).default("planned"),
    cancelReason: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine(
    (row) =>
      distinct(row.officerUids) &&
      distinct(row.deaconUids) &&
      distinct(row.personIds) &&
      !row.deaconUids.some((uid) => row.officerUids.includes(uid)),
    "List each officer and deacon once",
  )
  .refine(
    (row) => row.status !== "cancelled" || row.cancelReason.length > 0,
    "Give a short reason for cancelling",
  );
export type VisitInput = z.infer<typeof visitSchema>;
export const completeVisitSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    record: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("link"), careNoteId: idSchema }).strict(),
      z
        .object({
          kind: z.literal("create"),
          noteId: idSchema,
          personId: idSchema,
          body: z.string().trim().min(1).max(10000),
        })
        .strict(),
    ]),
  })
  .strict();
export type PastoralVisit = Omit<VisitInput, "expectedRevision" | "status"> & {
  status: VisitStatus;
  revision: number;
  completedAt?: string;
  completedBy?: string;
  careNoteId?: string;
};
// The logistics a deacon invited to a joint visit may see. No purpose, notes or round.
export type VisitLogistics = Pick<
  PastoralVisit,
  | "id"
  | "householdId"
  | "start"
  | "durationMinutes"
  | "location"
  | "status"
  | "officerUids"
  | "deaconUids"
> & { householdName: string; address: string; officerNames: string[] };
export const visitLogisticsKeys = [
  "householdId",
  "start",
  "durationMinutes",
  "location",
  "status",
  "officerUids",
  "deaconUids",
] as const;

export type VisitState = "upcoming" | "overdue" | "completed" | "cancelled";
// Scheduling is never contact. A planned visit whose time has passed stays overdue until completed.
export function visitState(
  visit: Pick<PastoralVisit, "status" | "start" | "durationMinutes">,
  now: Date,
): VisitState {
  if (visit.status !== "planned") return visit.status;
  return Date.parse(visit.start) + visit.durationMinutes * 60_000 <
    now.getTime()
    ? "overdue"
    : "upcoming";
}
export function canCompleteVisit(
  visit: Pick<PastoralVisit, "status" | "start">,
  now: Date,
) {
  return visit.status === "planned" && Date.parse(visit.start) <= now.getTime();
}
export type OfficerWorkload = {
  uid: string;
  upcoming: string[];
  overdue: string[];
  completed: string[];
  cancelled: string[];
};
// Completed and cancelled visits count within the chosen church-local date range. Open work always counts.
export function visitWorkload(
  visits: Pick<
    PastoralVisit,
    "id" | "status" | "start" | "durationMinutes" | "officerUids"
  >[],
  now: Date,
  zone: string,
  from = "",
  to = "9999-12-31",
): OfficerWorkload[] {
  const rows = new Map<string, OfficerWorkload>();
  for (const visit of [...visits].sort((a, b) =>
    a.start.localeCompare(b.start),
  )) {
    const state = visitState(visit, now);
    const day = DateTime.fromISO(visit.start, { zone }).toISODate()!;
    if (
      (state === "completed" || state === "cancelled") &&
      (day < from || day > to)
    )
      continue;
    for (const uid of visit.officerUids) {
      if (!rows.has(uid))
        rows.set(uid, {
          uid,
          upcoming: [],
          overdue: [],
          completed: [],
          cancelled: [],
        });
      rows.get(uid)![state].push(visit.id);
    }
  }
  return [...rows.values()].sort((a, b) => a.uid.localeCompare(b.uid));
}
const roundStatuses = ["communicant", "baptized", "nonResident", "adherent"];
export function visitableHouseholds(people: Person[], households: Household[]) {
  return households.filter((household) =>
    people.some(
      (person) =>
        person.householdId === household.id &&
        !person.isDeceased &&
        roundStatuses.includes(person.membershipStatus),
    ),
  );
}
export type RoundCoverage = {
  householdId: string;
  state: "visited" | "planned" | "notScheduled";
  visitIds: string[];
};
// Coverage uses visits explicitly assigned to the round, never visits that happen to share its dates.
export function roundCoverage(
  roundId: string,
  visits: Pick<PastoralVisit, "id" | "roundId" | "householdId" | "status">[],
  households: Pick<Household, "id">[],
): RoundCoverage[] {
  return households.map((household) => {
    const own = visits.filter(
      (visit) =>
        visit.roundId === roundId && visit.householdId === household.id,
    );
    return {
      householdId: household.id,
      state: own.some((visit) => visit.status === "completed")
        ? "visited"
        : own.some((visit) => visit.status === "planned")
          ? "planned"
          : "notScheduled",
      visitIds: own.map((visit) => visit.id),
    };
  });
}
export function visitReminderDue(
  visit: Pick<PastoralVisit, "status" | "start" | "reminderHours">,
  now: Date,
) {
  const start = Date.parse(visit.start);
  return (
    visit.status === "planned" &&
    visit.reminderHours > 0 &&
    start > now.getTime() &&
    start - visit.reminderHours * 3_600_000 <= now.getTime()
  );
}
