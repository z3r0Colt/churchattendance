import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  EDITOR_ROLES,
  SESSION_ROLES,
  bereavementDateSchema,
  dateRemoveSchema,
  emptySecuritySchema,
  importantDateSchema,
  reminderDueOn,
  roleSchema,
  type BereavementDate,
  type ImportantDate,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { protectRecord, privateOptions } from "../security/encryption.js";
import {
  getChurchZone,
  getSettings,
  queueMessage,
} from "../communications/queue.js";

import { reminderRoles, type DateCollection } from "../communications/queue.js";
// A reminder goes to a live staff account that is linked to a person, so it can be delivered.
async function reminderAccount(uid: string, collection: DateCollection) {
  if (!uid) return;
  const [user, row] = await Promise.all([
    getAuth()
      .getUser(uid)
      .catch(() => null),
    db.doc(`users/${uid}`).get(),
  ]);
  const roles = roleSchema.array().catch([]).parse(user?.customClaims?.roles);
  if (
    !user ||
    user.disabled ||
    !roles.some((role) => reminderRoles[collection].includes(role)) ||
    !row.get("personId")
  )
    throw new HttpsError(
      "invalid-argument",
      collection === "bereavementDates"
        ? "Choose a Session officer whose account is linked to a person."
        : "Choose a staff member whose account is linked to a person.",
    );
}
async function save(
  collection: DateCollection,
  actor: string,
  input: { id: string; expectedRevision: number } & Record<string, unknown>,
) {
  const { id, expectedRevision, ...data } = input;
  const ref = db.doc(`${collection}/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, person, related] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`people/${data.personId}`)),
      data.relatedPersonId
        ? transaction.get(db.doc(`people/${data.relatedPersonId}`))
        : null,
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This date changed. Reopen it before saving.",
      );
    if (!person.exists || person.get("isDeceased"))
      throw new HttpsError(
        "invalid-argument",
        "Choose a living person for the reminder.",
      );
    // The related person may be deceased. The link is kept without making them a recipient.
    if (related && !related.exists)
      throw new HttpsError("not-found", "Choose an existing related person.");
    transaction.set(
      ref,
      protectRecord(collection, ref.path, {
        ...data,
        revision: expectedRevision + 1,
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        updatedBy: actor,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
}
export const saveImportantDate = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(importantDateSchema, request.data);
  await reminderAccount(input.remindUid, "importantDates");
  return save("importantDates", actor.uid, input);
});
export const saveBereavementDate = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(bereavementDateSchema, request.data);
  await reminderAccount(input.remindUid, "bereavementDates");
  return save("bereavementDates", actor.uid, input);
});
async function remove(collection: DateCollection, data: unknown) {
  const input = parse(dateRemoveSchema, data);
  const ref = db.doc(`${collection}/${input.id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists || before.get("revision") !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This date changed. Reopen it before removing it.",
      );
    transaction.delete(ref);
  });
  return { removed: true };
}
export const removeImportantDate = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  return remove("importantDates", request.data);
});
export const removeBereavementDate = onCall(async (request) => {
  await requireRoles(request, SESSION_ROLES);
  return remove("bereavementDates", request.data);
});
export const getReminderRecipients = onCall(async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  await requireRoles(request, EDITOR_ROLES);
  const users = await db.collection("users").get();
  const rows = await Promise.all(
    users.docs.map(async (row) => {
      const user = await getAuth()
        .getUser(row.id)
        .catch(() => null);
      const roles = roleSchema
        .array()
        .catch([])
        .parse(user?.customClaims?.roles);
      return user &&
        !user.disabled &&
        row.get("personId") &&
        roles.some((role) => reminderRoles.importantDates.includes(role))
        ? { id: row.id, name: user.displayName || user.email || row.id, roles }
        : null;
    }),
  );
  return rows.filter((row) => row !== null);
});

// Only the reminder due on today's church date is queued, so missed days never produce a backlog.
export async function processDateReminders(now: Date) {
  const settings = await getSettings();
  if (!settings.dateRemindersEnabled) return;
  if (!settings.emailEnabled && !settings.smsEnabled) return;
  const zone = await getChurchZone();
  const local = DateTime.fromJSDate(now, { zone });
  if (local.hour < settings.dateReminderHour) return;
  const today = local.toISODate()!;
  const [people, ordinary, bereavement] = await Promise.all([
    db.collection("people").get(),
    db.collection("importantDates").get(),
    db.collection("bereavementDates").get(),
  ]);
  const name = (id: string) => {
    const row = people.docs.find((person) => person.id === id);
    return row
      ? `${row.get("preferredName") || row.get("firstName")} ${row.get("lastName")}`.replace(
          /[{}]/g,
          "",
        )
      : "";
  };
  for (const [collection, rows] of [
    ["importantDates", ordinary],
    ["bereavementDates", bereavement],
  ] as const) {
    for (const document of rows.docs) {
      const row = document.data() as ImportantDate | BereavementDate;
      const due = reminderDueOn(row, today);
      if (!due || !row.remindUid || !name(row.personId)) continue;
      const recipient = (await db.doc(`users/${row.remindUid}`).get()).get(
        "personId",
      ) as string | undefined;
      if (!recipient) continue;
      const when = DateTime.fromISO(due.date).toFormat("LLL d");
      // No kind, note or related person. The body never says why the date matters.
      await queueMessage(
        {
          requestId: `date_${document.id}_${due.date}`,
          channel: settings.emailEnabled ? "email" : "sms",
          subject: "Important date reminder",
          body: `Reminder for {FirstName}: an important date for ${name(row.personId)} is on ${when}. Open the church app for details.`,
          audience: { kind: "people", ids: [recipient] },
          scheduledFor: null,
          confirmLarge: true,
        },
        "automation",
        {
          automatic: true,
          sessionOnly: collection === "bereavementDates",
          source: "date-reminder",
          importantDate: {
            collection,
            id: document.id,
            occurrence: due.date,
            remindUid: row.remindUid,
          },
          expiresAt: DateTime.fromISO(due.remindOn, { zone })
            .endOf("day")
            .toJSDate(),
        },
      );
    }
  }
}
