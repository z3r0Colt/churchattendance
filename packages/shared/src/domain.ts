import { z } from "zod";

export const roles = [
  "admin",
  "pastor",
  "clerk",
  "elder",
  "deacon",
  "attendanceVolunteer",
  "readOnly",
] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;
export const SESSION_ROLES: readonly Role[] = ["pastor", "clerk", "elder"];
export const EDITOR_ROLES: readonly Role[] = ["admin", ...SESSION_ROLES];
export const hasRole = (userRoles: readonly Role[], allowed: readonly Role[]) =>
  userRoles.some((role) => allowed.includes(role));
export const canMarkAttendance = (userRoles: readonly Role[]) =>
  hasRole(userRoles, [...EDITOR_ROLES, "deacon", "attendanceVolunteer"]);
export const membershipStatuses = [
  "communicant",
  "baptized",
  "nonResident",
  "adherent",
  "visitor",
  "former",
] as const;
export const statusSchema = z.enum(membershipStatuses);
export type MembershipStatus = z.infer<typeof statusSchema>;
export const statusLabels: Record<MembershipStatus, string> = {
  communicant: "Communicant Member",
  baptized: "Baptized Member",
  nonResident: "Non-resident Member",
  adherent: "Adherent",
  visitor: "Visitor",
  former: "Former",
};
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const dateSchema = z.iso.date();
const name = z.string().trim().min(1).max(100);
const personFieldsSchema = z
  .object({
    firstName: name,
    lastName: name,
    preferredName: z.string().trim().max(100).default(""),
    householdId: idSchema,
    membershipStatus: statusSchema,
    email: z.union([z.email(), z.literal("")]).default(""),
    mobilePhone: z.string().max(40).default(""),
    birthDate: z.union([dateSchema, z.literal("")]).default(""),
    photoPath: z
      .string()
      .regex(/^photos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
      .optional(),
    emailOptIn: z.boolean().default(false),
    smsOptIn: z.boolean().default(false),
    isDeceased: z.boolean().default(false),
    elderDistrictId: z.union([idSchema, z.literal("")]).default(""),
  })
  .strict();
export const personInputSchema = personFieldsSchema;
export type PersonInput = z.infer<typeof personInputSchema>;
export type Person = PersonInput & { id: string };
export const householdInputSchema = z
  .object({
    name,
    address: z.string().max(500).default(""),
    homePhone: z.string().max(40).default(""),
  })
  .strict();
export type Household = z.infer<typeof householdInputSchema> & { id: string };
export type RosterPerson = Pick<
  Person,
  | "id"
  | "firstName"
  | "lastName"
  | "preferredName"
  | "householdId"
  | "membershipStatus"
  | "isDeceased"
> & { householdName: string };
export function toRoster(
  id: string,
  person: PersonInput,
  householdName: string,
): RosterPerson {
  return {
    id,
    firstName: person.firstName,
    lastName: person.lastName,
    preferredName: person.preferredName,
    householdId: person.householdId,
    membershipStatus: person.membershipStatus,
    isDeceased: person.isDeceased,
    householdName,
  };
}
export const serviceTypeSchema = z
  .object({
    name,
    dayOfWeek: z.number().int().min(0).max(6),
    defaultTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isActive: z.boolean(),
  })
  .strict();
export type ServiceType = z.infer<typeof serviceTypeSchema> & { id: string };
export const serviceInputSchema = z
  .object({
    serviceTypeId: idSchema,
    date: dateSchema,
    notes: z.string().max(1000),
    present: z.record(idSchema, z.never()),
    lastAttendancePersonId: z.literal(""),
  })
  .strict();
export const attendanceInputSchema = z
  .object({
    personId: idSchema,
    present: z.boolean(),
    method: z.enum(["roll", "kiosk"]),
    mode: z.enum(["inPerson", "online"]).default("inPerson"),
  })
  .strict()
  .refine((row) => row.method === "roll" || row.mode === "inPerson", {
    message: "Kiosk check-in is in person",
    path: ["mode"],
  });
export type Attendance = {
  at: unknown;
  method: "roll" | "kiosk";
  byUid: string;
  // Absent on marks made before online tracking; those count as in person.
  mode?: "inPerson" | "online";
};
export type Service = {
  id: string;
  serviceTypeId: string;
  date: string;
  notes: string;
  present: Record<string, Attendance>;
  lastAttendancePersonId: string;
};
export const visitorInputSchema = z
  .object({
    firstName: name,
    lastName: name,
    email: z.union([z.email(), z.literal("")]).default(""),
    mobilePhone: z.string().max(40).default(""),
    householdId: z.union([idSchema, z.literal("")]).default(""),
    serviceId: idSchema,
    firstTime: z.boolean().default(true),
  })
  .strict();
export const membershipEventSchema = z
  .object({
    date: dateSchema,
    fromStatus: statusSchema.nullable(),
    toStatus: statusSchema,
    method: z.enum([
      "initial",
      "profession",
      "transfer",
      "baptism",
      "reaffirmation",
      "death",
      "discipline",
      "erasure",
      "other",
    ]),
    otherChurch: z.string().max(200).default(""),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
// Strip schema defaults from patches so omitted fields are never reset.
export const personPatchSchema = z
  .object(
    Object.fromEntries(
      Object.entries(personFieldsSchema.shape).map(([key, schema]) => [
        key,
        schema instanceof z.ZodDefault
          ? schema.removeDefault().optional()
          : schema.optional(),
      ]),
    ),
  )
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Supply at least one changed field",
  );
export const savePersonSchema = z
  .object({
    id: idSchema,
    changes: personPatchSchema,
    expected: personPatchSchema.optional(),
    membershipEvent: membershipEventSchema.optional(),
  })
  .strict();
export const createHouseholdSchema = z
  .object({
    household: householdInputSchema,
    people: z
      .array(personInputSchema.omit({ householdId: true }))
      .min(1)
      .max(20),
    date: dateSchema,
  })
  .strict();
export const rolesInputSchema = z
  .object({ uid: idSchema, roles: z.array(roleSchema).min(1).max(7) })
  .strict();

export function isOnRoll(
  person: Pick<RosterPerson, "membershipStatus" | "isDeceased">,
) {
  return !person.isDeceased && person.membershipStatus !== "former";
}
export function filterRoster(
  people: RosterPerson[],
  search: string,
  filter = "all",
) {
  const term = search.trim().toLocaleLowerCase();
  return people
    .filter(
      (person) =>
        isOnRoll(person) &&
        `${person.firstName} ${person.lastName} ${person.preferredName} ${person.householdName}`
          .toLocaleLowerCase()
          .includes(term) &&
        (filter === "all" ||
          (filter === "members"
            ? ["communicant", "baptized", "nonResident"].includes(
                person.membershipStatus,
              )
            : person.membershipStatus === filter)),
    )
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
}
export function attendanceCounts(
  people: RosterPerson[],
  service: Pick<Service, "present">,
) {
  const counts = Object.fromEntries(
    membershipStatuses.map((status) => [status, 0]),
  ) as Record<MembershipStatus, number>;
  let online = 0;
  for (const person of people)
    if (Object.hasOwn(service.present, person.id)) {
      counts[person.membershipStatus]++;
      if (service.present[person.id].mode === "online") online++;
    }
  return {
    ...counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    online,
  };
}
export function churchDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function nextService(
  types: ServiceType[],
  now: Date,
  timeZone: string,
): { typeId: string; date: string } | null {
  const today = churchDate(now, timeZone);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const active = types.filter((type) => type.isActive);
  // Keep the most recently started service selected for two hours while roll call is taken.
  const minutes = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const current = active
    .filter(
      (type) =>
        type.dayOfWeek === day &&
        minutes(time) >= minutes(type.defaultTime) &&
        minutes(time) <= minutes(type.defaultTime) + 120,
    )
    .sort((a, b) => b.defaultTime.localeCompare(a.defaultTime))[0];
  if (current) return { typeId: current.id, date: today };
  const candidates = active
    .map((type) => {
      let delta = (type.dayOfWeek - day + 7) % 7;
      if (delta === 0 && type.defaultTime < time) delta = 7;
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + delta);
      return {
        typeId: type.id,
        date: date.toISOString().slice(0, 10),
        time: type.defaultTime,
      };
    })
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return candidates[0] ?? null;
}
