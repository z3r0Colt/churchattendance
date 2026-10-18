import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { DateTime } from "luxon";
import { randomBytes, createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { bulletinClock } from "@sycamore/shared";
import { db } from "../admin.js";
import { providers } from "./providers.js";
import {
  getChurchZone,
  getSettings,
  inspectAttachment,
  isSessionPerson,
  queueMessage,
  type StoredAttachment,
} from "./queue.js";
import { providerConfig } from "./environment.js";

type BulletinFile = StoredAttachment & {
  source: "upload" | "onedrive";
  sourceModifiedAt: Timestamp;
  sourceKey: string;
};
export async function registerBulletin(week: string, file: BulletinFile) {
  if (DateTime.fromISO(week).weekday !== 7)
    throw new HttpsError(
      "invalid-argument",
      "Choose the Lord's Day date for this bulletin.",
    );
  const ref = db.doc(`bulletins/${week}`);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.get("messageId") || current.get("status") === "preparing")
      throw new HttpsError(
        "failed-precondition",
        "This week's bulletin has already been queued. Its attachment cannot be changed.",
      );
    if (current.get("file.sourceKey") === file.sourceKey) return;
    transaction.set(
      ref,
      {
        week,
        file,
        status: current.get("status") === "skipped" ? "skipped" : "ready",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
  await previewBulletin(week);
}
export async function previewBulletin(week: string) {
  const [settings, bulletin] = await Promise.all([
    getSettings(),
    db.doc(`bulletins/${week}`).get(),
  ]);
  if (
    !bulletin.get("file") ||
    !settings.previewPersonId ||
    !(await isSessionPerson(settings.previewPersonId, true))
  )
    return;
  const file = bulletin.get("file") as BulletinFile;
  const version = createHash("sha256")
    .update(`${file.path}:${file.generation}`)
    .digest("hex")
    .slice(0, 20);
  await queueMessage(
    {
      requestId: `preview_${week}_${version}`,
      channel: "email",
      subject: `[Preview] ${settings.bulletinSubject}`,
      body: settings.bulletinBody,
      audience: { kind: "people", ids: [settings.previewPersonId] },
      scheduledFor: null,
      confirmLarge: true,
    },
    "automation",
    {
      automatic: true,
      attachments: [file],
      source: "bulletin-preview",
      dateLabel: DateTime.fromISO(week).toFormat("LLL d, yyyy"),
    },
  );
  await bulletin.ref.set(
    { previewMessageId: `preview_${week}_${version}` },
    { merge: true },
  );
}
export async function sendBulletin(
  week: string,
  manual = false,
  confirmedRecipientCount: number | null = null,
) {
  const settings = await getSettings();
  const ref = db.doc(`bulletins/${week}`);
  if (!settings.emailEnabled)
    throw new HttpsError(
      "failed-precondition",
      "Enable email delivery before sending the bulletin.",
    );
  const existing = await ref.get();
  if (manual && existing.get("messageId")) {
    const messageRef = db.doc(`messages/${existing.get("messageId")}`);
    await db.runTransaction(async (transaction) => {
      const [message, recipients] = await Promise.all([
        transaction.get(messageRef),
        transaction.get(messageRef.collection("recipients")),
      ]);
      const expired = recipients.docs.filter(
        (row) => row.get("status") === "expired",
      );
      if (!expired.length || message.get("activeCount") > 0)
        throw new HttpsError(
          "failed-precondition",
          "This bulletin is already queued or complete.",
        );
      if (expired.length > 20 && confirmedRecipientCount !== expired.length)
        throw new HttpsError(
          "failed-precondition",
          "Review and confirm the remaining recipient count again.",
        );
      for (const row of expired)
        transaction.update(row.ref, {
          status: "pending",
          error: "",
          attemptKey: "",
          providerId: "",
        });
      transaction.update(messageRef, {
        status: "queued",
        scheduledFor: Timestamp.now(),
        expiresAt: null,
        manuallyResumedAt: Timestamp.now(),
      });
    });
    return;
  }
  const cutoff = DateTime.fromISO(week, { zone: await getChurchZone() })
    .minus({ days: 1 })
    .set({
      hour: Number(settings.cutoffTime.slice(0, 2)),
      minute: Number(settings.cutoffTime.slice(3)),
      second: 0,
      millisecond: 0,
    })
    .toJSDate();
  let file: BulletinFile | null = null;
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (
      !current.exists ||
      !current.get("file") ||
      current.get("messageId") ||
      (!manual && current.get("status") === "skipped")
    )
      return;
    if (
      current.get("status") === "preparing" &&
      current.get("preparingAt")?.toMillis() > Date.now() - 10 * 60000
    )
      return;
    file = current.get("file") as BulletinFile;
    transaction.update(ref, {
      status: "preparing",
      preparingAt: Timestamp.now(),
    });
  });
  if (!file) return;
  const attachment = file as BulletinFile;
  try {
    await queueMessage(
      {
        requestId: `bulletin_${week}`,
        channel: "email",
        subject: settings.bulletinSubject,
        body: settings.bulletinBody,
        audience: { kind: "all", ids: [] },
        scheduledFor: null,
        confirmLarge: true,
        confirmedRecipientCount,
      },
      "automation",
      {
        automatic: !manual,
        attachments: [attachment],
        source: "bulletin",
        dateLabel: DateTime.fromISO(week).toFormat("LLL d, yyyy"),
        expiresAt: manual ? undefined : cutoff,
      },
    );
    let publicUrl = "";
    if (
      settings.bulletinSms &&
      settings.shareBulletinLink &&
      settings.smsEnabled
    ) {
      // The PDF is shareable only after an administrator explicitly enables bulletin links.
      const token = randomBytes(24).toString("hex");
      await db.doc(`bulletinLinks/${token}`).set({
        path: attachment.path,
        generation: attachment.generation,
        week,
        createdAt: Timestamp.now(),
      });
      publicUrl = `${providerConfig().publicFunctionsUrl}/bulletinDownload?token=${token}`;
      await queueMessage(
        {
          requestId: `bulletin-sms_${week}`,
          channel: "sms",
          subject: "",
          body: `The bulletin for Lord's Day ${week} is available. ${publicUrl}`,
          audience: { kind: "all", ids: [] },
          scheduledFor: null,
          confirmLarge: true,
        },
        "automation",
        {
          automatic: true,
          source: "bulletin-sms",
          expiresAt: manual ? undefined : cutoff,
        },
      );
    }
    await ref.set(
      {
        status: "queued",
        messageId: `bulletin_${week}`,
        publicUrl,
        queuedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (error) {
    await ref.set(
      {
        status: "ready",
        error:
          "The bulletin could not be queued. Review communication settings and try again.",
      },
      { merge: true },
    );
    throw error;
  }
}
export async function processBulletins(now: Date) {
  const settings = await getSettings();
  if (!settings.bulletinEnabled) return;
  const clock = bulletinClock(now, await getChurchZone(), settings);
  const ref = db.doc(`bulletins/${clock.week}`);
  let current = await ref.get();
  if (!current.exists) {
    await ref.set(
      {
        week: clock.week,
        status: "waiting",
        updatedAt: Timestamp.fromDate(now),
      },
      { merge: true },
    );
    current = await ref.get();
  }
  if (
    !current.get("messageId") &&
    current.get("status") !== "skipped" &&
    settings.driveId &&
    settings.folderId
  ) {
    const latest = await providers().email?.latestPdf(
      settings.driveId,
      settings.folderId,
      clock.mondayStart,
    );
    if (
      latest &&
      Date.parse(latest.modified) >
        Number(current.get("file.sourceModifiedAt")?.toMillis() ?? 0)
    ) {
      if (!latest.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error("The OneDrive bulletin is not a valid PDF");
      const hash = createHash("sha256")
        .update(`${latest.id}:${latest.modified}`)
        .digest("hex");
      const path = `bulletins/${clock.week}/${hash}.pdf`;
      const object = getStorage().bucket().file(path);
      await object
        .save(latest.bytes, {
          resumable: false,
          contentType: "application/pdf",
          preconditionOpts: { ifGenerationMatch: 0 },
        })
        .catch(async (error) => {
          if (Number(error.code) !== 412) throw error;
        });
      await registerBulletin(clock.week, {
        ...(await inspectAttachment(path, latest.name)),
        source: "onedrive",
        sourceKey: hash,
        sourceModifiedAt: Timestamp.fromDate(new Date(latest.modified)),
      });
      current = await ref.get();
    }
  }
  if (clock.remind && !current.get("file") && settings.reminderPersonId) {
    await queueMessage(
      {
        requestId: `bulletin-reminder_${clock.week}`,
        channel: "email",
        subject: "Bulletin PDF needed",
        body: "The bulletin PDF has not arrived for the coming Lord's Day. Please upload it in the app or save it in the configured Bulletin folder.",
        audience: { kind: "people", ids: [settings.reminderPersonId] },
        scheduledFor: null,
        confirmLarge: true,
      },
      "automation",
      { automatic: true, source: "bulletin-reminder" },
    );
  }
  if (clock.send && current.get("file") && current.get("status") !== "skipped")
    await sendBulletin(clock.week);
}
