import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  SESSION_ROLES,
  officeRemoveSchema,
  officeSchema,
  officerDecisionSchema,
  officerPolicySchema,
  quorumMeetingSchema,
  quorumPolicySchema,
  wouldOverlap,
  type Office,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { protectRecord, privateOptions } from "../security/encryption.js";

// Office history is church record. The Session keeps it, and staff readers can see it.
export const saveOffice = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(officeSchema, request.data);
  const person = db.doc(`people/${input.personId}`);
  const ref = person.collection("offices").doc(id);
  await db.runTransaction(async (transaction) => {
    const [before, row, others] = await Promise.all([
      transaction.get(ref),
      transaction.get(person),
      transaction.get(person.collection("offices")),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This office record changed. Reopen it before saving.",
      );
    if (!row.exists)
      throw new HttpsError("not-found", "Choose a person on the roll.");
    if (
      wouldOverlap(
        { id, expectedRevision, ...input },
        others.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Office),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        "This overlaps another period in the same office. End the earlier one first.",
      );
    transaction.set(ref, {
      ...input,
      revision: expectedRevision + 1,
      createdAt: before.get("createdAt") ?? Timestamp.now(),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { id };
});
export const removeOffice = onCall(async (request) => {
  await requireRoles(request, SESSION_ROLES);
  const input = parse(officeRemoveSchema, request.data);
  const ref = db.doc(`people/${input.personId}/offices/${input.id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists || before.get("revision") !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This office record changed. Reopen it before removing it.",
      );
    transaction.delete(ref);
  });
  return { removed: true };
});
export const saveOfficerPolicy = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { expectedRevision, ...input } = parse(
    officerPolicySchema,
    request.data,
  );
  const ref = db.doc(`officerPolicies/${input.role}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This policy changed. Reopen it before saving.",
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
// A Session decision is recorded beside the facts. It never changes membership or office records.
export const saveOfficerDecision = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(
    officerDecisionSchema,
    request.data,
  );
  const ref = db.doc(`officerDecisions/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, person] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`people/${input.personId}`)),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This decision changed. Reopen it before saving.",
      );
    if (
      !person.exists ||
      (before.exists && before.get("personId") !== input.personId)
    )
      throw new HttpsError("invalid-argument", "Choose a person on the roll.");
    transaction.set(
      ref,
      protectRecord("officerDecisions", ref.path, {
        ...input,
        revision: expectedRevision + 1,
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        authorUid: before.get("authorUid") ?? actor.uid,
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});
// Quorum rules and meeting attendance are Session records. The report is calculated from them on request.
export const saveQuorumPolicy = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(
    quorumPolicySchema,
    request.data,
  );
  const ref = db.doc(`quorumPolicies/${id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This rule changed. Reopen it before saving.",
      );
    transaction.set(ref, {
      ...input,
      revision: expectedRevision + 1,
      createdAt: before.get("createdAt") ?? Timestamp.now(),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { id };
});
export const saveQuorumMeeting = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(
    quorumMeetingSchema,
    request.data,
  );
  const present = [...new Set(input.presentPersonIds)];
  const ref = db.doc(`quorumMeetings/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, ...people] = await Promise.all([
      transaction.get(ref),
      ...present.map((personId) =>
        transaction.get(db.doc(`people/${personId}`)),
      ),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This meeting changed. Reopen it before saving.",
      );
    if (people.some((row) => !row.exists))
      throw new HttpsError(
        "invalid-argument",
        "Choose people who are on the roll.",
      );
    transaction.set(ref, {
      ...input,
      presentPersonIds: present,
      revision: expectedRevision + 1,
      createdAt: before.get("createdAt") ?? Timestamp.now(),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { id };
});
