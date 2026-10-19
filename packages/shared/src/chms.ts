import { z } from "zod";
import { DateTime } from "luxon";
import {
  dateSchema,
  idSchema,
  type Person,
  type MembershipStatus,
  type Service,
  type Household,
} from "./domain.js";
import type { EventReminder } from "./calendar.js";

const short = z.string().trim().min(1).max(150);
const optionalId = z.union([idSchema, z.literal("")]);
const revision = {
  id: idSchema,
  expectedRevision: z.number().int().nonnegative().default(0),
};
export const groupSchema = z
  .object({
    ...revision,
    name: short,
    type: z.enum([
      "smallGroup",
      "class",
      "choir",
      "committee",
      "diaconate",
      "session",
    ]),
    leaderPersonId: optionalId,
    memberIds: z.array(idSchema).max(400),
    schedule: z.string().max(300),
    archived: z.boolean().default(false),
  })
  .strict();
export type Group = Omit<z.infer<typeof groupSchema>, "expectedRevision"> & {
  revision: number;
};
export const groupMarkSchema = z
  .object({
    groupId: idSchema,
    date: dateSchema,
    personId: idSchema,
    present: z.boolean(),
  })
  .strict();
export type GroupMeeting = {
  id: string;
  date: string;
  present: Record<string, unknown>;
};
export const eventSchema = z
  .object({
    ...revision,
    title: short,
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    location: z.string().max(300),
    recurrence: z.enum(["none", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(12).default(1),
    until: z.union([dateSchema, z.literal("")]),
    capacity: z.number().int().min(0).max(1000).default(0),
    cancelled: z.boolean().default(false),
  })
  .strict()
  .refine(
    (row) =>
      Date.parse(row.end) > Date.parse(row.start) &&
      Date.parse(row.end) - Date.parse(row.start) <= 7 * 86400000,
    "Use an end time after the start, within seven days",
  )
  .refine(
    (row) => row.recurrence === "none" || !!row.until,
    "Set the final recurrence date",
  );
// A change to one dated occurrence of a series. The occurrence keeps its
// original date as its identity, so RSVPs and calendar entries stay attached.
export type EventException = {
  cancelled?: boolean;
  start?: string;
  end?: string;
  location?: string;
};
export type ChurchEvent = Omit<
  z.infer<typeof eventSchema>,
  "expectedRevision"
> & {
  revision: number;
  exceptions?: Record<string, EventException>;
  reminders?: EventReminder[];
};
export type Occurrence = {
  id: string;
  eventId: string;
  date: string;
  title: string;
  start: string;
  end: string;
  location: string;
  capacity: number;
  cancelled: boolean;
  changed: boolean;
  revision: number;
};
type Moment = { toDate(): Date };
const iso = (value: unknown) =>
  value && typeof (value as Moment).toDate === "function"
    ? (value as Moment).toDate().toISOString()
    : String(value ?? "");
// Firestore stores event moments as Timestamps; occurrence math uses ISO strings.
export function eventFromRecord(
  id: string,
  data: Record<string, unknown>,
): ChurchEvent {
  const exceptions = (data.exceptions || {}) as Record<
    string,
    Record<string, unknown>
  >;
  return {
    ...(data as Omit<ChurchEvent, "id">),
    id,
    start: iso(data.start),
    end: iso(data.end),
    exceptions: Object.fromEntries(
      Object.entries(exceptions).map(([date, change]) => [
        date,
        {
          ...change,
          ...(change.start ? { start: iso(change.start) } : {}),
          ...(change.end ? { end: iso(change.end) } : {}),
        } as EventException,
      ]),
    ),
  };
}
export function eventOccurrences(
  event: ChurchEvent,
  from: string,
  to: string,
  zone: string,
  options: { includeCancelled?: boolean } = {},
): Occurrence[] {
  if (event.cancelled && !options.includeCancelled) return [];
  const start = DateTime.fromISO(event.start).setZone(zone);
  const duration = Date.parse(event.end) - Date.parse(event.start);
  const result: Occurrence[] = [];
  if (!start.isValid) throw new Error("Set a valid church time zone");
  for (let n = 0; n < 1500; n++) {
    const date: DateTime =
      event.recurrence === "weekly"
        ? start.plus({ weeks: n * event.interval })
        : event.recurrence === "monthly"
          ? start.plus({ months: n * event.interval })
          : start;
    const day = date.toISODate()!;
    if (day > to || (event.recurrence !== "none" && day > event.until)) break;
    const change = event.exceptions?.[day];
    const cancelled = event.cancelled || change?.cancelled === true;
    // A meeting on the 31st does not silently move to the end of a shorter month.
    if (
      (event.recurrence !== "monthly" || date.day === start.day) &&
      day >= from &&
      (!cancelled || options.includeCancelled)
    )
      result.push({
        id: `${event.id}_${day}`,
        eventId: event.id,
        date: day,
        title: event.title,
        start: change?.start || date.toUTC().toISO()!,
        end:
          change?.end || date.plus({ milliseconds: duration }).toUTC().toISO()!,
        location: change?.location ?? event.location,
        capacity: event.capacity,
        cancelled,
        changed: !!change,
        revision: event.revision,
      });
    if (event.recurrence === "none") break;
  }
  return result;
}
export const rsvpSchema = z
  .object({
    eventId: idSchema,
    date: dateSchema,
    personId: idSchema,
    status: z.enum(["yes", "maybe", "no"]),
  })
  .strict();
export type Rsvp = z.infer<typeof rsvpSchema> & { id: string };
export const servingSchema = z
  .object({
    ...revision,
    role: short,
    date: dateSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    personId: optionalId,
    location: z.string().max(300),
    reminderHours: z.number().int().min(1).max(168).default(24),
    cancelled: z.boolean().default(false),
  })
  .strict();
export type Serving = Omit<
  z.infer<typeof servingSchema>,
  "expectedRevision"
> & { revision: number };
export function reminderWindow(
  row: Pick<
    Serving,
    "date" | "time" | "reminderHours" | "personId" | "cancelled"
  >,
  now: Date,
  zone: string,
) {
  const start = DateTime.fromISO(`${row.date}T${row.time}`, { zone });
  return (
    !row.cancelled &&
    !!row.personId &&
    start.isValid &&
    start.toMillis() > now.getTime() &&
    start.minus({ hours: row.reminderHours }).toMillis() <= now.getTime()
  );
}
export const careNoteSchema = z
  .object({
    ...revision,
    personId: idSchema,
    // Visits, calls and conversations are contact; a note is not.
    kind: z.enum(["note", "visit", "call", "conversation"]),
    date: dateSchema,
    body: z.string().trim().min(1).max(10000),
  })
  .strict();
export type CareNote = Omit<
  z.infer<typeof careNoteSchema>,
  "expectedRevision"
> & { revision: number; authorUid: string };
export const followUpSchema = z
  .object({
    ...revision,
    personId: idSchema,
    title: short,
    assignedToUid: idSchema,
    dueDate: dateSchema,
    done: z.boolean().default(false),
  })
  .strict();
export type FollowUp = Omit<
  z.infer<typeof followUpSchema>,
  "expectedRevision"
> & { revision: number };
export const diaconalTaskSchema = followUpSchema;
export type DiaconalTask = FollowUp;
export const disciplineSchema = z
  .object({
    personId: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    disciplineFlag: z.boolean(),
    date: dateSchema,
    entry: z.string().trim().min(1).max(4000),
  })
  .strict();
export const taskCompleteSchema = z.object({ id: idSchema }).strict();
export const reportLabelsSchema = z
  .record(z.string().min(1).max(150), z.string().trim().min(1).max(150))
  .refine((value) => Object.keys(value).length <= 40, "Use at most 40 labels");
export const kioskSetupSchema = z
  .object({ pin: z.string().regex(/^\d{6,12}$/), enabled: z.boolean() })
  .strict();
export const kioskStartSchema = z.object({ serviceId: idSchema }).strict();
export const kioskSearchSchema = z
  .object({ search: z.string().trim().min(3).max(100) })
  .strict();
export const kioskCheckSchema = z
  .object({
    searchToken: z.string().regex(/^[a-f0-9]{48}$/),
    personIds: z.array(idSchema).min(1).max(20),
  })
  .strict();
export const kioskExitSchema = z
  .object({ pin: z.string().regex(/^\d{6,12}$/) })
  .strict();

export type HistoryEvent = z.infer<
  typeof import("./domain.js").membershipEventSchema
> & { id: string; personId: string };
export type Sacrament = {
  id: string;
  personId: string;
  type: "baptism" | "profession";
  date: string;
  category?: "infant" | "adult";
  place?: string;
  officiant?: string;
};
export const sacramentSchema = z
  .object({
    ...revision,
    personId: idSchema,
    type: z.enum(["baptism", "profession"]),
    date: dateSchema,
    category: z.enum(["infant", "adult"]).optional(),
    place: z.string().max(200),
    officiant: z.string().max(150),
  })
  .strict()
  .refine(
    (row) => row.type !== "baptism" || !!row.category,
    "Record infant or adult baptism",
  );
export function membershipAt(
  person: Person,
  events: HistoryEvent[],
  date: string,
): MembershipStatus | null {
  const history = events
    .filter((event) => event.personId === person.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!history.length) return null;
  const initial = history.find(
    (event) => event.date === history[0].date && event.fromStatus === null,
  );
  let status = initial ? initial.fromStatus : history[0].fromStatus;
  for (const day of [...new Set(history.map((row) => row.date))]) {
    if (day > date) break;
    const remaining = history.filter((row) => row.date === day);
    while (remaining.length) {
      const index = remaining.findIndex((row) => row.fromStatus === status);
      if (index < 0) return null;
      status = remaining.splice(index, 1)[0].toStatus;
    }
  }
  return status;
}
export type ReportRow = Record<string, string | number>;
export function annualStatistics(
  people: Person[],
  events: HistoryEvent[],
  sacraments: Sacrament[],
  services: Service[],
  year: number,
  serviceTypeIds: string[],
) {
  const begin = `${year - 1}-12-31`,
    end = `${year}-12-31`,
    first = `${year}-01-01`;
  const count = (date: string, status: MembershipStatus) =>
    people.filter((person) => membershipAt(person, events, date) === status)
      .length;
  const inYear = events.filter(
    (event) => event.date >= first && event.date <= end,
  );
  const rows: ReportRow[] = [];
  for (const status of ["communicant", "baptized"] as const) {
    rows.push(
      { Measure: `${status} at start`, Count: count(begin, status) },
      { Measure: `${status} at end`, Count: count(end, status) },
    );
  }
  const member = (status: MembershipStatus | null) =>
    status === "communicant" ||
    status === "baptized" ||
    status === "nonResident";
  for (const method of [
    "profession",
    "transfer",
    "baptism",
    "reaffirmation",
    "other",
  ] as const)
    rows.push({
      Measure: `Received by ${method}`,
      Count: inYear.filter(
        (event) =>
          event.method === method &&
          member(event.toStatus) &&
          (!member(event.fromStatus) ||
            (event.method === "profession" &&
              event.fromStatus === "baptized" &&
              event.toStatus === "communicant")),
      ).length,
    });
  for (const method of [
    "transfer",
    "death",
    "discipline",
    "erasure",
    "other",
  ] as const)
    rows.push({
      Measure: `Removed by ${method}`,
      Count: inYear.filter(
        (event) =>
          event.method === method &&
          member(event.fromStatus) &&
          !member(event.toStatus),
      ).length,
    });
  for (const category of ["infant", "adult"] as const)
    rows.push({
      Measure: `${category} baptisms`,
      Count: sacraments.filter(
        (row) =>
          row.type === "baptism" &&
          row.category === category &&
          row.date >= first &&
          row.date <= end,
      ).length,
    });
  const selected = services.filter(
    (service) =>
      service.date >= first &&
      service.date <= end &&
      serviceTypeIds.includes(service.serviceTypeId) &&
      DateTime.fromISO(service.date).weekday === 7,
  );
  rows.push({
    Measure: "Average recorded Lord's Day attendance",
    Count: selected.length
      ? Math.round(
          (selected.reduce(
            (sum, row) => sum + Object.keys(row.present).length,
            0,
          ) /
            selected.length) *
            10,
        ) / 10
      : 0,
  });
  rows.push({
    Measure: "People missing membership history",
    Count: people.filter(
      (person) => !events.some((event) => event.personId === person.id),
    ).length,
  });
  rows.push({
    Measure: "Inconsistent membership histories",
    Count: people.filter(
      (person) =>
        events.some((event) => event.personId === person.id) &&
        membershipAt(person, events, "9999-12-31") !== person.membershipStatus,
    ).length,
  });
  rows.push({
    Measure: "Baptisms missing infant/adult classification",
    Count: sacraments.filter(
      (row) =>
        row.type === "baptism" &&
        !row.category &&
        row.date >= first &&
        row.date <= end,
    ).length,
  });
  return rows;
}
export function meetingSummary(
  people: Person[],
  history: HistoryEvent[],
  services: Service[],
  year: number,
  typeIds: string[],
) {
  return Array.from({ length: 12 }, (_, index) =>
    typeIds.map((serviceTypeId) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      const rows = services.filter(
        (row) =>
          row.date.startsWith(month) && row.serviceTypeId === serviceTypeId,
      );
      const visitors = new Set(
        rows.flatMap((row) =>
          Object.keys(row.present).filter((id) => {
            const person = people.find((row) => row.id === id);
            return (
              person && membershipAt(person, history, row.date) === "visitor"
            );
          }),
        ),
      );
      return {
        Month: month,
        Service: serviceTypeId,
        Services: rows.length,
        Average: rows.length
          ? Math.round(
              (rows.reduce(
                (sum, row) => sum + Object.keys(row.present).length,
                0,
              ) /
                rows.length) *
                10,
            ) / 10
          : 0,
        Visitors: visitors.size,
      };
    }),
  ).flat();
}
export function directoryRows(people: Person[], households: Household[]) {
  return households
    .map((household) => ({
      household,
      people: people
        .filter(
          (person) =>
            person.householdId === household.id &&
            !person.isDeceased &&
            ["communicant", "baptized", "nonResident", "adherent"].includes(
              person.membershipStatus,
            ),
        )
        .sort((a, b) => a.firstName.localeCompare(b.firstName)),
    }))
    .filter((row) => row.people.length)
    .sort((a, b) => a.household.name.localeCompare(b.household.name));
}
