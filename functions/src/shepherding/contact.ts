import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  contactNoteKinds,
  contactPolicySchema,
  emptySecuritySchema,
  hasRole,
  personalMessageContact,
  roleSchema,
  smsConsentKeyword,
  type ContactEvent,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { getChurchZone } from "../communications/queue.js";
import { securityEvent } from "../security/audit.js";
import { healthSettings } from "./health.js";

export async function contactPolicy() {
  const row = await db.doc("shepherdingSettings/church").get();
  if (!row.get("historyStart")) return null;
  const policy = contactPolicySchema.parse(
    Object.fromEntries(
      [
        "historyStart",
        "defaultContactDays",
        "districtContactDays",
        "trackedStatuses",
        "countPersonalMessages",
      ]
        .filter((key) => row.get(key) !== undefined)
        .map((key) => [key, row.get(key)]),
    ),
  );
  return {
    historyStart: policy.historyStart,
    defaultContactDays: policy.defaultContactDays,
    districtContactDays: policy.districtContactDays,
    trackedStatuses: policy.trackedStatuses,
    countPersonalMessages: policy.countPersonalMessages,
    revision: Number(row.get("revision") || 0),
  };
}
export const saveContactPolicy = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { expectedRevision, ...input } = parse(
    contactPolicySchema,
    request.data,
  );
  const ref = db.doc("shepherdingSettings/church");
  await db.runTransaction(async (transaction) => {
    const [before, districts] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.collection("elderDistricts")),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "The contact policy changed. Reopen it before saving.",
      );
    const known = new Set(districts.docs.map((row) => row.id));
    if (Object.keys(input.districtContactDays).some((id) => !known.has(id)))
      throw new HttpsError("invalid-argument", "Choose existing districts.");
    // A whole-document write so a cleared district threshold is really removed.
    transaction.set(ref, {
      ...input,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});
// Contact events carry dates and sources only. No note body, message text or reply text leaves here.
export async function contactEvents(countPersonalMessages: boolean) {
  const zone = await getChurchZone();
  const local = (value: Timestamp) =>
    DateTime.fromJSDate(value.toDate(), { zone }).toISODate()!;
  const [notes, visits, inbox, history] = await Promise.all([
    db.collection("careNotes").get(),
    db.collection("pastoralVisits").where("status", "==", "completed").get(),
    db.collection("smsInbox").get(),
    db.collectionGroup("membershipEvents").get(),
  ]);
  const events: ContactEvent[] = [];
  for (const row of notes.docs) {
    const source = contactNoteKinds[row.get("kind")];
    if (source && row.get("personId") && row.get("date"))
      events.push({
        personId: row.get("personId"),
        date: row.get("date"),
        source,
        refId: row.id,
      });
  }
  for (const row of visits.docs) {
    const listed = (row.get("personIds") || []) as string[];
    // Legacy household visits without participants have unknown coverage.
    const visited = listed;
    for (const personId of visited)
      events.push({
        personId,
        date: local(row.get("start")),
        source: "visit",
        refId: row.id,
      });
  }
  for (const row of inbox.docs) {
    if (
      row.get("consentCommand") ||
      !row.get("receivedAt") ||
      smsConsentKeyword(String(row.get("body") || ""))
    )
      continue;
    for (const personId of (row.get("personIds") || []) as string[])
      events.push({
        personId,
        date: local(row.get("receivedAt")),
        source: "textReply",
        refId: row.id,
      });
  }
  if (countPersonalMessages) {
    const sessionSender = new Map<string, boolean>();
    const messages = await db
      .collection("messages")
      .where("source", "==", "compose")
      .get();
    for (const message of messages.docs) {
      const sender = String(message.get("createdByUid") || "");
      if (!sessionSender.has(sender))
        sessionSender.set(
          sender,
          await getAuth()
            .getUser(sender)
            .then((user) =>
              hasRole(
                roleSchema.array().catch([]).parse(user.customClaims?.roles),
                SESSION_ROLES,
              ),
            )
            .catch(() => false),
        );
      const summary = {
        source: "compose",
        audienceKind: String(message.get("audience.kind") || ""),
        selectedPersonIds: (message.get("selectedPersonIds") || []) as string[],
        senderIsSession: sessionSender.get(sender)!,
      };
      if (
        !personalMessageContact(summary, {
          channel: "sms",
          status: "delivered",
        })
      )
        continue;
      const recipients = await message.ref.collection("recipients").get();
      for (const recipient of recipients.docs) {
        const source = personalMessageContact(summary, {
          channel: recipient.get("channel"),
          status: recipient.get("status"),
        });
        if (source && recipient.get("updatedAt"))
          events.push({
            personId: recipient.get("personId"),
            date: local(recipient.get("updatedAt")),
            source,
            refId: message.id,
          });
      }
    }
  }
  const rollEntry: Record<string, string> = {};
  for (const row of history.docs) {
    const personId = row.ref.parent.parent?.id;
    if (
      personId &&
      row.ref.parent.parent?.parent.id === "people" &&
      (!rollEntry[personId] || row.get("date") < rollEntry[personId])
    )
      rollEntry[personId] = row.get("date");
  }
  return {
    events,
    rollEntry,
    today: DateTime.now().setZone(zone).toISODate()!,
  };
}
export const getContactHistory = onCall(async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  const actor = await requireRoles(request, SESSION_ROLES);
  const policy = await contactPolicy();
  const result = await contactEvents(policy?.countPersonalMessages ?? true);
  await securityEvent(actor.uid, "contact.read", "success", "session");
  return { policy, health: await healthSettings(), ...result };
});
