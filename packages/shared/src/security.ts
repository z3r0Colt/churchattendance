import { z } from "zod";
import { idSchema, roleSchema } from "./domain.js";

export const emptySecuritySchema = z.object({}).strict();
export const accountListSchema = z
  .object({ after: z.string().max(2048).default("") })
  .strict();
export const accountCreateSchema = z
  .object({
    email: z.string().email().max(254),
    displayName: z.string().trim().min(1).max(100),
    roles: z.array(roleSchema).min(1).max(7),
  })
  .strict();
export const accountActionSchema = z
  .object({
    uid: idSchema,
    action: z.enum(["disable", "enable", "revoke", "recover"]),
  })
  .strict();
// Collections whose protected fields are sealed with the private record key ring.
export const encryptedCollections = [
  "careNotes",
  "followUps",
  "sessionPrivate",
  "diaconalTasks",
  "auditLog",
  "pastoralVisits",
  "flockAssessments",
] as const;
export const privateCollections = [
  ...encryptedCollections,
  "visitRounds",
] as const;
export const privatePageSchema = z
  .object({
    collection: z.enum(privateCollections),
    after: z
      .string()
      .regex(/^[A-Za-z0-9_-]{0,1500}$/)
      .default(""),
    view: z.enum(["full", "report"]).default("full"),
  })
  .strict();
export const migrationPageSchema = privatePageSchema.extend({
  collection: z.enum(encryptedCollections),
  backupConfirmed: z.literal(true),
});
export const securityLogSchema = z
  .object({
    scope: z.enum(["security", "session"]).default("security"),
    after: z
      .string()
      .regex(/^[A-Za-z0-9_-]{0,1500}$/)
      .default(""),
  })
  .strict();
export const passkeyBeginSchema = z
  .object({ email: z.string().email().max(254) })
  .strict();
export const passkeyFinishSchema = z
  .object({
    challengeId: idSchema,
    response: z.record(z.string(), z.unknown()),
  })
  .strict();
export const passkeyRemoveSchema = z
  .object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,1500}$/) })
  .strict();
export const handoffSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    verifier: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const handoffApproveSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    challenge: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type StaffAccount = {
  uid: string;
  email: string;
  displayName: string;
  roles: z.infer<typeof roleSchema>[];
  disabled: boolean;
  emailVerified: boolean;
  factors: number;
};
export type SecurityEvent = {
  scope: "security" | "session";
  id: string;
  actorUid: string;
  action: string;
  outcome: string;
  at: string;
  target: string;
};
