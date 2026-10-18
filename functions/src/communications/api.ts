import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import {
  EDITOR_ROLES,
  SESSION_ROLES,
  actionIdSchema,
  bulletinActionSchema,
  bulletinFileSchema,
  communicationSettingsSchema,
  contactConsentSchema,
  hasRole,
  messageInputSchema,
  normalizeEmail,
  normalizePhone,
  savedAudienceSchema,
  templateInputSchema,
  type Role,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { processServingReminders } from "../chms.js";
import { processVisitReminders } from "../shepherding/visits.js";
import { processShepherdingDigests } from "../shepherding/digests.js";
import { parse, requireRoles } from "../access.js";
import { emulatorMode, providerConfig } from "./environment.js";
import { secretOptions } from "./webhooks.js";
import {
  dispatchQueue,
  getSettings,
  identityHash,
  inspectAttachment,
  isSessionPerson,
  queueMessage,
  recipientPreview,
  recount,
} from "./queue.js";
import {
  previewBulletin,
  processBulletins,
  registerBulletin,
  sendBulletin,
} from "./automation.js";
export {
  twilioInbound,
  twilioStatus,
  emailUnsubscribe,
  bulletinDownload,
} from "./webhooks.js";

async function attachments(paths: string[], uid: string) {
  return Promise.all(
    paths.map((path) => {
      if (!path.startsWith(`messageAttachments/${uid}/`))
        throw new HttpsError(
          "permission-denied",
          "Choose an attachment uploaded from your account.",
        );
      return inspectAttachment(path, path.split("/").at(-1)!);
    }),
  );
}
async function allowedMessage(id: string, roles: Role[]) {
  const ref = db.doc(`messages/${id}`);
  const message = await ref.get();
  if (
    !message.exists ||
    (message.get("sessionOnly") && !hasRole(roles, SESSION_ROLES))
  )
    throw new HttpsError("permission-denied", "That message is not available.");
  return ref;
}
export const previewMessage = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const input = parse(messageInputSchema, request.data);
  const result = await recipientPreview(input.audience, input.channel);
  return {
    pending: result.recipients.filter((row) => row.status === "pending").length,
    recipients: result.recipients.map((row) => ({
      ...row,
      name:
        result.people.find((person) => person.id === row.personId)?.firstName ||
        row.personId,
    })),
  };
});
export const createMessage = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(messageInputSchema, request.data);
  if (
    input.scheduledFor &&
    new Date(input.scheduledFor).getTime() < Date.now() - 60000
  )
    throw new HttpsError("invalid-argument", "Choose a future send time.");
  return queueMessage(input, actor.uid, {
    attachments: await attachments(input.attachmentPaths, actor.uid),
  });
});
export const sendTestMessage = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(messageInputSchema, request.data);
  const own = await db.doc(`users/${actor.uid}`).get();
  let personId = own.get("personId") as string | undefined;
  if (!personId && typeof request.auth?.token.email === "string")
    personId = (
      await db
        .collection("people")
        .where("email", "==", normalizeEmail(request.auth.token.email))
        .limit(1)
        .get()
    ).docs[0]?.id;
  if (!personId)
    throw new HttpsError(
      "failed-precondition",
      "Link your account to a person with recorded delivery consent before sending a test.",
    );
  return queueMessage(
    {
      ...input,
      requestId: `test_${input.requestId}`,
      audience: { kind: "people", ids: [personId] },
      scheduledFor: null,
      confirmLarge: true,
      subject: `[Test] ${input.subject}`,
    },
    actor.uid,
    {
      attachments: await attachments(input.attachmentPaths, actor.uid),
      source: "test",
    },
  );
});
export const cancelMessage = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const { id } = parse(actionIdSchema, request.data);
  const ref = await allowedMessage(id, actor.roles);
  await db.runTransaction(async (transaction) => {
    const [message, recipients] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("recipients")),
    ]);
    if (
      message.get("activeCount") > 0 ||
      recipients.docs.some((row) => row.get("status") === "sending")
    )
      throw new HttpsError(
        "failed-precondition",
        "A delivery is already in progress. Wait for it to finish before cancelling the remaining messages.",
      );
    transaction.update(ref, { status: "cancelled" });
    for (const row of recipients.docs)
      if (row.get("status") === "pending")
        transaction.update(row.ref, {
          status: "cancelled",
          updatedAt: Timestamp.now(),
        });
  });
  await recount(ref);
  return { cancelled: true };
});
export const retryFailedMessage = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const { id } = parse(actionIdSchema, request.data);
  const ref = await allowedMessage(id, actor.roles);
  await db.runTransaction(async (transaction) => {
    const [message, recipients] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("recipients")),
    ]);
    if (message.get("activeCount") > 0)
      throw new HttpsError(
        "failed-precondition",
        "Wait for the current delivery to finish.",
      );
    const failed = recipients.docs.filter((row) =>
      ["failed", "undelivered"].includes(row.get("status")),
    );
    if (!failed.length)
      throw new HttpsError(
        "failed-precondition",
        "There are no confirmed failed deliveries to retry. Unknown deliveries need provider review.",
      );
    failed.forEach((row) =>
      transaction.update(row.ref, {
        status: "pending",
        providerId: "",
        attemptKey: "",
        error: "",
      }),
    );
    transaction.update(ref, {
      status: "queued",
      scheduledFor: Timestamp.now(),
    });
  });
  await recount(ref);
  return { queued: true };
});
export const saveMessageTemplate = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(templateInputSchema, request.data);
  await db
    .doc(`messageTemplates/${input.id}`)
    .set({ ...input, updatedBy: actor.uid, updatedAt: Timestamp.now() });
  return { id: input.id };
});
export const saveAudience = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(savedAudienceSchema, request.data);
  await db
    .doc(`savedAudiences/${input.id}`)
    .set({ ...input, updatedBy: actor.uid, updatedAt: Timestamp.now() });
  return { id: input.id };
});
export const markSmsRead = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const { id } = parse(actionIdSchema, request.data);
  await db.doc(`smsInbox/${id}`).update({ read: true });
  return { read: true };
});
export const recordContactConsent = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(contactConsentSchema, request.data);
  let phone: string;
  try {
    phone = normalizePhone(input.mobilePhone);
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Enter a valid mobile number with a country code.",
    );
  }
  const email = normalizeEmail(input.email);
  if ((input.emailOptIn && !email) || (input.smsOptIn && !phone))
    throw new HttpsError(
      "invalid-argument",
      "Add a contact address before recording consent.",
    );
  await db.runTransaction(async (transaction) => {
    const person = db.doc(`people/${input.personId}`);
    const before = await transaction.get(person);
    if (!before.exists)
      throw new HttpsError("not-found", "That person could not be found.");
    if (
      Object.entries(input.expected).some(
        ([field, value]) => before.get(field) !== value,
      )
    )
      throw new HttpsError(
        "aborted",
        "The contact record changed. Reopen it before saving.",
      );
    const next = {
      email,
      mobilePhone: phone,
      emailOptIn: input.emailOptIn,
      smsOptIn: input.smsOptIn,
    };
    const changes = Object.fromEntries(
      Object.entries(next).filter(
        ([field, value]) => before.get(field) !== value,
      ),
    );
    transaction.update(person, {
      ...changes,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
    for (const [channel, address, optedIn] of [
      ["email", email, input.emailOptIn],
      ["sms", phone, input.smsOptIn],
    ] as const) {
      if (!address) continue;
      transaction.set(
        db.doc(`communicationSuppressions/${identityHash(channel, address)}`),
        {
          blocked: !optedIn,
          channel,
          source: "Recorded consent",
          updatedAt: Timestamp.now(),
        },
      );
      transaction.create(db.collection("consentEvents").doc(), {
        personId: input.personId,
        channel,
        optedIn,
        source: input.evidence,
        actor: actor.uid,
        at: Timestamp.now(),
      });
    }
  });
  return { saved: true };
});
export const saveCommunicationSettings = onCall(
  secretOptions,
  async (request) => {
    await requireRoles(request, ["admin", "pastor"]);
    const input = parse(communicationSettingsSchema, request.data);
    const config = providerConfig();
    if (
      (input.emailEnabled && !config.graph) ||
      (input.smsEnabled && !config.twilio)
    )
      throw new HttpsError(
        "failed-precondition",
        "Configure the delivery provider credentials first.",
      );
    if (
      input.bulletinEnabled &&
      (!input.previewPersonId ||
        !input.reminderPersonId ||
        !(await isSessionPerson(input.previewPersonId, true)))
    )
      throw new HttpsError(
        "invalid-argument",
        "Choose a Pastor account linked to a person for previews, and a bulletin reminder person.",
      );
    await db.doc("communicationSettings/church").set(input);
    return { saved: true };
  },
);
export const communicationStatus = onCall(secretOptions, async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  let email = false;
  let sms = false;
  try {
    const config = providerConfig();
    email = !!config.graph;
    sms = !!config.twilio;
  } catch {
    /* No credentials are returned to the renderer. */
  }
  return {
    mode: emulatorMode() ? "simulated" : "live",
    emailConfigured: email,
    smsConfigured: sms,
    settings: await getSettings(),
  };
});
export const registerBulletinFile = onCall(secretOptions, async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const input = parse(bulletinFileSchema, request.data);
  if (!input.path.startsWith(`bulletins/${input.week}/`))
    throw new HttpsError(
      "invalid-argument",
      "Choose a file uploaded for this Lord's Day.",
    );
  await registerBulletin(input.week, {
    ...(await inspectAttachment(input.path, input.name)),
    source: "upload",
    sourceKey: input.path,
    sourceModifiedAt: Timestamp.now(),
  });
  return { registered: true };
});
export const bulletinAction = onCall(secretOptions, async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const input = parse(bulletinActionSchema, request.data);
  if (input.action === "send")
    await sendBulletin(input.week, true, input.confirmedRecipientCount);
  else if (input.action === "preview") await previewBulletin(input.week);
  else
    await db.runTransaction(async (transaction) => {
      const ref = db.doc(`bulletins/${input.week}`);
      const current = await transaction.get(ref);
      if (current.get("messageId") || current.get("status") === "preparing")
        throw new HttpsError(
          "failed-precondition",
          "This bulletin has already been queued.",
        );
      transaction.set(
        ref,
        { week: input.week, status: "skipped" },
        { merge: true },
      );
    });
  return { updated: true };
});
export async function communicationTick(now = new Date()) {
  for (const [name, task] of [
    ["bulletin", processBulletins],
    ["absence", processShepherdingDigests],
    ["serving", processServingReminders],
    ["visit", processVisitReminders],
  ] as const) {
    try {
      await task(now);
      await db
        .doc("automationStatus/church")
        .set(
          { [`${name}Error`]: "", checkedAt: Timestamp.now() },
          { merge: true },
        );
    } catch {
      await db.doc("automationStatus/church").set(
        {
          [`${name}Error`]: `The ${name} job needs attention. Check settings and provider access.`,
          checkedAt: Timestamp.now(),
        },
        { merge: true },
      );
    }
  }
  try {
    await dispatchQueue(now);
    await db
      .doc("automationStatus/church")
      .set({ queueError: "" }, { merge: true });
  } catch {
    await db.doc("automationStatus/church").set(
      {
        queueError:
          "The delivery queue needs attention. Check provider credentials and permissions.",
      },
      { merge: true },
    );
  }
}
export const scheduledCommunications = onSchedule(
  {
    ...secretOptions,
    schedule: "every 1 minutes",
    timeZone: "Etc/UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
  },
  async () => {
    await communicationTick();
  },
);
export const runLocalCommunicationTick = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    await requireRoles(request, ["admin"]);
    if (!emulatorMode())
      throw new HttpsError(
        "failed-precondition",
        "This control is available only in local emulators.",
      );
    const input = parse(
      z.object({ now: z.iso.datetime({ offset: true }).optional() }).strict(),
      request.data ?? {},
    );
    await communicationTick(input.now ? new Date(input.now) : new Date());
    return { processed: true };
  },
);
