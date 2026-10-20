import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { publicBrandingPayload, saveBrandingSchema } from "@sycamore/shared";
import { db } from "./admin.js";
import { parse, requireRoles } from "./access.js";
import { emulatorMode } from "./communications/environment.js";

const churchId = defineString("CHURCH_ID", { default: "not-configured" });
function identity() {
  const projectId = process.env.GCLOUD_PROJECT;
  const id = emulatorMode() ? (process.env.CHURCH_ID || "demo-church") : churchId.value();
  if (!projectId || id === "not-configured")
    throw new HttpsError("failed-precondition", "Church deployment configuration is required.");
  return { projectId, churchId: id };
}
export async function readPublicBranding() {
  const row = await db.doc("publicBranding/church").get();
  try {
    const branding = publicBrandingPayload(row.data() || {});
    const expected = identity();
    if (branding.projectId !== expected.projectId || branding.churchId !== expected.churchId) throw new Error();
    return branding;
  } catch {
    throw new HttpsError("failed-precondition", "Church branding is not configured for this project. Ask an administrator to publish it in Settings.");
  }
}
// Anonymous callers receive only this reviewed projection, never settings/church or provider settings.
export const getPublicBranding = onCall(async () => readPublicBranding());
export const getBrandingSettings = onCall(async (request) => {
  await requireRoles(request, ["admin", "pastor"]);
  const row = await db.doc("publicBranding/church").get();
  return { branding: row.exists ? await readPublicBranding() : null, revision: row.get("revision") ?? 0 };
});
export const savePublicBranding = onCall(async (request) => {
  const actor = await requireRoles(request, ["admin", "pastor"]);
  const { expectedRevision, ...fields } = parse(saveBrandingSchema, request.data);
  if (fields.logo) {
    const bytes = Buffer.from(fields.logo.split(",")[1], "base64");
    // Validate the PNG signature, IHDR, decoded byte limit and dimensions as well as the shared schema.
    if (bytes.length > 65536 || bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
        bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 ||
        bytes.readUInt32BE(16) > 512 || bytes.readUInt32BE(20) > 512)
      throw new HttpsError("invalid-argument", "Choose a PNG logo up to 512 pixels and 64 KB.");
  }
  const branding = publicBrandingPayload({ ...fields, ...identity() });
  await db.runTransaction(async (tx) => {
    const ref = db.doc("publicBranding/church"), before = await tx.get(ref);
    if ((before.get("revision") ?? 0) !== expectedRevision)
      throw new HttpsError("aborted", "Branding changed. Reload it before saving.");
    // Replace this allowlisted document; do not copy protected operational settings into it.
    tx.set(ref, { ...branding, revision: expectedRevision + 1, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  });
  return { saved: true };
});
