import { z } from "zod";
import { DateTime } from "luxon";
import { idSchema, statusSchema, type Person, type Service } from "./domain.js";

export const channelSchema = z.enum(["email", "sms", "both"]);
export type Channel = "email" | "sms";
export const audienceSchema = z
  .object({
    kind: z.enum([
      "all",
      "people",
      "household",
      "status",
      "district",
      "group",
      "saved",
    ]),
    ids: z.array(idSchema).max(2000).default([]),
  })
  .strict()
  .refine(
    (value) => value.kind === "all" || value.ids.length > 0,
    "Choose a recipient list",
  )
  .refine(
    (value) => value.kind !== "saved" || value.ids.length === 1,
    "Choose one saved list",
  );
export type Audience = z.infer<typeof audienceSchema>;
export const MERGE_FIELDS = [
  "FirstName",
  "LastName",
  "ChurchName",
  "Date",
  "ServiceTime",
] as const;
export function mergeFields(
  text: string,
  fields: Record<string, string>,
): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => {
    if (!MERGE_FIELDS.includes(key as (typeof MERGE_FIELDS)[number]))
      throw new Error(`Unknown merge field ${key}`);
    return fields[key] ?? "";
  });
}
const mergeText = z
  .string()
  .trim()
  .min(1)
  .max(12000)
  .refine((value) => {
    try {
      mergeFields(value, {});
      return true;
    } catch {
      return false;
    }
  }, "Use a supported merge field");
export const messageInputSchema = z
  .object({
    requestId: idSchema,
    channel: channelSchema,
    subject: z
      .string()
      .trim()
      .max(200)
      .refine((value) => {
        try {
          mergeFields(value, {});
          return true;
        } catch {
          return false;
        }
      }, "Use a supported merge field"),
    body: mergeText,
    audience: audienceSchema,
    scheduledFor: z.iso.datetime({ offset: true }).nullable().default(null),
    attachmentPaths: z
      .array(
        z
          .string()
          .regex(/^messageAttachments\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.pdf$/),
      )
      .max(3)
      .default([]),
    confirmLarge: z.boolean().default(false),
    confirmedRecipientCount: z
      .number()
      .int()
      .min(0)
      .max(400)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (value) => value.channel === "sms" || value.subject.length > 0,
    "Enter an email subject",
  );
export type MessageInput = z.infer<typeof messageInputSchema>;
export const templateInputSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    channel: channelSchema,
    subject: z.string().max(200),
    body: mergeText,
  })
  .strict();
export const savedAudienceSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    audience: audienceSchema,
  })
  .strict()
  .refine(
    (value) => value.audience.kind !== "saved",
    "Saved lists cannot refer to another saved list",
  );
const contactFieldsSchema = z
  .object({
    email: z.union([z.email(), z.literal("")]),
    mobilePhone: z.string().max(40),
    emailOptIn: z.boolean(),
    smsOptIn: z.boolean(),
  })
  .strict();
export const contactConsentSchema = contactFieldsSchema
  .extend({
    personId: idSchema,
    evidence: z.string().trim().min(5).max(1000),
    expected: contactFieldsSchema,
  })
  .strict();
export const communicationSettingsSchema = z
  .object({
    churchName: z.string().trim().min(1).max(150).default("Sycamore RPC"),
    footer: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .default("Sycamore Reformed Presbyterian Church"),
    emailEnabled: z.boolean().default(false),
    smsEnabled: z.boolean().default(false),
    bulletinEnabled: z.boolean().default(false),
    sendTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("18:00"),
    reminderTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("16:00"),
    cutoffTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("23:00"),
    previewPersonId: z.union([idSchema, z.literal("")]).default(""),
    reminderPersonId: z.union([idSchema, z.literal("")]).default(""),
    driveId: z.string().max(200).default(""),
    folderId: z.string().max(200).default(""),
    bulletinSubject: mergeText.default(
      "Sycamore RPC Bulletin, Lord's Day {Date}",
    ),
    bulletinBody: mergeText.default(
      "Dear {FirstName},\n\nThe bulletin for the coming Lord's Day is attached.",
    ),
    bulletinSms: z.boolean().default(false),
    shareBulletinLink: z.boolean().default(false),
    // The weekly shepherding digest, including absence, to each district elder.
    absenceEnabled: z.boolean().default(false),
    absenceServiceTypeId: z.union([idSchema, z.literal("")]).default(""),
    absenceWeeks: z.number().int().min(2).max(12).default(3),
    digestChannel: z.enum(["email", "sms", "both"]).default("email"),
    digestWeekday: z.number().int().min(1).max(7).default(1),
    digestHour: z.number().int().min(0).max(23).default(9),
    dailySummaryEnabled: z.boolean().default(false),
    dailySummaryHour: z.number().int().min(0).max(23).default(7),
    // The daily mercy ministry summary to each live deacon. No notes, details or task titles.
    deaconDigestEnabled: z.boolean().default(false),
    deaconDigestHour: z.number().int().min(0).max(23).default(7),
    deaconDigestChannel: z.enum(["email", "sms", "both"]).default("email"),
  })
  .strict()
  .refine(
    (value) =>
      value.reminderTime <= value.sendTime && value.sendTime < value.cutoffTime,
    "Use reminder, send and cutoff times in order",
  )
  .refine(
    (value) => !value.bulletinSms || value.shareBulletinLink,
    "Enable shareable bulletin links before text delivery",
  );
export type CommunicationSettings = z.infer<typeof communicationSettingsSchema>;
export const bulletinFileSchema = z
  .object({
    week: z.iso.date(),
    path: z.string().regex(/^bulletins\/[0-9-]{10}\/[A-Za-z0-9_-]+\.pdf$/),
    name: z.string().trim().min(1).max(150),
  })
  .strict();
export const bulletinActionSchema = z
  .object({
    week: z.iso.date(),
    action: z.enum(["send", "skip", "preview"]),
    confirmedRecipientCount: z
      .number()
      .int()
      .min(0)
      .max(400)
      .nullable()
      .default(null),
  })
  .strict();
export const actionIdSchema = z.object({ id: idSchema }).strict();
export const inboundSmsSchema = z
  .object({
    MessageSid: z.string().regex(/^SM[a-fA-F0-9]{32}$/),
    From: z.string(),
    To: z.string(),
    Body: z.string().max(16000),
    OptOutType: z.string().optional(),
  })
  .passthrough();

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
export function normalizePhone(value: string): string {
  if (!value.trim()) return "";
  const clean = value.trim().replace(/[().\s-]/g, "");
  if (/^\d{10}$/.test(clean)) return `+1${clean}`;
  if (/^1\d{10}$/.test(clean)) return `+${clean}`;
  if (/^\+[1-9]\d{7,14}$/.test(clean)) return clean;
  throw new Error(
    "Enter a US number or a number beginning with its country code",
  );
}
export function smsConsentKeyword(
  body: string,
  optOutType?: string,
): "stop" | "start" | "help" | null {
  const word = (optOutType || body).trim().toUpperCase();
  if (
    [
      "STOP",
      "STOPALL",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
      "REVOKE",
      "OPTOUT",
    ].includes(word)
  )
    return "stop";
  if (["START", "UNSTOP", "YES"].includes(word)) return "start";
  return ["HELP", "INFO"].includes(word) ? "help" : null;
}
const gsm =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
export function smsSegments(text: string) {
  const chars = [...text];
  const unicode = chars.some(
    (char) => !gsm.includes(char) && !"^{}\\[~]|€".includes(char),
  );
  const units = unicode
    ? text.length
    : chars.reduce(
        (count, char) => count + ("^{}\\[~]|€".includes(char) ? 2 : 1),
        0,
      );
  const single = unicode ? 70 : 160;
  const concat = unicode ? 67 : 153;
  return {
    units,
    encoding: unicode ? "Unicode" : "GSM-7",
    segments: units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / concat),
  };
}
export function localSchedule(value: string, zone: string): string {
  const time = DateTime.fromISO(value, { zone });
  if (
    !time.isValid ||
    time.toFormat("yyyy-MM-dd'T'HH:mm") !== value ||
    time.getPossibleOffsets().length !== 1
  )
    throw new Error("Choose a valid, unambiguous church time");
  return time.toUTC().toISO()!;
}
export function bulletinClock(
  now: Date,
  zone: string,
  settings: Pick<
    CommunicationSettings,
    "sendTime" | "reminderTime" | "cutoffTime"
  >,
) {
  const local = DateTime.fromJSDate(now, { zone });
  if (!local.isValid) throw new Error("Set a valid church time zone");
  const week = local.plus({ days: (7 - local.weekday) % 7 }).toISODate()!;
  const time = local.toFormat("HH:mm");
  const beforeCutoff =
    local.toFormat("HH:mm:ss") <= `${settings.cutoffTime}:00`;
  return {
    week,
    saturday: local.weekday === 6,
    remind:
      local.weekday === 6 && time >= settings.reminderTime && beforeCutoff,
    send: local.weekday === 6 && time >= settings.sendTime && beforeCutoff,
    mondayStart: local.startOf("week").toUTC().toMillis(),
    date: local.toISODate()!,
    time,
    weekday: local.weekday,
  };
}
export function audiencePeople(
  people: Person[],
  audience: Audience,
  groups: { id: string; memberIds: string[] }[] = [],
): Person[] {
  const ids = new Set(audience.ids);
  if (audience.kind === "saved")
    throw new Error("Resolve the saved list first");
  return people.filter(
    (person) =>
      !person.isDeceased &&
      person.membershipStatus !== "former" &&
      (audience.kind === "all" ||
        (audience.kind === "people" && ids.has(person.id)) ||
        (audience.kind === "household" && ids.has(person.householdId)) ||
        (audience.kind === "status" && ids.has(person.membershipStatus)) ||
        (audience.kind === "district" && ids.has(person.elderDistrictId)) ||
        (audience.kind === "group" &&
          groups.some(
            (group) => ids.has(group.id) && group.memberIds.includes(person.id),
          ))),
  );
}
export type RecipientChoice = {
  id: string;
  personId: string;
  channel: Channel;
  address: string;
  status: "pending" | "skipped";
  error: string;
};
export function chooseRecipients(
  people: Person[],
  channel: "email" | "sms" | "both",
): RecipientChoice[] {
  const seen = new Set<string>();
  const rows: RecipientChoice[] = [];
  for (const person of people)
    for (const medium of (channel === "both"
      ? ["email", "sms"]
      : [channel]) as Channel[]) {
      let address = "";
      let reason = "";
      try {
        address =
          medium === "email"
            ? normalizeEmail(person.email)
            : normalizePhone(person.mobilePhone);
      } catch {
        reason = "Invalid phone number";
      }
      if (!person[medium === "email" ? "emailOptIn" : "smsOptIn"])
        reason = "Opted out";
      else if (!address) reason ||= "No contact address";
      const key = `${medium}:${address}`;
      if (!reason && seen.has(key)) reason = "Duplicate address";
      if (!reason) seen.add(key);
      rows.push({
        id: `${person.id}_${medium}`,
        personId: person.id,
        channel: medium,
        address,
        status: reason ? "skipped" : "pending",
        error: reason,
      });
    }
  return rows;
}
export function absencePeople(
  people: Person[],
  services: Service[],
  typeId: string,
  now: Date,
  zone: string,
  weeks = 3,
) {
  const local = DateTime.fromJSDate(now, { zone });
  const last = local.minus({ days: local.weekday === 7 ? 0 : local.weekday });
  const dates = Array.from({ length: weeks }, (_, index) =>
    last.minus({ weeks: index }).toISODate()!,
  );
  const meetings = dates.map((date) =>
    services.filter(
      (service) => service.serviceTypeId === typeId && service.date === date,
    ),
  );
  if (meetings.some((list) => list.length === 0)) return [];
  return people.filter(
    (person) =>
      !person.isDeceased &&
      ["communicant", "baptized", "adherent"].includes(
        person.membershipStatus,
      ) &&
      meetings.every((list) =>
        list.every((service) => !Object.hasOwn(service.present, person.id)),
      ),
  );
}
export function validStatus(value: string) {
  return statusSchema.safeParse(value).success;
}
// Digest identities use the church-local date, so repeated scheduler ticks queue each notice once.
export function digestClock(
  now: Date,
  zone: string,
  settings: Pick<
    CommunicationSettings,
    | "absenceEnabled"
    | "digestWeekday"
    | "digestHour"
    | "dailySummaryEnabled"
    | "dailySummaryHour"
  > &
    Partial<
      Pick<CommunicationSettings, "deaconDigestEnabled" | "deaconDigestHour">
    >,
) {
  const local = DateTime.fromJSDate(now, { zone });
  if (!local.isValid) throw new Error("Set a valid church time zone");
  return {
    date: local.toISODate()!,
    weekly:
      settings.absenceEnabled &&
      local.weekday === settings.digestWeekday &&
      local.hour >= settings.digestHour,
    daily:
      settings.dailySummaryEnabled && local.hour >= settings.dailySummaryHour,
    deacon:
      !!settings.deaconDigestEnabled &&
      local.hour >= (settings.deaconDigestHour ?? 7),
  };
}
export type DigestSection = { title: string; names: string[] };
// Texts carry counts only. Emails list names. Neither carries note bodies, purposes or reasons.
export function digestText(
  sections: DigestSection[],
  channel: Channel,
  dateLabel: string,
  heading = "Shepherding summary",
) {
  // Braces would be read as merge fields when the queue sends the message.
  const filled = sections
    .filter((section) => section.names.length)
    .map((section) => ({
      ...section,
      names: section.names.map((name) => name.replace(/[{}]/g, "")),
    }));
  if (!filled.length) return "";
  if (channel === "sms")
    return `${heading} for {FirstName}, ${dateLabel}: ${filled
      .map((section) => `${section.title} ${section.names.length}`)
      .join(", ")}. Open the church app for details.`;
  const body = filled
    .map(
      (section) =>
        `${section.title} (${section.names.length})\n${section.names.join("\n")}`,
    )
    .join("\n\n");
  return `Dear {FirstName},\n\n${heading} for ${dateLabel}.\n\n${body}\n\nPlease review the records in the church app before following up.`;
}
