import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import {
  EDITOR_ROLES,
  eventFromRecord,
  eventOccurrences,
  eventRemindersSchema,
  plainEventText,
  reminderDue,
  reminderMessage,
  reminderVersion,
  type EventReminder,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { getChurchZone, queueMessage } from "../communications/queue.js";

export type EventReminderRef = {
  eventId: string;
  date: string;
  reminderId: string;
  version: string;
};

// Reminders message people, so only Editors (who may send church messages)
// configure them. A group must exist and be active when chosen.
export const saveEventReminders = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(eventRemindersSchema, request.data);
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`events/${input.eventId}`);
    const groupIds = [
      ...new Set(input.reminders.map((row) => row.groupId).filter(Boolean)),
    ];
    const [event, ...groups] = await Promise.all([
      transaction.get(ref),
      ...groupIds.map((id) => transaction.get(db.doc(`groups/${id}`))),
    ]);
    if (!event.exists)
      throw new HttpsError("not-found", "That event could not be found.");
    if (Number(event.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This event changed. Reopen it before saving.",
      );
    if (groups.some((group) => !group.exists || group.get("archived")))
      throw new HttpsError("invalid-argument", "Choose an active group.");
    transaction.update(ref, {
      reminders: input.reminders,
      revision: input.expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

// The people a reminder is for right now: current RSVPs for that date, or
// the group's current members. Consent is checked separately at delivery.
async function audienceFor(
  eventId: string,
  date: string,
  reminder: EventReminder,
) {
  if (reminder.audience === "group") {
    const group = await db.doc(`groups/${reminder.groupId}`).get();
    return !group.exists || group.get("archived")
      ? []
      : ((group.get("memberIds") || []) as string[]);
  }
  const statuses =
    reminder.audience === "attending" ? ["yes"] : ["yes", "maybe"];
  const rsvps = await db
    .collection(`events/${eventId}/rsvps`)
    .where("date", "==", date)
    .get();
  return rsvps.docs
    .filter((row) => statuses.includes(row.get("status")))
    .map((row) => String(row.get("personId")));
}

async function currentReminder(ref: EventReminderRef, zone: string) {
  const event = await db.doc(`events/${ref.eventId}`).get();
  if (!event.exists) return null;
  const series = eventFromRecord(event.id, event.data()!);
  const reminder = series.reminders?.find((row) => row.id === ref.reminderId);
  const occurrence = eventOccurrences(series, ref.date, ref.date, zone)[0];
  if (
    !reminder ||
    !occurrence ||
    occurrence.cancelled ||
    reminderVersion(occurrence, reminder) !== ref.version
  )
    return null;
  return { reminder, occurrence };
}

// Rechecked at dispatch: a cancelled or changed date, a removed reminder, or a
// person who no longer RSVPs or belongs to the group receives nothing.
export async function eventReminderAllowed(
  ref: EventReminderRef,
  personId: string,
) {
  const current = await currentReminder(ref, await getChurchZone());
  return (
    !!current &&
    (await audienceFor(ref.eventId, ref.date, current.reminder)).includes(
      personId,
    )
  );
}

export async function processEventReminders(now: Date) {
  const zone = await getChurchZone();
  const today = DateTime.fromJSDate(now, { zone });
  const from = today.minus({ days: 1 }).toISODate()!,
    to = today.plus({ days: 8 }).toISODate()!;
  const events = await db.collection("events").get();
  for (const row of events.docs) {
    const series = eventFromRecord(row.id, row.data());
    if (!series.reminders?.length) continue;
    for (const occurrence of eventOccurrences(series, from, to, zone))
      for (const reminder of series.reminders) {
        if (!reminderDue(occurrence, reminder, now)) continue;
        const version = reminderVersion(occurrence, reminder);
        const requestId = `event_${row.id}_${occurrence.date}_${reminder.id}_${version}`;
        // One message per date, reminder and version; later ticks skip it.
        if ((await db.doc(`messages/${requestId}`).get()).exists) continue;
        const ids = await audienceFor(row.id, occurrence.date, reminder);
        if (!ids.length) continue;
        await queueMessage(
          {
            requestId,
            channel: reminder.channel,
            subject: `Reminder: ${plainEventText(occurrence.title)}`,
            body: `Hello {FirstName}, a reminder: ${reminderMessage(occurrence, zone)}`,
            audience: { kind: "people", ids },
            scheduledFor: null,
            confirmLarge: true,
          },
          "automation",
          {
            automatic: true,
            source: "event-reminder",
            dateLabel: DateTime.fromISO(occurrence.start)
              .setZone(zone)
              .toFormat("LLLL d, yyyy"),
            eventReminder: {
              eventId: row.id,
              date: occurrence.date,
              reminderId: reminder.id,
              version,
            },
            expiresAt: new Date(occurrence.start),
          },
        );
      }
  }
}
