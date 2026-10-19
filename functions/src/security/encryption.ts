import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { emulatorMode } from "../communications/environment.js";
export const privateKeys = defineSecret("PRIVATE_RECORD_KEYS");
export const privateOptions = { secrets: [privateKeys] };
export type KeyRing = { active: string; keys: Record<string, string> };
export type Envelope = {
  v: 1;
  key: string;
  iv: string;
  tag: string;
  ciphertext: string;
};
export function keyRing(): KeyRing {
  if (emulatorMode())
    return {
      active: "local",
      keys: {
        local: createHash("sha256")
          .update("fictional-emulator-records-only")
          .digest("base64"),
      },
    };
  const ring = JSON.parse(privateKeys.value()) as KeyRing;
  if (
    !ring.active ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(ring.active) ||
    !ring.keys?.[ring.active]
  )
    throw new Error("Private record key configuration is invalid");
  for (const key of Object.values(ring.keys))
    if (Buffer.from(key, "base64").length !== 32)
      throw new Error("Private record keys must be 256 bits");
  return ring;
}
export function seal(value: unknown, path: string, ring = keyRing()): Envelope {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(ring.keys[ring.active], "base64"),
      iv,
    );
  cipher.setAAD(Buffer.from(path));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    key: ring.active,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function unseal(
  envelope: Envelope,
  path: string,
  ring = keyRing(),
): Record<string, unknown> {
  if (envelope.v !== 1 || !ring.keys[envelope.key])
    throw new Error("Private record key is unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ring.keys[envelope.key], "base64"),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(path));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
const protectedFields: Record<string, string[]> = {
  careNotes: ["body"],
  followUps: ["title"],
  diaconalTasks: ["title"],
  sessionPrivate: ["disciplineFlag", "disciplineHistory"],
  auditLog: ["before", "after"],
  pastoralVisits: ["purpose", "cancelReason"],
  flockAssessments: ["reasons"],
  mercyRequests: ["details", "outcome", "declineReason"],
  mercyNotes: ["body"],
  mercyTasks: ["title"],
  mercyVisits: ["purpose", "cancelReason"],
  bereavementDates: ["note"],
  memberRequests: ["body"],
};
export const protectedFieldNames = (collection: string) =>
  protectedFields[collection] ?? [];
export function protectRecord(
  collection: string,
  path: string,
  data: Record<string, unknown>,
) {
  const fields = protectedFields[collection];
  if (!fields) return data;
  const visible = { ...data },
    secret: Record<string, unknown> = {};
  for (const field of fields)
    if (field in visible) {
      secret[field] = visible[field];
      delete visible[field];
    }
  return { ...visible, encrypted: seal(secret, path) };
}
export function openRecord(path: string, data: Record<string, unknown>) {
  const { encrypted, ...visible } = data;
  return encrypted
    ? { ...visible, ...unseal(encrypted as Envelope, path) }
    : visible;
}
