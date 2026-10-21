import { z } from "zod";
import {
  dateSchema,
  householdInputSchema,
  idSchema,
  personInputSchema,
  serviceTypeSchema,
} from "./domain.js";

export const revisionSchema = z.number().int().nonnegative();
export const churchSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    address: z.string().trim().max(500),
    timeZone: z
      .string()
      .max(100)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid IANA time zone"),
  })
  .strict();
export type ChurchSettings = z.infer<typeof churchSettingsSchema> & {
  revision: number;
};
export const saveChurchSettingsSchema = churchSettingsSchema.extend({
  expectedRevision: revisionSchema,
});
export const saveServiceTypeSchema = serviceTypeSchema.extend({
  id: idSchema,
  expectedRevision: revisionSchema,
});
export const districtSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    elderPersonId: idSchema,
    archived: z.boolean(),
  })
  .strict();
export const saveDistrictSchema = districtSchema.extend({
  id: idSchema,
  expectedRevision: revisionSchema,
});
export type ElderDistrict = z.infer<typeof districtSchema> & {
  id: string;
  revision: number;
};
export const saveHouseholdSchema = householdInputSchema.extend({
  id: idSchema,
  expectedRevision: revisionSchema,
});
export const addPersonSchema = z
  .object({ person: personInputSchema, date: dateSchema, requestId: z.uuid().optional() })
  .strict();

// An explicit allowlist prevents an export request from reaching operational secrets or capabilities.
export const publicExportCollections = [
  "people",
  "households",
  "attendanceRoster",
  "services",
  "serviceTypes",
  "elderDistricts",
  "groups",
  "meetings",
  "events",
  "rsvps",
  "serving",
  "membershipEvents",
  "sacraments",
  "offices",
  "settings",
  "reportSettings",
  "users",
  "portalAccess",
  "directoryPreferences",
  "eventPublications",
  "onlineSubmissions",
  "consentEvents",
  "messageTemplates",
  "savedAudiences",
  "communicationSettings",
  "smsInbox",
] as const;
export const privateExportCollections = [
  "sessionPrivate",
  "careNotes",
  "followUps",
  "diaconalTasks",
  "auditLog",
] as const;
export const exportCollections = [
  ...publicExportCollections,
  ...privateExportCollections,
] as const;
export const exportPageSchema = z
  .object({
    collection: z.enum(exportCollections),
    after: z.string().max(500).default(""),
  })
  .strict();
export type ExportCollection = (typeof exportCollections)[number];
export type ExportPage = {
  rows: { path: string; data: Record<string, unknown> }[];
  next: string;
  readAt: string;
};
export function archiveJsonParts(json: string) {
  const parts: string[] = [];
  for (let offset = 0; offset < json.length;) {
    let end = Math.min(offset + 30000, json.length);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(json.slice(offset, end));
    offset = end;
  }
  return parts;
}
export function exportPathAllowed(collection: ExportCollection, path: string) {
  const roots: Record<string, string> = {
    membershipEvents: "people",
    sacraments: "people",
    offices: "people",
    meetings: "groups",
    rsvps: "events",
  };
  const parts = path.split("/");
  const root = roots[collection];
  return root
    ? parts.length === 4 &&
        parts[0] === root &&
        parts[2] === collection &&
        !!parts[1] &&
        !!parts[3]
    : parts.length === 2 &&
        parts[0] === collection &&
        !!parts[1] &&
        (collection !== "settings" || parts[1] === "church");
}
