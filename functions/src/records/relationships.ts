import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  EDITOR_ROLES,
  relationshipProblem,
  relationshipRemoveSchema,
  relationshipSchema,
  type Relationship,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";

// Family links are ordinary staff-readable records. They grant no directory, portal or care access.
export const saveRelationship = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const { id, expectedRevision, addAnniversary, ...input } = parse(
    relationshipSchema,
    request.data,
  );
  const ref = db.doc(`relationships/${id}`);
  const anniversary = db.doc(`importantDates/wedding_${id}`);
  await db.runTransaction(async (transaction) => {
    // The whole set is read so ancestry cycles are checked against every parent link.
    const [before, links, person, related, existingDate] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.collection("relationships")),
      transaction.get(db.doc(`people/${input.personId}`)),
      transaction.get(db.doc(`people/${input.relatedPersonId}`)),
      transaction.get(anniversary),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This family link changed. Reopen it before saving.",
      );
    if (!person.exists || !related.exists)
      throw new HttpsError(
        "invalid-argument",
        "Choose two people on the roll.",
      );
    const problem = relationshipProblem(
      { id, ...input },
      links.docs.map((row) => ({ ...row.data(), id: row.id }) as Relationship),
    );
    if (problem) throw new HttpsError("failed-precondition", problem);
    transaction.set(ref, {
      ...input,
      revision: expectedRevision + 1,
      createdAt: before.get("createdAt") ?? Timestamp.now(),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
    // An ordinary anniversary record for the living spouse, with no reminder until staff choose one.
    if (addAnniversary && !existingDate.exists && !person.get("isDeceased"))
      transaction.create(anniversary, {
        personId: input.personId,
        kind: "weddingAnniversary",
        label: "",
        date: input.startDate,
        endKind: "never",
        endYear: 0,
        endCount: 0,
        remindDaysBefore: 3,
        remindUid: "",
        revision: 1,
        createdAt: Timestamp.now(),
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      });
  });
  return { id };
});
export const removeRelationship = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const input = parse(relationshipRemoveSchema, request.data);
  const ref = db.doc(`relationships/${input.id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists || before.get("revision") !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This family link changed. Reopen it before removing it.",
      );
    transaction.delete(ref);
  });
  return { removed: true };
});
