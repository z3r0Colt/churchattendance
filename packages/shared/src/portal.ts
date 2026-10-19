import { z } from "zod";
import { dateSchema, idSchema, type Person, type Household } from "./domain.js";
export const portalAccessSchema = z
  .object({
    uid: idSchema,
    personId: idSchema,
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative().default(0),
  })
  .strict();
export const directoryPreferencesSchema = z
  .object({
    listed: z.boolean().default(false),
    shareEmail: z.boolean().default(false),
    sharePhone: z.boolean().default(false),
    shareAddress: z.boolean().default(false),
    sharePhoto: z.boolean().default(false),
    expectedRevision: z.number().int().nonnegative().default(0),
  })
  .strict();
export type DirectoryPreferences = z.infer<typeof directoryPreferencesSchema>;
export const eventPublicationSchema = z
  .object({
    eventId: idSchema,
    portalVisible: z.boolean(),
    publicRegistration: z.boolean(),
    description: z.string().trim().max(2000),
    expectedRevision: z.number().int().nonnegative().default(0),
  })
  .strict()
  .refine(
    (row) => !row.publicRegistration || row.portalVisible,
    "Make the event visible before opening public registration",
  );
export const memberRsvpSchema = z
  .object({
    eventId: idSchema,
    date: dateSchema,
    status: z.enum(["yes", "maybe", "no"]),
  })
  .strict();
export const onlineFormSchema = z
  .object({
    requestId: z.uuid(),
    kind: z.enum(["visitor", "event"]),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.email().max(254),
    mobilePhone: z.string().max(40).default(""),
    message: z.string().trim().max(1000).default(""),
    eventId: z.union([idSchema, z.literal("")]).default(""),
    date: z.union([dateSchema, z.literal("")]).default(""),
    website: z.string().max(200).default(""),
  })
  .strict()
  .refine(
    (row) => row.kind !== "event" || (!!row.eventId && !!row.date),
    "Choose an event occurrence",
  );
export const reviewSubmissionSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["approve", "decline"]),
    personId: z.union([idSchema, z.literal("")]).default(""),
  })
  .strict();
export type OnlineSubmission = z.infer<typeof onlineFormSchema> & {
  id: string;
  status: "pending" | "approved" | "declined";
  approvedPersonId?: string;
};
export type DirectoryEntry = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  hasPhoto: boolean;
};
export function portalDirectoryEntry(
  person: Person,
  household: Household | undefined,
  preferences: Pick<
    DirectoryPreferences,
    "listed" | "shareEmail" | "sharePhone" | "shareAddress" | "sharePhoto"
  >,
): DirectoryEntry | null {
  if (
    !preferences.listed ||
    person.isDeceased ||
    !["communicant", "baptized", "nonResident", "adherent"].includes(
      person.membershipStatus,
    )
  )
    return null;
  return {
    id: person.id,
    name: `${person.preferredName || person.firstName} ${person.lastName}`,
    email: preferences.shareEmail ? person.email : "",
    phone: preferences.sharePhone ? person.mobilePhone : "",
    address: preferences.shareAddress ? household?.address || "" : "",
    hasPhoto: preferences.sharePhoto && !!person.photoPath,
  };
}
