import { z } from "zod";
import { DateTime } from "luxon";
import {
  dateSchema,
  idSchema,
  statusSchema,
  type MembershipStatus,
  type Person,
} from "./domain.js";

export const contactSources = [
  "visit",
  "visitRecord",
  "call",
  "conversation",
  "textReply",
  "personalText",
  "personalEmail",
] as const;
export type ContactSource = (typeof contactSources)[number];
export const contactSourceLabels: Record<ContactSource, string> = {
  visit: "Completed visit",
  visitRecord: "Visit record",
  call: "Phone call",
  conversation: "Conversation",
  textReply: "Text reply received",
  personalText: "Personal text delivered",
  personalEmail: "Personal email accepted by Microsoft",
};
// Only these care-note kinds are contact. A pastoral note about someone is not contact with them.
export const contactNoteKinds: Partial<Record<string, ContactSource>> = {
  visit: "visitRecord",
  call: "call",
  conversation: "conversation",
};
export type ContactEvent = {
  personId: string;
  date: string;
  source: ContactSource;
  refId: string;
};
// A message is personal only when a Session officer composed it to a few named people.
export const PERSONAL_MESSAGE_LIMIT = 3;
export function personalMessageContact(
  message: {
    source: string;
    audienceKind: string;
    selectedPersonIds: string[];
    senderIsSession: boolean;
  },
  recipient: { channel: string; status: string },
): ContactSource | null {
  if (
    message.source !== "compose" ||
    message.audienceKind !== "people" ||
    message.selectedPersonIds.length > PERSONAL_MESSAGE_LIMIT ||
    !message.senderIsSession
  )
    return null;
  if (
    recipient.channel === "sms" &&
    ["delivered", "read"].includes(recipient.status)
  )
    return "personalText";
  if (recipient.channel === "email" && recipient.status === "accepted")
    return "personalEmail";
  return null;
}

const trackable = statusSchema.exclude(["former", "visitor"]);
export const contactPolicySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().default(0),
    historyStart: dateSchema,
    defaultContactDays: z.number().int().min(7).max(730).default(90),
    districtContactDays: z
      .record(idSchema, z.number().int().min(7).max(730))
      .refine((value) => Object.keys(value).length <= 50, "Too many districts")
      .default({}),
    trackedStatuses: z
      .array(trackable)
      .min(1)
      .max(4)
      .default(["communicant", "adherent"]),
    countPersonalMessages: z.boolean().default(true),
  })
  .strict();
export type ContactPolicy = Omit<
  z.infer<typeof contactPolicySchema>,
  "expectedRevision"
> & { revision: number };

export type ContactState = "gap" | "unknown" | "notDue" | "current";
export type ContactFlag = {
  personId: string;
  state: ContactState;
  thresholdDays: number;
  rule: "district" | "church";
  lastContact: ContactEvent | null;
  measuredFrom: string;
  dueDate: string;
  daysPastDue: number;
};
const stateOrder: Record<ContactState, number> = {
  gap: 0,
  unknown: 1,
  notDue: 2,
  current: 3,
};
// Missing records stay unknown until a full threshold of complete records has passed.
export function contactGaps(
  people: Pick<
    Person,
    "id" | "membershipStatus" | "isDeceased" | "elderDistrictId"
  >[],
  events: ContactEvent[],
  policy: Pick<
    ContactPolicy,
    | "historyStart"
    | "defaultContactDays"
    | "districtContactDays"
    | "trackedStatuses"
  >,
  today: string,
  rollEntry: Record<string, string> = {},
): ContactFlag[] {
  const day = (value: string) => DateTime.fromISO(value, { zone: "utc" });
  const latest = new Map<string, ContactEvent>();
  for (const event of events)
    if (
      event.date <= today &&
      (!latest.has(event.personId) ||
        event.date > latest.get(event.personId)!.date)
    )
      latest.set(event.personId, event);
  return people
    .filter(
      (person) =>
        !person.isDeceased &&
        policy.trackedStatuses.includes(
          person.membershipStatus as Exclude<
            MembershipStatus,
            "former" | "visitor"
          >,
        ),
    )
    .map((person): ContactFlag => {
      const district = policy.districtContactDays[person.elderDistrictId];
      const thresholdDays = district ?? policy.defaultContactDays;
      const lastContact = latest.get(person.id) ?? null;
      const entry = rollEntry[person.id] || "";
      const measuredFrom =
        lastContact?.date ??
        (entry > policy.historyStart ? entry : policy.historyStart);
      const due = day(measuredFrom).plus({ days: thresholdDays });
      const past = Math.floor(day(today).diff(due, "days").days);
      return {
        personId: person.id,
        thresholdDays,
        rule: district === undefined ? "church" : "district",
        lastContact,
        measuredFrom,
        dueDate: due.toISODate()!,
        daysPastDue: Math.max(0, past),
        state:
          past > 0
            ? "gap"
            : lastContact
              ? "current"
              : measuredFrom === entry
                ? "notDue"
                : "unknown",
      };
    })
    .sort(
      (a, b) =>
        stateOrder[a.state] - stateOrder[b.state] ||
        b.daysPastDue - a.daysPastDue ||
        a.dueDate.localeCompare(b.dueDate),
    );
}
