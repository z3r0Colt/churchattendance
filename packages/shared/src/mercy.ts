import { z } from "zod";
import { dateSchema, idSchema } from "./domain.js";

const optionalId = z.union([idSchema, z.literal("")]);
const expectedRevision = z.number().int().nonnegative().default(0);
const distinct = (ids: string[]) => new Set(ids).size === ids.length;
const deacons = (max: number) =>
  z.array(idSchema).max(max).refine(distinct, "List each deacon once");

// Practical help only. Mercy ministry never records money, benevolence funds or donations.
export const mercyCategories = [
  "meals",
  "transport",
  "homeHelp",
  "errands",
  "supplies",
  "visit",
  "other",
] as const;
export type MercyCategory = (typeof mercyCategories)[number];
export const mercyCategoryLabels: Record<MercyCategory, string> = {
  meals: "Meals",
  transport: "Transport",
  homeHelp: "Help at home",
  errands: "Errands",
  supplies: "Household supplies",
  visit: "Visit",
  other: "Other practical help",
};
export const mercyStatuses = [
  "new",
  "approved",
  "inProgress",
  "resolved",
  "declined",
] as const;
export type MercyStatus = (typeof mercyStatuses)[number];
export const mercyStatusLabels: Record<MercyStatus, string> = {
  new: "Waiting for triage",
  approved: "Assigned",
  inProgress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
};

export const mercySettingsSchema = z
  .object({ expectedRevision, chairUids: deacons(6).default([]) })
  .strict();
export type MercySettings = { chairUids: string[]; revision: number };

// An empty list removes every deacon from the household.
export const mercyAssignmentSchema = z
  .object({ householdId: idSchema, expectedRevision, deaconUids: deacons(4) })
  .strict();
export type MercyAssignment = {
  householdId: string;
  deaconUids: string[];
  revision: number;
};

export const mercyRequestSchema = z
  .object({
    id: idSchema,
    expectedRevision,
    householdId: idSchema,
    personId: optionalId.default(""),
    category: z.enum(mercyCategories),
    urgent: z.boolean().default(false),
    neededBy: z.union([dateSchema, z.literal("")]).default(""),
    details: z.string().trim().min(1).max(4000),
  })
  .strict();
export const mercyTriageSchema = z.discriminatedUnion("action", [
  z
    .object({
      id: idSchema,
      expectedRevision: z.number().int().nonnegative(),
      action: z.enum(["approve", "reassign"]),
      deaconUids: deacons(4).refine(
        (ids) => ids.length > 0,
        "Assign at least one deacon",
      ),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      expectedRevision: z.number().int().nonnegative(),
      action: z.literal("decline"),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export const mercyProgressSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    status: z.enum(["inProgress", "resolved"]),
    outcome: z.string().trim().max(2000).default(""),
  })
  .strict()
  .refine(
    (row) => row.status !== "resolved" || row.outcome.length > 0,
    "Say briefly how the request was resolved",
  );
export type MercyRequest = {
  id: string;
  householdId: string;
  personId: string;
  category: MercyCategory;
  urgent: boolean;
  neededBy: string;
  status: MercyStatus;
  deaconUids: string[];
  revision: number;
  createdAt: string;
  createdBy: string;
  // Present only for the assigned deacons and the Pastor.
  details?: string;
  outcome?: string;
  declineReason?: string;
};

export const mercyNoteSchema = z
  .object({
    id: idSchema,
    expectedRevision,
    householdId: idSchema,
    requestId: optionalId.default(""),
    date: dateSchema,
    body: z.string().trim().min(1).max(10000),
  })
  .strict();
// Sharing names its audience explicitly so the deacon confirms who will read the note.
export const mercyShareSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    audience: z.literal("session"),
  })
  .strict();
export type MercyNote = {
  id: string;
  householdId: string;
  requestId: string;
  date: string;
  body: string;
  authorUid: string;
  sharedWithSession: boolean;
  sharedBy?: string;
  sharedAt?: string;
  revision: number;
};

export const mercyTaskSchema = z
  .object({
    id: idSchema,
    expectedRevision,
    requestId: idSchema,
    title: z.string().trim().min(1).max(150),
    assignedToUid: idSchema,
    dueDate: dateSchema,
    done: z.boolean().default(false),
  })
  .strict();
export type MercyTask = Omit<
  z.infer<typeof mercyTaskSchema>,
  "expectedRevision"
> & { householdId: string; revision: number };

export type MercyViewer = {
  uid: string;
  pastor: boolean;
  session: boolean;
  deacon: boolean;
  chair: boolean;
};
// Chairs must still hold the deacon role. Session officers triage without reading mercy notes.
export const canTriageMercy = (viewer: MercyViewer) =>
  viewer.session || (viewer.deacon && viewer.chair);
// Private mercy content belongs to the deacons assigned now, and the Pastor for oversight.
export function canReadMercy(
  viewer: MercyViewer,
  householdDeacons: readonly string[],
  requestDeacons: readonly string[] = [],
) {
  return (
    viewer.pastor ||
    (viewer.deacon &&
      (householdDeacons.includes(viewer.uid) ||
        requestDeacons.includes(viewer.uid)))
  );
}
export function canReadMercyNote(
  viewer: MercyViewer,
  note: Pick<MercyNote, "sharedWithSession">,
  householdDeacons: readonly string[],
  requestDeacons: readonly string[] = [],
) {
  return (
    canReadMercy(viewer, householdDeacons, requestDeacons) ||
    (note.sharedWithSession && viewer.session)
  );
}
// Status moves forward only. Declined and resolved requests are closed.
export function mercyTransition(from: MercyStatus, to: MercyStatus) {
  const next: Record<MercyStatus, MercyStatus[]> = {
    new: ["approved", "declined"],
    approved: ["inProgress", "resolved"],
    inProgress: ["resolved"],
    resolved: [],
    declined: [],
  };
  return next[from].includes(to);
}
// Reassigning transfers an open request without changing its progress.
export const mercyOpen = (status: MercyStatus) =>
  status === "approved" || status === "inProgress";

// Deacon-led visits. Invited Session officers receive the time and place only.
export const mercyVisitSchema = z
  .object({
    id: idSchema,
    expectedRevision,
    householdId: idSchema,
    requestId: optionalId.default(""),
    start: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    location: z.string().trim().max(300).default(""),
    deaconUids: deacons(4).refine(
      (ids) => ids.length > 0,
      "Choose at least one deacon",
    ),
    officerUids: z
      .array(idSchema)
      .max(4)
      .refine(distinct, "List each officer once")
      .default([]),
    purpose: z.string().trim().max(4000).default(""),
    status: z.enum(["planned", "cancelled"]).default("planned"),
    cancelReason: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine(
    (row) => !row.officerUids.some((uid) => row.deaconUids.includes(uid)),
    "List each person once",
  )
  .refine(
    (row) => row.status !== "cancelled" || row.cancelReason.length > 0,
    "Give a short reason for cancelling",
  );
export const completeMercyVisitSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    note: z.string().trim().max(10000).default(""),
  })
  .strict();
export type MercyVisit = Omit<
  z.infer<typeof mercyVisitSchema>,
  "expectedRevision" | "status"
> & {
  status: "planned" | "completed" | "cancelled";
  revision: number;
  completedAt?: string;
  completedBy?: string;
  noteId?: string;
};
