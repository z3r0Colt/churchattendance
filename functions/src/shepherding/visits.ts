import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  canCompleteVisit,
  completeVisitSchema,
  emptySecuritySchema,
  hasRole,
  visitLogisticsKeys,
  visitRoundSchema,
  visitReminderDue,
  visitSchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import {
  getChurchZone,
  getSettings,
  queueMessage,
} from "../communications/queue.js";
import {
  openRecord,
  protectRecord,
  privateOptions,
} from "../security/encryption.js";
import { securityEvent } from "../security/audit.js";

export async function liveAccount(uid: string, roles: readonly string[]) {
  const user = await getAuth()
    .getUser(uid)
    .catch(() => null);
  if (
    !user ||
    user.disabled ||
    !Array.isArray(user.customClaims?.roles) ||
    !user.customClaims.roles.some((role: string) => roles.includes(role))
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose enabled accounts with the required church role.",
    );
}
export const saveVisitRound = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, ...input } = parse(
    visitRoundSchema,
    request.data,
  );
  const ref = db.doc(`visitRounds/${id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This visit round changed. Reopen it before saving.",
      );
    transaction.set(ref, {
      ...input,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
      ...(before.exists
        ? { createdAt: before.get("createdAt") }
        : { createdAt: Timestamp.now() }),
    });
  });
  return { id };
});
export const saveVisit = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { id, expectedRevision, start, ...input } = parse(
    visitSchema,
    request.data,
  );
  const zone = await getChurchZone();
  const local = DateTime.fromISO(start).setZone(zone);
  if (!local.isValid)
    throw new HttpsError("invalid-argument", "Choose a valid visit time.");
  await Promise.all([
    ...input.officerUids.map((uid) => liveAccount(uid, SESSION_ROLES)),
    ...input.deaconUids.map((uid) => liveAccount(uid, ["deacon"])),
  ]);
  const ref = db.doc(`pastoralVisits/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, household, people, round, followUp] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`households/${input.householdId}`)),
      transaction.get(
        db.collection("people").where("householdId", "==", input.householdId),
      ),
      input.roundId
        ? transaction.get(db.doc(`visitRounds/${input.roundId}`))
        : null,
      input.followUpId
        ? transaction.get(db.doc(`followUps/${input.followUpId}`))
        : null,
    ]);
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
    if (!household.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    const members = new Set(people.docs.map((row) => row.id));
    if (input.personIds.some((personId) => !members.has(personId)))
      throw new HttpsError(
        "invalid-argument",
        "Choose people who belong to this household.",
      );
    if (round && (!round.exists || round.get("archived")))
      throw new HttpsError(
        "failed-precondition",
        "Choose an active visit round.",
      );
    if (followUp && !followUp.exists)
      throw new HttpsError("not-found", "That follow-up could not be found.");
    transaction.set(
      ref,
      protectRecord("pastoralVisits", ref.path, {
        ...input,
        start: Timestamp.fromMillis(local.toMillis()),
        revision: expectedRevision + 1,
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        authorUid: before.get("authorUid") ?? actor.uid,
      }),
    );
  });
  return { id };
});
export const completeVisit = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(completeVisitSchema, request.data);
  const ref = db.doc(`pastoralVisits/${input.id}`);
  const zone = await getChurchZone();
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists)
      throw new HttpsError("not-found", "That visit could not be found.");
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This visit changed. Reopen it before completing it.",
      );
    const start = (before.get("start") as Timestamp).toDate();
    if (
      !canCompleteVisit(
        { status: before.get("status"), start: start.toISOString() },
        new Date(),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        before.get("status") === "planned"
          ? "A visit can be completed only after its start time."
          : "Only a planned visit can be completed.",
      );
    const visitDate = DateTime.fromJSDate(start, { zone }).toISODate()!;
    const householdId = before.get("householdId") as string;
    let careNoteId = "";
    if (input.record.kind === "link") {
      const note = await transaction.get(
        db.doc(`careNotes/${input.record.careNoteId}`),
      );
      const person = note.exists
        ? await transaction.get(db.doc(`people/${note.get("personId")}`))
        : null;
      if (
        !note.exists ||
        note.get("kind") !== "visit" ||
        person?.get("householdId") !== householdId
      )
        throw new HttpsError(
          "invalid-argument",
          "Link a recorded visit for someone in this household.",
        );
      careNoteId = note.id;
    }
    if (input.record.kind === "create") {
      const noteRef = db.doc(`careNotes/${input.record.noteId}`);
      const [note, person] = await Promise.all([
        transaction.get(noteRef),
        transaction.get(db.doc(`people/${input.record.personId}`)),
      ]);
      if (note.exists)
        throw new HttpsError(
          "already-exists",
          "That visit record already exists.",
        );
      if (
        !person.exists ||
        person.get("householdId") !== householdId ||
        person.get("isDeceased") ||
        person.get("membershipStatus") === "former"
      )
        throw new HttpsError(
          "invalid-argument",
          "Choose an active person from this household.",
        );
      transaction.create(
        noteRef,
        protectRecord("careNotes", noteRef.path, {
          personId: input.record.personId,
          kind: "visit",
          date: visitDate,
          body: input.record.body,
          visitId: ref.id,
          revision: 1,
          authorUid: actor.uid,
          createdAt: Timestamp.now(),
          updatedBy: actor.uid,
          updatedAt: Timestamp.now(),
        }),
      );
      careNoteId = noteRef.id;
    }
    // Re-seal from the opened record so the encrypted purpose survives the status change.
    transaction.set(
      ref,
      protectRecord("pastoralVisits", ref.path, {
        ...openRecord(ref.path, before.data()!),
        status: "completed",
        completedAt: Timestamp.now(),
        completedBy: actor.uid,
        careNoteId,
        revision: input.expectedRevision + 1,
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { completed: true };
});
// Deacons receive scheduling details for joint visits they are invited to, and nothing else.
// Session officers invited to a deacon-led mercy visit likewise receive its logistics only.
export const getVisitLogistics = onCall(async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  const actor = await requireRoles(request, [...SESSION_ROLES, "deacon"]);
  const session = hasRole(actor.roles, SESSION_ROLES);
  const since = Timestamp.fromMillis(Date.now() - 30 * 86_400_000);
  const recent = (collection: string, field: string) =>
    db
      .collection(collection)
      .where(field, "array-contains", actor.uid)
      .where("start", ">=", since)
      .orderBy("start")
      .limit(100)
      .get();
  const [own, mercy] = await Promise.all([
    recent("pastoralVisits", session ? "officerUids" : "deaconUids"),
    session ? recent("mercyVisits", "officerUids") : null,
  ]);
  await securityEvent(actor.uid, "visit.logistics", "success", "session");
  const names = new Map<string, string>();
  const name = async (uid: string, fallback: string) => {
    if (!names.has(uid))
      names.set(
        uid,
        (await getAuth()
          .getUser(uid)
          .then((user) => user.displayName || "")
          .catch(() => "")) || fallback,
      );
    return names.get(uid)!;
  };
  const households = new Map<string, { name: string; address: string }>();
  const rows = [
    ...own.docs.map((row) => ({ row, ministry: "session" as const })),
    ...(mercy?.docs.map((row) => ({ row, ministry: "mercy" as const })) || []),
  ];
  const visits = [];
  for (const { row, ministry } of rows) {
    const id = row.get("householdId") as string;
    if (!households.has(id)) {
      const household = await db.doc(`households/${id}`).get();
      households.set(id, {
        name: household.get("name") || "Household",
        address: household.get("address") || "",
      });
    }
    visits.push({
      id: row.id,
      ministry,
      ...Object.fromEntries(
        visitLogisticsKeys.map((key) => [
          key,
          key === "start"
            ? (row.get("start") as Timestamp).toDate().toISOString()
            : row.get(key),
        ]),
      ),
      householdName: households.get(id)!.name,
      address: households.get(id)!.address,
      officerNames: await Promise.all(
        ((row.get("officerUids") || []) as string[]).map((uid) =>
          name(uid, "Session officer"),
        ),
      ),
      deaconNames:
        ministry === "mercy"
          ? await Promise.all(
              ((row.get("deaconUids") || []) as string[]).map((uid) =>
                name(uid, "Deacon"),
              ),
            )
          : [],
    });
  }
  return { zone: await getChurchZone(), visits };
});
// Reminders carry no household, purpose or note text. A changed plan gets a new revision and message ID.
export async function processVisitReminders(now: Date) {
  const [settings, zone] = await Promise.all([getSettings(), getChurchZone()]);
  if (!settings.emailEnabled && !settings.smsEnabled) return;
  const rows = await db
    .collection("pastoralVisits")
    .where("status", "==", "planned")
    .where("start", ">", Timestamp.fromDate(now))
    .where("start", "<=", Timestamp.fromMillis(now.getTime() + 7 * 86_400_000))
    .get();
  for (const document of rows.docs) {
    const start = (document.get("start") as Timestamp).toDate();
    const revision = Number(document.get("revision") || 0);
    if (
      !visitReminderDue(
        {
          status: "planned",
          start: start.toISOString(),
          reminderHours: Number(document.get("reminderHours") || 0),
        },
        now,
      )
    )
      continue;
    const messageId = `visit_${document.id}_${revision}`;
    if (document.get("reminderMessageId") === messageId) continue;
    const when = DateTime.fromJSDate(start, { zone }).toFormat(
      "LLL d, yyyy 'at' h:mm a",
    );
    for (const audience of ["officers", "deacons"] as const) {
      const uids = (document.get(
        audience === "officers" ? "officerUids" : "deaconUids",
      ) || []) as string[];
      const users = await Promise.all(
        uids.map((uid) => db.doc(`users/${uid}`).get()),
      );
      const personIds = users
        .map((row) => row.get("personId") as string | undefined)
        .filter((id): id is string => !!id);
      if (!personIds.length) continue;
      await queueMessage(
        {
          requestId: `${messageId}_${audience}`,
          channel: settings.emailEnabled ? "email" : "sms",
          subject: "Visit reminder",
          body: `Reminder for {FirstName}: you have a visit scheduled for ${when}. Open the church app for the details.`,
          audience: { kind: "people", ids: [...new Set(personIds)] },
          scheduledFor: null,
          confirmLarge: true,
        },
        "automation",
        {
          automatic: true,
          sessionOnly: audience === "officers",
          source: "visit-reminder",
          pastoralVisit: { id: document.id, revision, audience },
          expiresAt: start,
        },
      );
    }
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (current.get("revision") === revision)
        transaction.update(document.ref, { reminderMessageId: messageId });
    });
  }
}
