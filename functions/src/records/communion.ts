import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  EDITOR_ROLES,
  SESSION_ROLES,
  communionBulkSchema,
  communionDecisionSchema,
  communionRecordSchema,
  statisticalOptionsSchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { protectRecord, privateOptions } from "../security/encryption.js";

// Approval to the Lord's Table is a Session act. Nothing else, including membership or an import, sets it.
export const saveCommunionDecision = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, ...input } = parse(communionDecisionSchema, request.data);
  const ref = db.doc(`communionDecisions/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, person] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`people/${input.personId}`)),
    ]);
    // Decisions are never rewritten. A correction is a new, later decision.
    if (before.exists)
      throw new HttpsError(
        "already-exists",
        "This decision is already recorded. Record a new decision to change it.",
      );
    if (!person.exists)
      throw new HttpsError("invalid-argument", "Choose a person on the roll.");
    transaction.create(
      ref,
      protectRecord("communionDecisions", ref.path, {
        ...input,
        authorUid: actor.uid,
        createdAt: Timestamp.now(),
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});
// A deliberate Session action for many communicant members at once. IDs make a retry a no-op.
export const approveCommunicants = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(communionBulkSchema, request.data);
  const ids = [...new Set(input.personIds)];
  const people = await db.getAll(...ids.map((id) => db.doc(`people/${id}`)));
  const refused = people.filter(
    (row) =>
      !row.exists ||
      row.get("isDeceased") ||
      row.get("membershipStatus") !== "communicant",
  );
  if (refused.length)
    throw new HttpsError(
      "invalid-argument",
      "Only living communicant members can be approved together. Record others one at a time.",
    );
  let created = 0;
  const batch = db.batch();
  const existing = await db.getAll(
    ...ids.map((id) => db.doc(`communionDecisions/${input.batchId}_${id}`)),
  );
  for (const [index, id] of ids.entries()) {
    if (existing[index].exists) continue;
    const ref = db.doc(`communionDecisions/${input.batchId}_${id}`);
    batch.create(
      ref,
      protectRecord("communionDecisions", ref.path, {
        personId: id,
        approved: true,
        kind: "member",
        effectiveOn: input.effectiveOn,
        until: "",
        note: input.note,
        authorUid: actor.uid,
        createdAt: Timestamp.now(),
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      }),
    );
    created++;
  }
  if (created) await batch.commit();
  return { created };
});
// Who partook at one service. Recorded by the Session after the service, separately from attendance.
export const saveCommunionRecord = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(communionRecordSchema, request.data);
  const ids = [...new Set(input.personIds)];
  const ref = db.doc(`communionRecords/${input.serviceId}`);
  await db.runTransaction(async (transaction) => {
    const [before, service, ...people] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`services/${input.serviceId}`)),
      ...ids.map((id) => transaction.get(db.doc(`people/${id}`))),
    ]);
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This record changed. Reopen it before saving.",
      );
    if (!service.exists)
      throw new HttpsError("not-found", "Choose a recorded service.");
    if (people.some((row) => !row.exists))
      throw new HttpsError(
        "invalid-argument",
        "Choose people who are on the roll.",
      );
    transaction.set(ref, {
      serviceId: input.serviceId,
      serviceTypeId: service.get("serviceTypeId"),
      date: service.get("date"),
      personIds: ids,
      revision: input.expectedRevision + 1,
      createdAt: before.get("createdAt") ?? Timestamp.now(),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});
export const saveStatisticalOptions = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const options = parse(statisticalOptionsSchema, request.data);
  await db.doc("reportSettings/statisticalOptions").set(options);
  return { saved: true };
});
