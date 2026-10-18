import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/v2/https";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  audiencePeople,
  chooseRecipients,
  communicationSettingsSchema,
  mergeFields,
  normalizeEmail,
  normalizePhone,
  type Audience,
  type Channel,
  type CommunicationSettings,
  type MessageInput,
  type Person,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { providerConfig } from "./environment.js";
import { DeliveryError, providers, type Attachment } from "./providers.js";

export type StoredAttachment = {
  path: string;
  name: string;
  generation: string;
  size: number;
};
export type StoredMessage = {
  channel: "email" | "sms" | "both";
  subject: string;
  body: string;
  audience: Audience;
  scheduledFor: Timestamp;
  status: string;
  createdByUid: string;
  selectedPersonIds: string[];
  sessionOnly: boolean;
  attachments: StoredAttachment[];
  activeCount: number;
  source: string;
  serviceTime: string;
  dateLabel: string;
  expiresAt: Timestamp | null;
  servingAssignment?: { id: string; revision: number } | null;
  pastoralVisit?: {
    id: string;
    revision: number;
    audience: "officers" | "deacons";
  } | null;
  // Session-only log entries addressed to deacons are rechecked against a live deacon role.
  recipientRole?: "deacon" | null;
};
export const identityHash = (channel: Channel, address: string) =>
  createHash("sha256").update(`${channel}:${address}`).digest("hex");
export async function getSettings(): Promise<CommunicationSettings> {
  return communicationSettingsSchema.parse(
    (await db.doc("communicationSettings/church").get()).data() ?? {},
  );
}
export async function getChurchZone() {
  return (
    ((await db.doc("settings/church").get()).get("timeZone") as string) ||
    "America/Indiana/Indianapolis"
  );
}
export async function peopleForAudience(audience: Audience) {
  if (audience.kind === "saved") {
    const saved = await db.doc(`savedAudiences/${audience.ids[0]}`).get();
    if (!saved.exists || saved.get("audience.kind") === "saved")
      throw new HttpsError(
        "invalid-argument",
        "Choose an existing saved list.",
      );
    audience = saved.get("audience") as Audience;
  }
  const [people, groups] = await Promise.all([
    db.collection("people").get(),
    audience.kind === "group" ? db.collection("groups").get() : null,
  ]);
  return audiencePeople(
    people.docs.map((row) => ({ ...row.data(), id: row.id }) as Person),
    audience,
    groups?.docs.map((row) => ({
      id: row.id,
      memberIds: row.get("memberIds") ?? [],
    })) ?? [],
  );
}
export async function recipientPreview(
  audience: Audience,
  channel: "email" | "sms" | "both",
) {
  const people = await peopleForAudience(audience);
  const recipients = chooseRecipients(people, channel);
  await Promise.all(
    recipients
      .filter((row) => row.status === "pending")
      .map(async (row) => {
        if (
          (
            await db
              .doc(
                `communicationSuppressions/${identityHash(row.channel, row.address)}`,
              )
              .get()
          ).get("blocked") === true
        ) {
          row.status = "skipped";
          row.error = "Address opted out";
        }
      }),
  );
  return { people, recipients };
}
export function unsubscribeToken(personId: string, email: string) {
  const payload = Buffer.from(
    JSON.stringify({ personId, address: normalizeEmail(email) }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", providerConfig().unsubscribeSecret).update(payload).digest("base64url")}`;
}
export async function inspectAttachment(
  path: string,
  name: string,
): Promise<StoredAttachment> {
  const file = getStorage().bucket().file(path);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (
    metadata.contentType !== "application/pdf" ||
    !size ||
    size > 20 * 1024 * 1024
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose a PDF no larger than 20 MB.",
    );
  const [header] = await file.download({ start: 0, end: 4 });
  if (header.toString() !== "%PDF-")
    throw new HttpsError("invalid-argument", "That file is not a PDF.");
  const originalName =
    typeof metadata.metadata?.originalName === "string"
      ? metadata.metadata.originalName.slice(0, 150)
      : name;
  return {
    path,
    name: originalName,
    generation: String(metadata.generation),
    size,
  };
}
export async function queueMessage(
  input: Pick<
    MessageInput,
    | "requestId"
    | "channel"
    | "subject"
    | "body"
    | "audience"
    | "scheduledFor"
    | "confirmLarge"
  > & { confirmedRecipientCount?: number | null },
  actor: string,
  options: {
    attachments?: StoredAttachment[];
    sessionOnly?: boolean;
    source?: string;
    dateLabel?: string;
    serviceTime?: string;
    automatic?: boolean;
    expiresAt?: Date;
    servingAssignment?: { id: string; revision: number };
    pastoralVisit?: StoredMessage["pastoralVisit"];
    recipientRole?: "deacon";
  } = {},
) {
  const settings = await getSettings();
  const { people, recipients } = await recipientPreview(
    input.audience,
    input.channel,
  );
  let serviceTime = options.serviceTime || "";
  if (
    !serviceTime &&
    `${input.subject} ${input.body}`.includes("{ServiceTime}")
  ) {
    const types = await db
      .collection("serviceTypes")
      .where("isActive", "==", true)
      .get();
    const morning =
      types.docs.find((row) => /morning/i.test(row.get("name"))) ||
      types.docs
        .filter((row) => row.get("dayOfWeek") === 0)
        .sort((a, b) =>
          String(a.get("defaultTime")).localeCompare(
            String(b.get("defaultTime")),
          ),
        )[0];
    if (!morning)
      throw new HttpsError(
        "failed-precondition",
        "Set an active Lord's Day service before using the ServiceTime field.",
      );
    serviceTime = DateTime.fromFormat(
      morning.get("defaultTime"),
      "HH:mm",
    ).toFormat("h:mm a");
  }
  const pending = recipients.filter((row) => row.status === "pending");
  if (recipients.length > 400)
    throw new HttpsError(
      "resource-exhausted",
      "Choose a smaller list, up to 400 email and text deliveries per message.",
    );
  if (!options.automatic && !pending.length)
    throw new HttpsError(
      "failed-precondition",
      "No selected people have a contact address and consent for this message.",
    );
  if (
    !options.automatic &&
    pending.length > 20 &&
    (!input.confirmLarge || input.confirmedRecipientCount !== pending.length)
  )
    throw new HttpsError(
      "failed-precondition",
      "The recipient count needs confirmation. Preview the current list and confirm it again.",
    );
  if (
    !options.automatic &&
    pending.some((row) =>
      row.channel === "email" ? !settings.emailEnabled : !settings.smsEnabled,
    )
  )
    throw new HttpsError(
      "failed-precondition",
      "Enable the selected delivery channels in Communication settings first.",
    );
  const ref = db.doc(`messages/${input.requestId}`);
  const attachments = options.attachments ?? [];
  if (
    attachments.reduce((total, item) => total + item.size, 0) >
    20 * 1024 * 1024
  )
    throw new HttpsError(
      "invalid-argument",
      "Keep the combined attachments under 20 MB.",
    );
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.get("createdByUid") !== actor)
        throw new HttpsError(
          "already-exists",
          "That message request already exists.",
        );
      return;
    }
    transaction.create(ref, {
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      scheduledFor: input.scheduledFor
        ? Timestamp.fromDate(new Date(input.scheduledFor))
        : Timestamp.now(),
      status: pending.length ? "queued" : "completed",
      createdByUid: actor,
      createdAt: FieldValue.serverTimestamp(),
      selectedPersonIds: people.map((person) => person.id),
      sessionOnly: options.sessionOnly ?? false,
      attachments,
      activeCount: 0,
      source: options.source ?? "compose",
      dateLabel: options.dateLabel ?? "",
      serviceTime,
      servingAssignment: options.servingAssignment ?? null,
      pastoralVisit: options.pastoralVisit ?? null,
      recipientRole: options.recipientRole ?? null,
      expiresAt: options.expiresAt
        ? Timestamp.fromDate(options.expiresAt)
        : null,
      totals: {
        pending: pending.length,
        skipped: recipients.length - pending.length,
      },
    });
    for (const row of recipients)
      transaction.create(ref.collection("recipients").doc(row.id), {
        ...row,
        providerId: "",
        attemptKey: "",
        updatedAt: FieldValue.serverTimestamp(),
      });
  });
  return {
    id: ref.id,
    pending: pending.length,
    excluded: recipients.length - pending.length,
  };
}
export async function personHasRole(
  personId: string,
  allowed: readonly string[],
) {
  const users = await db
    .collection("users")
    .where("personId", "==", personId)
    .get();
  for (const user of users.docs) {
    try {
      const account = await getAuth().getUser(user.id);
      const roles: unknown = account.customClaims?.roles;
      if (
        !account.disabled &&
        Array.isArray(roles) &&
        roles.some((role) => allowed.includes(String(role)))
      )
        return true;
    } catch {
      /* A removed login cannot receive private information. */
    }
  }
  return false;
}
export const isSessionPerson = (personId: string, pastorOnly = false) =>
  personHasRole(personId, pastorOnly ? ["pastor"] : ["pastor", "clerk", "elder"]);
// A visit reminder is sent only for the current plan, to someone still assigned with a live role.
export async function visitReminderAllowed(
  visit: NonNullable<StoredMessage["pastoralVisit"]>,
  personId: string,
) {
  const [row, users] = await Promise.all([
    db.doc(`pastoralVisits/${visit.id}`).get(),
    db.collection("users").where("personId", "==", personId).get(),
  ]);
  if (
    !row.exists ||
    row.get("status") !== "planned" ||
    row.get("revision") !== visit.revision
  )
    return false;
  const field = visit.audience === "officers" ? "officerUids" : "deaconUids";
  const roles =
    visit.audience === "officers" ? ["pastor", "clerk", "elder"] : ["deacon"];
  for (const user of users.docs) {
    if (!(row.get(field) as string[]).includes(user.id)) continue;
    const account = await getAuth()
      .getUser(user.id)
      .catch(() => null);
    const granted: unknown = account?.customClaims?.roles;
    if (
      account &&
      !account.disabled &&
      Array.isArray(granted) &&
      granted.some((role) => roles.includes(String(role)))
    )
      return true;
  }
  return false;
}
export async function deliveryAllowed(
  personId: string,
  channel: Channel,
  address: string,
) {
  const [person, suppression] = await Promise.all([
    db.doc(`people/${personId}`).get(),
    db.doc(`communicationSuppressions/${identityHash(channel, address)}`).get(),
  ]);
  if (!person.exists || suppression.get("blocked") === true) return false;
  const row = person.data() as Person;
  try {
    return (
      !row.isDeceased &&
      row.membershipStatus !== "former" &&
      row[channel === "email" ? "emailOptIn" : "smsOptIn"] === true &&
      (channel === "email"
        ? normalizeEmail(row.email)
        : normalizePhone(row.mobilePhone)) === address
    );
  } catch {
    return false;
  }
}
export async function recount(ref: DocumentReference) {
  await db.runTransaction(async (transaction) => {
    const [message, recipients] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("recipients")),
    ]);
    if (!message.exists) return;
    const counts: Record<string, number> = {};
    for (const row of recipients.docs) {
      const key = row.get("status") as string;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    transaction.update(ref, {
      totals: counts,
      activeCount: counts.sending ?? 0,
      status:
        message.get("status") === "cancelled"
          ? "cancelled"
          : counts.pending || counts.sending
            ? "queued"
            : "completed",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
export async function dispatchQueue(now = new Date()) {
  const messages = await db
    .collection("messages")
    .where("status", "==", "queued")
    .where("scheduledFor", "<=", Timestamp.fromDate(now))
    .limit(30)
    .get();
  if (messages.empty) return;
  const adapters = providers();
  const settings = await getSettings();
  const started = Date.now();
  for (const document of messages.docs) {
    const message = document.data() as StoredMessage;
    const recipients = await document.ref.collection("recipients").get();
    for (const candidate of recipients.docs) {
      if (Date.now() - started > 50000) break;
      if (
        candidate.get("status") === "sending" &&
        candidate.get("startedAt")?.toMillis() < now.getTime() - 10 * 60000
      ) {
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(candidate.ref);
          if (
            current.get("status") === "sending" &&
            current.get("startedAt")?.toMillis() < now.getTime() - 10 * 60000
          )
            transaction.update(candidate.ref, {
              status: "unknown",
              error:
                "Delivery was interrupted. Check the provider log before retrying.",
              updatedAt: Timestamp.fromDate(now),
            });
        });
        continue;
      }
      if (candidate.get("status") !== "pending") continue;
      const row = candidate.data() as {
        personId: string;
        channel: Channel;
        address: string;
      };
      const allowed = await deliveryAllowed(
        row.personId,
        row.channel,
        row.address,
      );
      const expired =
        !!message.expiresAt && now.getTime() > message.expiresAt.toMillis();
      const enabled =
        row.channel === "email"
          ? settings.emailEnabled && !!adapters.email
          : settings.smsEnabled && !!adapters.sms;
      const budget = db.doc(
        `communicationBudgets/${now
          .toISOString()
          .slice(0, 16)
          .replace(/[^0-9]/g, "")}_${row.channel}`,
      );
      const daily = db.doc(
        `communicationBudgets/${now.toISOString().slice(0, 10)}_${row.channel}`,
      );
      const key = `${document.id}_${candidate.id}_${randomUUID()}`;
      const claim = await db.runTransaction(async (transaction) => {
        const [current, parent, minute, day] = await Promise.all([
          transaction.get(candidate.ref),
          transaction.get(document.ref),
          transaction.get(budget),
          transaction.get(daily),
        ]);
        if (
          current.get("status") !== "pending" ||
          parent.get("status") !== "queued"
        )
          return false;
        if (expired || !allowed || !enabled) {
          transaction.update(candidate.ref, {
            status: expired ? "expired" : "skipped",
            error: expired
              ? "The automatic bulletin cutoff passed. An authorized person can resume the remaining delivery manually."
              : !allowed
                ? "Consent or contact details changed"
                : "Delivery channel is disabled",
            updatedAt: Timestamp.fromDate(now),
          });
          return false;
        }
        if (
          Number(minute.get("count") ?? 0) >=
            (row.channel === "email" ? 20 : 60) ||
          Number(day.get("count") ?? 0) >=
            (row.channel === "email" ? 9000 : 10000)
        )
          return false;
        transaction.set(budget, {
          count: Number(minute.get("count") ?? 0) + 1,
          at: Timestamp.fromDate(now),
        });
        transaction.set(daily, {
          count: Number(day.get("count") ?? 0) + 1,
          at: Timestamp.fromDate(now),
        });
        transaction.update(candidate.ref, {
          status: "sending",
          attemptKey: key,
          startedAt: Timestamp.fromDate(now),
        });
        transaction.update(document.ref, {
          activeCount: Number(parent.get("activeCount") ?? 0) + 1,
        });
        return true;
      });
      if (!claim) continue;
      const person = (
        await db.doc(`people/${row.personId}`).get()
      ).data() as Person;
      const fields = {
        FirstName: person?.preferredName || person?.firstName || "",
        LastName: person?.lastName || "",
        ChurchName: settings.churchName,
        Date:
          message.dateLabel ||
          message.scheduledFor
            .toDate()
            .toLocaleDateString("en-US", { timeZone: await getChurchZone() }),
        ServiceTime: message.serviceTime,
      };
      let outcome: { status: string; providerId: string; error: string };
      try {
        const authorize = async () => {
          if (message.servingAssignment) {
            const assignment = await db
              .doc(`serving/${message.servingAssignment.id}`)
              .get();
            if (
              !assignment.exists ||
              assignment.get("cancelled") ||
              assignment.get("revision") !==
                message.servingAssignment.revision ||
              assignment.get("personId") !== row.personId
            )
              return false;
          }
          if (
            message.pastoralVisit &&
            !(await visitReminderAllowed(message.pastoralVisit, row.personId))
          )
            return false;
          if (
            message.expiresAt &&
            now.getTime() + Date.now() - started > message.expiresAt.toMillis()
          )
            throw new DeliveryError(
              "expired",
              "The automatic bulletin cutoff passed.",
            );
          const current = await getSettings();
          return (
            (row.channel === "email"
              ? current.emailEnabled
              : current.smsEnabled) &&
            (await deliveryAllowed(row.personId, row.channel, row.address)) &&
            (message.recipientRole === "deacon"
              ? await personHasRole(row.personId, ["deacon"])
              : !message.sessionOnly || (await isSessionPerson(row.personId)))
          );
        };
        if (!(await authorize()))
          throw new DeliveryError(
            "skipped",
            "Consent or contact details changed",
          );
        let result;
        if (row.channel === "email") {
          const attachments: Attachment[] = [];
          for (const file of message.attachments) {
            const [bytes] = await getStorage()
              .bucket()
              .file(file.path, { generation: file.generation })
              .download();
            attachments.push({ name: file.name, bytes });
          }
          const unsubscribe = `${providerConfig().publicFunctionsUrl}/emailUnsubscribe?token=${encodeURIComponent(unsubscribeToken(row.personId, row.address))}`;
          result = await adapters.email!.send({
            key,
            to: row.address,
            subject: mergeFields(message.subject, fields),
            body: `${mergeFields(message.body, fields)}\n\n${settings.footer}\nUnsubscribe from church email\n${unsubscribe}`,
            attachments,
            authorize,
          });
        } else
          result = await adapters.sms!.send({
            key,
            to: row.address,
            body: `${mergeFields(message.body, fields)}\n${settings.churchName}. Reply STOP to opt out.`,
            statusCallback: `${providerConfig().publicFunctionsUrl}/twilioStatus?messageId=${document.id}&recipientId=${candidate.id}&attempt=${encodeURIComponent(key)}`,
            authorize,
          });
        outcome = { status: result.status, providerId: result.id, error: "" };
      } catch (error) {
        outcome = {
          status: error instanceof DeliveryError ? error.outcome : "unknown",
          providerId: "",
          error:
            error instanceof DeliveryError
              ? error.message
              : "Delivery could not be confirmed. Check the provider log before retrying.",
        };
      }
      await db.runTransaction(async (transaction) => {
        const [current, parent] = await Promise.all([
          transaction.get(candidate.ref),
          transaction.get(document.ref),
        ]);
        if (current.get("attemptKey") !== key) return;
        if (current.get("status") === "sending")
          transaction.update(candidate.ref, {
            ...outcome,
            updatedAt: Timestamp.fromDate(now),
          });
        transaction.update(document.ref, {
          activeCount: Math.max(0, Number(parent.get("activeCount") ?? 0) - 1),
        });
      });
    }
    await recount(document.ref);
  }
}
