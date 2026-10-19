import { z } from "zod";
import { DateTime } from "luxon";
import { dateSchema, idSchema, type Service } from "./domain.js";

// How a person worshipped. Marks made before online tracking carry no mode and count as in person.
export const attendanceModes = ["inPerson", "online"] as const;
export type AttendanceMode = (typeof attendanceModes)[number];
export const isOnline = (mark: { mode?: AttendanceMode } | undefined) =>
  mark?.mode === "online";
export function modeCounts(service: Pick<Service, "present">) {
  const marks = Object.values(service.present);
  const online = marks.filter(isOnline).length;
  return {
    inPerson: marks.length - online,
    online,
    unclassified: marks.filter((mark) => !mark.mode).length,
    total: marks.length,
  };
}
export const statisticalOptionsSchema = z
  .object({ attendanceMode: z.enum(["inPerson", "combined"]) })
  .strict();
export type StatisticalOptions = z.infer<typeof statisticalOptionsSchema>;

// Each Session decision is a dated record. Corrections are new decisions, so history stays whole.
export const communionDecisionSchema = z
  .object({
    id: idSchema,
    personId: idSchema,
    approved: z.boolean(),
    kind: z.enum(["member", "visiting"]),
    effectiveOn: dateSchema,
    until: z.union([dateSchema, z.literal("")]).default(""),
    note: z.string().trim().max(2000).default(""),
  })
  .strict()
  .refine((row) => !row.until || row.until >= row.effectiveOn, {
    message: "The last day must be on or after the first",
    path: ["until"],
  })
  .refine((row) => !row.until || (row.approved && row.kind === "visiting"), {
    message: "Only a visiting approval has a last day",
    path: ["until"],
  });
export type CommunionDecision = z.infer<typeof communionDecisionSchema> & {
  authorUid: string;
  createdAt: string;
};
export const communionBulkSchema = z
  .object({
    batchId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    personIds: z.array(idSchema).min(1).max(400),
    effectiveOn: dateSchema,
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
export const communionRecordSchema = z
  .object({
    serviceId: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    personIds: z.array(idSchema).max(1000),
  })
  .strict();
export type CommunionRecord = {
  id: string;
  serviceId: string;
  serviceTypeId: string;
  date: string;
  personIds: string[];
  revision: number;
};
export type ApprovalState = {
  approved: boolean;
  kind: "member" | "visiting";
  since: string;
  until: string;
  decision: CommunionDecision;
};
// The Session's standing decision for a person on a date. A visiting approval lapses after its last day.
export function approvalOn(
  decisions: CommunionDecision[],
  personId: string,
  date: string,
): ApprovalState | null {
  const latest = decisions
    .filter((row) => row.personId === personId && row.effectiveOn <= date)
    .sort(
      (a, b) =>
        a.effectiveOn.localeCompare(b.effectiveOn) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .at(-1);
  if (!latest) return null;
  const lapsed = !!latest.until && latest.until < date;
  return {
    approved: latest.approved && !lapsed,
    kind: latest.kind,
    since: latest.effectiveOn,
    until: latest.until,
    decision: latest,
  };
}
export function communionFlags(
  record: Pick<CommunionRecord, "personIds" | "date">,
  service: Pick<Service, "present"> | undefined,
  decisions: CommunionDecision[],
) {
  return record.personIds.flatMap((personId) => {
    const flags: string[] = [];
    if (!approvalOn(decisions, personId, record.date)?.approved)
      flags.push("Not on the approved list on this date");
    if (!service?.present[personId]) flags.push("Not marked present");
    else if (isOnline(service.present[personId]))
      flags.push("Marked as worshipping online");
    return flags.length ? [{ personId, flags }] : [];
  });
}
// Participation over the last year of recorded communion services, for pastoral review only.
export function communionParticipation(
  records: CommunionRecord[],
  personId: string,
  today: string,
) {
  const from = DateTime.fromISO(today).minus({ months: 12 }).toISODate()!;
  const recent = records.filter((row) => row.date > from && row.date <= today);
  return {
    services: recent.length,
    partook: recent.filter((row) => row.personIds.includes(personId)).length,
  };
}
