import { z } from "zod";
import {
  dateSchema,
  idSchema,
  statusSchema,
  type MembershipStatus,
  type Person,
} from "./domain.js";
import {
  ageOn,
  officeRoleLabels,
  officeRoles,
  officeState,
  type Office,
} from "./officers.js";

export const meetingTypes = [
  "session",
  "congregational",
  "diaconate",
  "other",
] as const;
export const meetingTypeLabels: Record<(typeof meetingTypes)[number], string> =
  {
    session: "Session meeting",
    congregational: "Congregational meeting",
    diaconate: "Diaconate meeting",
    other: "Other meeting",
  };
// A rule the Session adopts. A later rule for the same meeting type replaces it from its effective date.
export const quorumPolicySchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    meetingType: z.enum(meetingTypes),
    effectiveFrom: dateSchema,
    electorate: z.enum(["officers", "members"]),
    offices: z.array(z.enum(officeRoles)).max(3).default([]),
    includeEmeritus: z.boolean().default(false),
    statuses: z.array(statusSchema).max(6).default([]),
    minimumAge: z.number().int().min(0).max(100).default(0),
    excludeUnderDiscipline: z.boolean().default(false),
    minimumCount: z.number().int().min(0).max(1000).default(0),
    percent: z.number().int().min(0).max(100).default(0),
    source: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (row) =>
      row.electorate === "officers"
        ? row.offices.length > 0
        : row.statuses.length > 0,
    { message: "Choose who makes up the electorate", path: ["electorate"] },
  )
  .refine((row) => row.minimumCount > 0 || row.percent > 0, {
    message: "Set a required number or a percentage",
    path: ["minimumCount"],
  });
export type QuorumPolicy = Omit<
  z.infer<typeof quorumPolicySchema>,
  "expectedRevision"
> & { revision: number };
export const quorumMeetingSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    meetingType: z.enum(meetingTypes),
    date: dateSchema,
    title: z.string().trim().min(1).max(150),
    presentPersonIds: z.array(idSchema).max(400).default([]),
  })
  .strict();
export type QuorumMeeting = Omit<
  z.infer<typeof quorumMeetingSchema>,
  "expectedRevision"
> & { revision: number };

export function policyOn(
  policies: QuorumPolicy[],
  meetingType: QuorumPolicy["meetingType"],
  date: string,
) {
  return (
    policies
      .filter(
        (row) => row.meetingType === meetingType && row.effectiveFrom <= date,
      )
      .sort(
        (a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          b.id.localeCompare(a.id),
      )[0] ?? null
  );
}
export type ElectorateEntry = {
  personId: string;
  state: "included" | "excluded" | "unknown";
  reason: string;
};
export function requiredFor(policy: QuorumPolicy, electorate: number) {
  return Math.max(
    policy.minimumCount,
    Math.ceil((policy.percent * electorate) / 100),
  );
}
// Historical electorate and quorum for one meeting. Missing history is reported, never guessed.
export function quorumReport({
  policy,
  meeting,
  people,
  offices,
  statusOn,
  disciplinedOn,
}: {
  policy: QuorumPolicy | null;
  meeting: Pick<QuorumMeeting, "date" | "presentPersonIds">;
  people: Person[];
  offices: Office[];
  statusOn: (person: Person, date: string) => MembershipStatus | null;
  // True or false from dated discipline entries, or null when the record cannot say.
  disciplinedOn: (personId: string, date: string) => boolean | null;
}) {
  if (!policy) return null;
  const date = meeting.date;
  const entries: ElectorateEntry[] = [];
  const add = (
    personId: string,
    state: ElectorateEntry["state"],
    reason: string,
  ) => entries.push({ personId, state, reason });
  if (policy.electorate === "officers") {
    for (const person of people) {
      const rows = offices.filter(
        (row) =>
          row.personId === person.id && policy.offices.includes(row.role),
      );
      if (!rows.length) continue;
      const states = rows.map((row) => ({
        row,
        state: officeState(row, date),
      }));
      const serving = states.find(
        (s) =>
          s.state === "serving" ||
          (policy.includeEmeritus && s.state === "emeritus"),
      );
      if (serving)
        add(
          person.id,
          "included",
          `${officeRoleLabels[serving.row.role]}${serving.state === "emeritus" ? ", emeritus" : ""}`,
        );
      else if (states.some((s) => s.state === "unknown"))
        add(person.id, "unknown", "Installation date not recorded");
      else if (states.some((s) => s.state === "emeritus"))
        add(person.id, "excluded", "Emeritus, not counted by this rule");
      else if (states.every((s) => s.state === "notYet"))
        add(person.id, "excluded", "Not yet installed on this date");
      else add(person.id, "excluded", "Service had ended by this date");
    }
  } else {
    for (const person of people) {
      const status = statusOn(person, date);
      if (status === null) {
        if (person.membershipStatus !== "visitor")
          add(person.id, "unknown", "Membership history needs review");
        continue;
      }
      if (!policy.statuses.includes(status)) {
        if (status !== "visitor" && status !== "former")
          add(person.id, "excluded", "Status not in this electorate");
        continue;
      }
      // A death recorded in history already ends membership on its date.
      if (person.isDeceased && statusOn(person, "9999-12-31") !== "former") {
        add(
          person.id,
          "unknown",
          "Has died; the death is not in membership history",
        );
        continue;
      }
      if (policy.minimumAge) {
        const age = ageOn(person.birthDate, date);
        if (age === null) {
          add(person.id, "unknown", "Birth date not recorded");
          continue;
        }
        if (age < policy.minimumAge) {
          add(person.id, "excluded", `Under ${policy.minimumAge} on this date`);
          continue;
        }
      }
      if (policy.excludeUnderDiscipline) {
        const disciplined = disciplinedOn(person.id, date);
        if (disciplined === null) {
          add(person.id, "unknown", "Discipline record has no dated entries");
          continue;
        }
        if (disciplined) {
          add(person.id, "excluded", "Under discipline on this date");
          continue;
        }
      }
      add(person.id, "included", "Qualifying member");
    }
  }
  const included = entries.filter((row) => row.state === "included");
  const unknown = entries.filter((row) => row.state === "unknown");
  const present = new Set(meeting.presentPersonIds);
  const presentIncluded = included.filter((row) => present.has(row.personId));
  const presentUnknown = unknown.filter((row) => present.has(row.personId));
  const presentOutside = meeting.presentPersonIds.filter(
    (id) =>
      !entries.some((row) => row.personId === id && row.state !== "excluded"),
  );
  const required = requiredFor(policy, included.length);
  const requiredWithUnknown = requiredFor(
    policy,
    included.length + unknown.length,
  );
  const met =
    presentIncluded.length >= requiredWithUnknown
      ? true
      : presentIncluded.length + presentUnknown.length < required
        ? false
        : unknown.length
          ? null
          : presentIncluded.length >= required;
  const parts = [
    policy.minimumCount ? `at least ${policy.minimumCount}` : "",
    policy.percent
      ? `${policy.percent}% of ${included.length} rounded up is ${Math.ceil((policy.percent * included.length) / 100)}`
      : "",
  ].filter(Boolean);
  const rule = parts.join(" and ");
  return {
    policy,
    entries,
    electorate: included.length,
    unknown: unknown.length,
    required,
    present: presentIncluded.length,
    presentOutside,
    met,
    calculation: `${rule.charAt(0).toUpperCase()}${rule.slice(1)}. Required: ${required}. Present from the electorate: ${presentIncluded.length}.${
      unknown.length
        ? ` ${unknown.length} ${unknown.length === 1 ? "person has" : "people have"} incomplete records and ${unknown.length === 1 ? "is" : "are"} not counted.`
        : ""
    }`,
  };
}
// Discipline on a date from the dated history entries; the current flag alone says nothing about the past.
export function disciplineOn(
  record:
    | {
        disciplineFlag: boolean;
        disciplineHistory: { date: string; flag: boolean }[];
      }
    | undefined,
  date: string,
): boolean | null {
  if (!record) return false;
  const entries = [...(record.disciplineHistory || [])]
    .filter((row) => row.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (entries.length) return !!entries.at(-1)!.flag;
  const history = [...(record.disciplineHistory || [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (!history.length) return record.disciplineFlag ? null : false;
  // Every entry is later. If the first one began discipline, the person was not yet under it.
  return history[0].flag ? false : null;
}
