import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  canCompleteVisit,
  canReadMercy,
  completeMercyVisitSchema,
  mercyVisitSchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse } from "../access.js";
import {
  openRecord,
  protectRecord,
  privateOptions,
} from "../security/encryption.js";
import { securityEvent } from "../security/audit.js";
import { getChurchZone } from "../communications/queue.js";
import { liveAccount } from "../shepherding/visits.js";
import { mercyViewer } from "./ministry.js";

// Deacons plan visits for the households and requests they serve. Invited officers see logistics only.
export const saveMercyVisit = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const { id, expectedRevision, start, ...input } = parse(
    mercyVisitSchema,
    request.data,
  );
  const local = DateTime.fromISO(start).setZone(await getChurchZone());
  if (!local.isValid)
    throw new HttpsError("invalid-argument", "Choose a valid visit time.");
  await Promise.all([
    ...input.deaconUids.map((uid) => liveAccount(uid, ["deacon"])),
    ...input.officerUids.map((uid) => liveAccount(uid, SESSION_ROLES)),
  ]);
  const ref = db.doc(`mercyVisits/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, household, assignment, linked] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`households/${input.householdId}`)),
      transaction.get(db.doc(`mercyAssignments/${input.householdId}`)),
      input.requestId
        ? transaction.get(db.doc(`mercyRequests/${input.requestId}`))
        : null,
    ]);
    if (!household.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    if (
      linked &&
      (!linked.exists || linked.get("householdId") !== input.householdId)
    )
      throw new HttpsError(
        "invalid-argument",
        "Link a request for this household.",
      );
    const serving = [
      ...((assignment.get("deaconUids") || []) as string[]),
      ...((linked?.get("deaconUids") || []) as string[]),
    ];
    if (!canReadMercy(viewer, serving)) {
      await securityEvent(
        viewer.uid,
        "mercy.access",
        "denied",
        "mercy",
        ref.path,
      );
      throw new HttpsError(
        "permission-denied",
        "Only the assigned deacons and the Pastor can plan these visits.",
      );
    }
    if (input.deaconUids.some((uid) => !serving.includes(uid)))
      throw new HttpsError(
        "invalid-argument",
        "Choose deacons who serve this household or request.",
      );
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This visit changed. Reopen it before saving.",
      );
    if (before.get("status") === "completed")
      throw new HttpsError(
        "failed-precondition",
        "A completed visit cannot be rescheduled. Plan another visit instead.",
      );
    if (before.exists && before.get("householdId") !== input.householdId)
      throw new HttpsError(
        "invalid-argument",
        "Plan a new visit for another household.",
      );
    transaction.set(
      ref,
      protectRecord("mercyVisits", ref.path, {
        ...input,
        start: Timestamp.fromMillis(local.toMillis()),
        revision: expectedRevision + 1,
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        authorUid: before.get("authorUid") ?? viewer.uid,
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});

// Completion is separate and one-time. A visit plan is never itself a record of care.
export const completeMercyVisit = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const input = parse(completeMercyVisitSchema, request.data);
  const ref = db.doc(`mercyVisits/${input.id}`);
  const zone = await getChurchZone();
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists)
      throw new HttpsError("not-found", "That visit could not be found.");
    const [assignment, linked] = await Promise.all([
      transaction.get(db.doc(`mercyAssignments/${before.get("householdId")}`)),
      before.get("requestId")
        ? transaction.get(db.doc(`mercyRequests/${before.get("requestId")}`))
        : null,
    ]);
    const serving = [
      ...((assignment.get("deaconUids") || []) as string[]),
      ...((linked?.get("deaconUids") || []) as string[]),
    ];
    if (!canReadMercy(viewer, serving)) {
      await securityEvent(
        viewer.uid,
        "mercy.access",
        "denied",
        "mercy",
        ref.path,
      );
      throw new HttpsError(
        "permission-denied",
        "Only the assigned deacons and the Pastor can complete this visit.",
      );
    }
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This visit changed. Reopen it before completing it.",
      );
    const startAt = (before.get("start") as Timestamp).toDate();
    if (
      !canCompleteVisit(
        { status: before.get("status"), start: startAt.toISOString() },
        new Date(),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        before.get("status") === "planned"
          ? "A visit can be completed only after its start time."
          : "Only a planned visit can be completed.",
      );
    let noteId = "";
    if (input.note) {
      // The note ID follows the visit, so a retried completion cannot write a second note.
      const noteRef = db.doc(`mercyNotes/visit_${ref.id}`);
      transaction.create(
        noteRef,
        protectRecord("mercyNotes", noteRef.path, {
          householdId: before.get("householdId"),
          requestId: before.get("requestId") || "",
          date: DateTime.fromJSDate(startAt, { zone }).toISODate(),
          body: input.note,
          authorUid: viewer.uid,
          sharedWithSession: false,
          revision: 1,
          createdAt: Timestamp.now(),
          updatedBy: viewer.uid,
          updatedAt: Timestamp.now(),
        }),
      );
      noteId = noteRef.id;
    }
    transaction.set(
      ref,
      protectRecord("mercyVisits", ref.path, {
        ...openRecord(ref.path, before.data()!),
        status: "completed",
        completedAt: Timestamp.now(),
        completedBy: viewer.uid,
        noteId,
        revision: input.expectedRevision + 1,
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { completed: true };
});
