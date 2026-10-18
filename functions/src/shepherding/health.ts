import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  SESSION_ROLES,
  assessmentSchema,
  healthSettingsSchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import {
  openRecord,
  protectRecord,
  privateOptions,
} from "../security/encryption.js";

export async function healthSettings() {
  const row = await db.doc("shepherdingSettings/health").get();
  const settings = healthSettingsSchema.parse(
    Object.fromEntries(
      [
        "indicators",
        "attendanceWeeks",
        "attendanceBelowPercent",
        "visitWithinDays",
        "labels",
      ]
        .filter((key) => row.get(key) !== undefined)
        .map((key) => [key, row.get(key)]),
    ),
  );
  return {
    indicators: settings.indicators,
    attendanceWeeks: settings.attendanceWeeks,
    attendanceBelowPercent: settings.attendanceBelowPercent,
    visitWithinDays: settings.visitWithinDays,
    labels: settings.labels,
    revision: Number(row.get("revision") || 0),
  };
}
export const saveHealthSettings = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { expectedRevision, ...input } = parse(
    healthSettingsSchema,
    request.data,
  );
  const ref = db.doc("shepherdingSettings/health");
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "These settings changed. Reopen them before saving.",
      );
    transaction.set(ref, {
      ...input,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});
// Assessments are Session judgments with reasons. Recording one never changes membership or starts discipline.
export const saveAssessment = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(
    assessmentSchema,
    request.data,
  );
  const settings = await healthSettings();
  if (
    input.labelId &&
    !settings.labels.some((label) => label.id === input.labelId)
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose a label from the Session's list.",
    );
  const ref = db.doc(`flockAssessments/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, person] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`people/${input.personId}`)),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This assessment changed. Reopen it before saving.",
      );
    if (
      !person.exists ||
      (before.exists && before.get("personId") !== input.personId)
    )
      throw new HttpsError("invalid-argument", "Choose a person on the roll.");
    const previous = before.exists ? openRecord(ref.path, before.data()!) : {};
    transaction.set(
      ref,
      protectRecord("flockAssessments", ref.path, {
        ...input,
        revision: expectedRevision + 1,
        authorUid: previous.authorUid ?? actor.uid,
        createdAt: previous.createdAt ?? Timestamp.now(),
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});
