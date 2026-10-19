import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  EDITOR_ROLES,
  SESSION_ROLES,
  groupSchema,
  groupMarkSchema,
  eventSchema,
  eventFromRecord,
  eventOccurrences,
  rsvpSchema,
  servingSchema,
  careNoteSchema,
  followUpSchema,
  diaconalTaskSchema,
  disciplineSchema,
  taskCompleteSchema,
  sacramentSchema,
  reminderWindow,
  reportLabelsSchema,
  type Serving,
} from "@sycamore/shared";
import { db } from "./admin.js";
import { parse, requireRoles } from "./access.js";
import {
  openRecord,
  protectRecord,
  privateOptions,
} from "./security/encryption.js";
import {
  getChurchZone,
  getSettings,
  queueMessage,
} from "./communications/queue.js";

const organizers = [...EDITOR_ROLES, "deacon"] as const;
export const saveReportLabels = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const labels = parse(reportLabelsSchema, request.data);
  await db.doc("reportSettings/statistical").set({ labels });
  return { saved: true };
});
async function activePerson(id: string) {
  if (!id) return;
  const row = await db.doc(`people/${id}`).get();
  if (
    !row.exists ||
    row.get("isDeceased") ||
    row.get("membershipStatus") === "former"
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose an active person from the roll.",
    );
}
async function assignee(uid: string, roles: readonly string[]) {
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
      "Choose an enabled account with the required church role.",
    );
}
async function save<T extends { id: string; expectedRevision: number }>(
  collection: string,
  input: T,
  uid: string,
) {
  const { id, expectedRevision, ...data } = input;
  const ref = db.doc(`${collection}/${id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This record changed. Reopen it before saving.",
      );
    const privateRecord = ["careNotes", "followUps", "diaconalTasks"].includes(
      collection,
    );
    transaction.set(
      ref,
      {
        ...protectRecord(collection, ref.path, {
          ...(privateRecord && before.exists
            ? openRecord(ref.path, before.data()!)
            : {}),
          ...data,
        }),
        revision: expectedRevision + 1,
        updatedBy: uid,
        updatedAt: Timestamp.now(),
        ...(!before.exists
          ? { createdAt: Timestamp.now(), authorUid: uid }
          : {}),
      },
      { merge: !privateRecord },
    );
  });
  return { id };
}
export const saveGroup = onCall(async (request) => {
  const actor = await requireRoles(request, organizers);
  const input = parse(groupSchema, request.data);
  await Promise.all(
    [...new Set([input.leaderPersonId, ...input.memberIds])].map(activePerson),
  );
  return save(
    "groups",
    { ...input, memberIds: [...new Set(input.memberIds)] },
    actor.uid,
  );
});
export const markGroupAttendance = onCall(async (request) => {
  const actor = await requireRoles(request, organizers);
  const input = parse(groupMarkSchema, request.data);
  const ref = db.doc(`groups/${input.groupId}/meetings/${input.date}`);
  await db.runTransaction(async (transaction) => {
    const [group, person] = await Promise.all([
      transaction.get(db.doc(`groups/${input.groupId}`)),
      transaction.get(db.doc(`people/${input.personId}`)),
    ]);
    if (
      !group.exists ||
      group.get("archived") ||
      !group.get("memberIds")?.includes(input.personId) ||
      !person.exists ||
      person.get("isDeceased") ||
      person.get("membershipStatus") === "former"
    )
      throw new HttpsError(
        "failed-precondition",
        "Choose an active member of this group.",
      );
    transaction.set(
      ref,
      { date: input.date, updatedBy: actor.uid, updatedAt: Timestamp.now() },
      { merge: true },
    );
    transaction.update(
      ref,
      new FieldPath("present", input.personId),
      input.present
        ? { at: Timestamp.now(), byUid: actor.uid }
        : FieldValue.delete(),
    );
  });
  return { saved: true };
});
export const saveChurchEvent = onCall(async (request) => {
  const actor = await requireRoles(request, organizers);
  const input = parse(eventSchema, request.data);
  const zone = await getChurchZone();
  const start = DateTime.fromISO(input.start).setZone(zone);
  if (
    input.recurrence !== "none" &&
    (input.until < start.toISODate()! ||
      input.until > start.plus({ years: 2 }).toISODate()!)
  )
    throw new HttpsError(
      "invalid-argument",
      "End recurring events within two years of their first date.",
    );
  return save(
    "events",
    {
      ...input,
      start: Timestamp.fromDate(new Date(input.start)),
      end: Timestamp.fromDate(new Date(input.end)),
    },
    actor.uid,
  );
});
export const recordRsvp = onCall(async (request) => {
  const actor = await requireRoles(request, organizers);
  const input = parse(rsvpSchema, request.data);
  const ref = db.doc(`events/${input.eventId}`);
  const zone = await getChurchZone();
  await activePerson(input.personId);
  await db.runTransaction(async (transaction) => {
    const [event, responses] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("rsvps").where("date", "==", input.date)),
    ]);
    if (
      !event.exists ||
      !eventOccurrences(
        eventFromRecord(event.id, event.data()!),
        input.date,
        input.date,
        zone,
      ).length
    )
      throw new HttpsError(
        "failed-precondition",
        "That event occurrence is unavailable.",
      );
    const capacity = Number(event.get("capacity") || 0);
    const others = responses.docs.filter(
      (row) =>
        row.id !== `${input.date}_${input.personId}` &&
        row.get("status") === "yes",
    ).length;
    if (input.status === "yes" && capacity && others >= capacity)
      throw new HttpsError(
        "resource-exhausted",
        "This occurrence has reached its registration limit.",
      );
    // Updating the parent serializes capacity checks with concurrent registrations.
    transaction.update(ref, { rsvpVersion: FieldValue.increment(1) });
    transaction.set(
      ref.collection("rsvps").doc(`${input.date}_${input.personId}`),
      { ...input, updatedBy: actor.uid, updatedAt: Timestamp.now() },
    );
  });
  return { saved: true };
});
export const saveServingAssignment = onCall(async (request) => {
  const actor = await requireRoles(request, organizers);
  const input = parse(servingSchema, request.data);
  await activePerson(input.personId);
  const ref = db.doc(`serving/${input.id}`);
  const zone = await getChurchZone();
  const time = DateTime.fromISO(`${input.date}T${input.time}`, { zone });
  if (
    !time.isValid ||
    time.toFormat("HH:mm") !== input.time ||
    time.getPossibleOffsets().length !== 1
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose an unambiguous church time.",
    );
  await db.runTransaction(async (transaction) => {
    const [before, assignments] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.collection("serving").where("date", "==", input.date)),
    ]);
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This assignment changed. Reopen it before saving.",
      );
    const slotId = (personId: string, date: string, time: string) =>
      `${personId}_${date}_${time.replace(":", "")}`;
    const oldKey =
      before.exists && before.get("personId") && !before.get("cancelled")
        ? slotId(before.get("personId"), before.get("date"), before.get("time"))
        : "";
    const newKey =
      input.personId && !input.cancelled
        ? slotId(input.personId, input.date, input.time)
        : "";
    const keys = [...new Set([oldKey, newKey].filter(Boolean))];
    const slots = await Promise.all(
      keys.map((key) => transaction.get(db.doc(`servingSlots/${key}`))),
    );
    if (
      newKey &&
      slots.find((row) => row.id === newKey)?.get("assignmentId") &&
      slots.find((row) => row.id === newKey)!.get("assignmentId") !== input.id
    )
      throw new HttpsError(
        "already-exists",
        "This person already has an assignment at that time.",
      );
    if (
      !input.cancelled &&
      input.personId &&
      assignments.docs.some(
        (row) =>
          row.id !== input.id &&
          !row.get("cancelled") &&
          row.get("personId") === input.personId &&
          row.get("time") === input.time,
      )
    )
      throw new HttpsError(
        "already-exists",
        "This person already has an assignment at that time.",
      );
    const { expectedRevision, ...data } = input;
    if (
      oldKey &&
      oldKey !== newKey &&
      slots.find((row) => row.id === oldKey)?.get("assignmentId") === input.id
    )
      transaction.delete(db.doc(`servingSlots/${oldKey}`));
    if (newKey)
      transaction.set(db.doc(`servingSlots/${newKey}`), {
        assignmentId: input.id,
      });
    transaction.set(ref, {
      ...data,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { id: input.id };
});
export const saveCareNote = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(careNoteSchema, request.data);
  await activePerson(input.personId);
  return save("careNotes", input, actor.uid);
});
export const saveFollowUp = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(followUpSchema, request.data);
  await Promise.all([
    activePerson(input.personId),
    assignee(input.assignedToUid, SESSION_ROLES),
  ]);
  return save("followUps", input, actor.uid);
});
export const saveDiaconalTask = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(diaconalTaskSchema, request.data);
  await Promise.all([
    activePerson(input.personId),
    assignee(input.assignedToUid, ["deacon"]),
  ]);
  return save("diaconalTasks", input, actor.uid);
});
export const completeDiaconalTask = onCall(async (request) => {
  const actor = await requireRoles(request, [...SESSION_ROLES, "deacon"]);
  const { id } = parse(taskCompleteSchema, request.data);
  const ref = db.doc(`diaconalTasks/${id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (
      !before.exists ||
      (!actor.roles.some((role) => SESSION_ROLES.includes(role)) &&
        before.get("assignedToUid") !== actor.uid)
    )
      throw new HttpsError(
        "permission-denied",
        "That task is not assigned to you.",
      );
    transaction.update(ref, {
      done: true,
      revision: FieldValue.increment(1),
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { done: true };
});
export const recordDiscipline = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(disciplineSchema, request.data);
  await activePerson(input.personId);
  const ref = db.doc(`sessionPrivate/${input.personId}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "The private record changed. Reopen it before saving.",
      );
    const plain = openRecord(ref.path, before.data() || {});
    const history = Array.isArray(plain.disciplineHistory)
      ? plain.disciplineHistory
      : [];
    transaction.set(
      ref,
      protectRecord("sessionPrivate", ref.path, {
        disciplineFlag: input.disciplineFlag,
        disciplineHistory: [
          ...history,
          {
            date: input.date,
            entry: input.entry,
            byUid: actor.uid,
            flag: input.disciplineFlag,
          },
        ],
        revision: input.expectedRevision + 1,
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { saved: true };
});
export const saveSacrament = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(sacramentSchema, request.data);
  await activePerson(input.personId);
  return save(`people/${input.personId}/sacraments`, input, actor.uid);
});
export const getCareAssignees = onCall(async (request) => {
  await requireRoles(request, SESSION_ROLES);
  const users = await db.collection("users").get();
  const rows = await Promise.all(
    users.docs.map(async (row) => {
      const user = await getAuth()
        .getUser(row.id)
        .catch(() => null);
      return user && !user.disabled
        ? {
            id: row.id,
            name: user.displayName || user.email || row.id,
            roles: user.customClaims?.roles || [],
          }
        : null;
    }),
  );
  return rows.filter(Boolean);
});
export const getReportingRecords = onCall(async (request) => {
  await requireRoles(request, [...EDITOR_ROLES, "deacon", "readOnly"]);
  const [history, sacraments] = await Promise.all([
    db.collectionGroup("membershipEvents").get(),
    db.collectionGroup("sacraments").get(),
  ]);
  const rows = (snapshot: typeof history, kind: string) =>
    snapshot.docs
      .filter((row) =>
        new RegExp(`^people/[^/]+/${kind}/[^/]+$`).test(row.ref.path),
      )
      .map((row) => ({
        ...row.data(),
        id: row.id,
        personId: row.ref.parent.parent!.id,
      }));
  return {
    history: rows(history, "membershipEvents"),
    sacraments: rows(sacraments, "sacraments"),
  };
});
export async function processServingReminders(now: Date) {
  const [settings, zone] = await Promise.all([getSettings(), getChurchZone()]);
  if (!settings.smsEnabled) return;
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  const rows = await db
    .collection("serving")
    .where("date", ">=", today)
    .where(
      "date",
      "<=",
      DateTime.fromJSDate(now, { zone }).plus({ days: 7 }).toISODate(),
    )
    .get();
  for (const document of rows.docs) {
    const row = { ...document.data(), id: document.id } as Serving & {
      reminderMessageId?: string;
    };
    if (!reminderWindow(row, now, zone)) continue;
    const messageId = `serving_${document.id}_${row.revision}`;
    if (row.reminderMessageId === messageId) continue;
    await queueMessage(
      {
        requestId: messageId,
        channel: "sms",
        subject: "",
        body: `Serving reminder for {FirstName}: ${row.role}, ${row.date} at ${DateTime.fromFormat(row.time, "HH:mm").toFormat("h:mm a")}${row.location ? ` at ${row.location}` : ""}. Please contact the church office if you cannot serve.`,
        audience: { kind: "people", ids: [row.personId] },
        scheduledFor: null,
        confirmLarge: true,
      },
      "automation",
      {
        automatic: true,
        source: "serving-reminder",
        servingAssignment: { id: document.id, revision: row.revision },
        expiresAt: DateTime.fromISO(`${row.date}T${row.time}`, {
          zone,
        }).toJSDate(),
      },
    );
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (current.get("revision") === row.revision)
        transaction.update(document.ref, { reminderMessageId: messageId });
    });
  }
}
