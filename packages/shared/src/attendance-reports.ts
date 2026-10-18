import { z } from "zod";
import { DateTime } from "luxon";
import {
  dateSchema,
  idSchema,
  statusSchema,
  statusLabels,
  type Person,
  type Household,
  type Service,
  type ServiceType,
  type MembershipStatus,
} from "./domain.js";
import {
  membershipAt,
  type HistoryEvent,
  type Sacrament,
  type ReportRow,
  type FollowUp,
  type CareNote,
} from "./chms.js";

export const attendanceReportFilterSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    serviceTypeId: z.union([idSchema, z.literal("")]).default(""),
    districtId: z.union([idSchema, z.literal("")]).default(""),
    status: z.union([statusSchema, z.literal("")]).default(""),
  })
  .strict()
  .refine(
    (row) =>
      row.from <= row.to &&
      DateTime.fromISO(row.to, { zone: "utc" }).diff(
        DateTime.fromISO(row.from, { zone: "utc" }),
        "days",
      ).days < 366,
    "Choose a date range of at most 366 days",
  );
export type AttendanceReportFilter = z.infer<
  typeof attendanceReportFilterSchema
>;
export type AttendanceReportSource = {
  people: Person[];
  households: Household[];
  services: Service[];
  types: ServiceType[];
  history: HistoryEvent[];
  sacraments: Sacrament[];
  followUps?: FollowUp[];
  careNotes?: CareNote[];
};
export type AttendanceReportKind =
  "summary" | "matrix" | "shepherding" | "visitors" | "roll";
export const attendanceReportTitles: Record<AttendanceReportKind, string> = {
  summary: "Attendance summary",
  matrix: "Attendance matrix",
  shepherding: "Shepherding report",
  visitors: "Visitor follow-up",
  roll: "Membership roll",
};
const member = (status: MembershipStatus | null) =>
  status !== null &&
  ["communicant", "baptized", "nonResident"].includes(status);
const average = (values: number[]) =>
  values.length
    ? Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
      ) / 10
    : "No records";

// A valid initial entry proves that dates before it are outside the roll. Missing or inconsistent history proves nothing.
export function historicalMembership(
  person: Person | undefined,
  history: HistoryEvent[],
  date: string,
) {
  if (!person || (person.isDeceased && person.membershipStatus !== "former"))
    return { known: false, status: null };
  const events = history.filter((row) => row.personId === person.id);
  if (
    !events.length ||
    events.some(
      (row) =>
        !dateSchema.safeParse(row.date).success ||
        !statusSchema.safeParse(row.toStatus).success ||
        (row.fromStatus !== null &&
          !statusSchema.safeParse(row.fromStatus).success),
    ) ||
    membershipAt(person, events, "9999-12-31") !== person.membershipStatus
  )
    return { known: false, status: null };
  const status = membershipAt(person, events, date);
  const initial = events
    .filter((row) => row.fromStatus === null)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!initial && date < events.map((row) => row.date).sort()[0])
    return { known: false, status: null };
  return {
    known: status !== null || (!!initial && date < initial.date),
    status,
  };
}
export function attendanceReport(
  source: AttendanceReportSource,
  rawFilter: AttendanceReportFilter,
) {
  const filter = attendanceReportFilterSchema.parse(rawFilter);
  const people = new Map(source.people.map((row) => [row.id, row]));
  const statuses = new Map<string, ReturnType<typeof historicalMembership>>();
  const at = (id: string, date: string) => {
    const key = `${id}/${date}`;
    if (!statuses.has(key))
      statuses.set(
        key,
        historicalMembership(people.get(id), source.history, date),
      );
    return statuses.get(key)!;
  };
  const typeName = (id: string) =>
    source.types.find((row) => row.id === id)?.name || id;
  const family = (id: string) => source.households.find((row) => row.id === id);
  const selectedType = (row: Service) =>
    !filter.serviceTypeId || row.serviceTypeId === filter.serviceTypeId;
  const district = (person: Person | undefined) =>
    !filter.districtId || person?.elderDistrictId === filter.districtId;
  const matches = (id: string, date: string) =>
    district(people.get(id)) &&
    (!filter.status ||
      (at(id, date).known && at(id, date).status === filter.status));
  const all = source.services.filter(
    (row) => selectedType(row) && row.date <= filter.to,
  );
  const services = all
    .filter((row) => row.date >= filter.from)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.serviceTypeId.localeCompare(b.serviceTypeId),
    );
  const count = (row: Service) =>
    Object.keys(row.present).filter((id) => matches(id, row.date)).length;
  const summary = services.map((row) => {
    const counts = {
      Communicant: 0,
      Baptized: 0,
      "Non-resident": 0,
      Adherents: 0,
      Visitors: 0,
      Former: 0,
      Unclassified: 0,
    };
    const columns = {
      communicant: "Communicant",
      baptized: "Baptized",
      nonResident: "Non-resident",
      adherent: "Adherents",
      visitor: "Visitors",
      former: "Former",
    } as const;
    for (const id of Object.keys(row.present).filter((id) =>
      matches(id, row.date),
    )) {
      const status = at(id, row.date);
      counts[
        status.known && status.status ? columns[status.status] : "Unclassified"
      ]++;
    }
    const previous = all.filter(
      (other) =>
        other.serviceTypeId === row.serviceTypeId &&
        other.date < row.date &&
        other.date >=
          DateTime.fromISO(row.date, { zone: "utc" })
            .minus({ weeks: 4 })
            .toISODate()!,
    );
    const yearDate = DateTime.fromISO(row.date, { zone: "utc" })
      .minus({ weeks: 52 })
      .toISODate()!;
    const lastYear = all.find(
      (other) =>
        other.serviceTypeId === row.serviceTypeId && other.date === yearDate,
    );
    return {
      Date: row.date,
      Service: typeName(row.serviceTypeId),
      ...counts,
      Total: count(row),
      "Prior 4 week average": average(previous.map(count)),
      "Same weekday 52 weeks earlier": lastYear ? count(lastYear) : "No record",
    };
  });
  const attendanceData: ReportRow[] = services.flatMap((row) =>
    Object.keys(row.present)
      .filter((id) => matches(id, row.date))
      .map((id) => ({
        Date: row.date,
        Service: typeName(row.serviceTypeId),
        "Service ID": row.id,
        "Person ID": id,
        Name: people.has(id)
          ? `${people.get(id)!.firstName} ${people.get(id)!.lastName}`
          : "Person record missing",
        Status:
          at(id, row.date).known && at(id, row.date).status
            ? statusLabels[at(id, row.date).status!]
            : "Unclassified",
        Method: row.present[id].method,
      })),
  );
  const ordered = source.people
    .filter(district)
    .sort(
      (a, b) =>
        (family(a.householdId)?.name || a.householdId).localeCompare(
          family(b.householdId)?.name || b.householdId,
        ) ||
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
  const headers = services.map(
    (row) =>
      `${row.date} ${typeName(row.serviceTypeId)} [${row.serviceTypeId}]`,
  );
  const recentDays = [
    ...new Set(
      services
        .filter(
          (row) => DateTime.fromISO(row.date, { zone: "utc" }).weekday === 7,
        )
        .map((row) => row.date),
    ),
  ]
    .sort()
    .reverse();
  const rates = (person: Person, regularOnly = false) => {
    let eligible = 0,
      attended = 0,
      unknown = 0,
      marks = 0;
    const cells = services.map((row) => {
      const state = at(person.id, row.date);
      if (regularOnly && state.known && state.status === "visitor")
        return "n/a";
      if (!matches(person.id, row.date)) return "n/a";
      if (row.present[person.id]) marks++;
      if (!state.known) {
        unknown++;
        return row.present[person.id] ? "✓ ?" : "?";
      }
      if (!state.status || state.status === "former")
        return row.present[person.id] ? "Review mark" : "n/a";
      eligible++;
      if (row.present[person.id]) attended++;
      return row.present[person.id] ? "✓" : "";
    });
    let missed = 0;
    for (const date of recentDays) {
      const state = at(person.id, date);
      if (
        !state.known ||
        !state.status ||
        state.status === "former" ||
        state.status === "visitor" ||
        !matches(person.id, date) ||
        services.some((row) => row.date === date && row.present[person.id])
      )
        break;
      missed++;
    }
    return {
      eligible,
      attended,
      unknown,
      marks,
      cells,
      missed,
      percent: unknown
        ? "Review history"
        : eligible
          ? Math.round((attended / eligible) * 1000) / 10
          : "No eligible services",
    };
  };
  const lastSeen = (id: string) =>
    all
      .filter((row) => row.present[id])
      .map((row) => row.date)
      .sort()
      .at(-1) || "Not recorded";
  const careAvailable =
    source.followUps !== undefined && source.careNotes !== undefined;
  const care = (id: string, first = ""): ReportRow => {
    const open =
      source.followUps?.filter((row) => row.personId === id && !row.done) || [];
    const visits =
      source.careNotes
        ?.filter(
          (row) =>
            row.personId === id &&
            row.kind === "visit" &&
            row.date >= first &&
            row.date <= filter.to,
        )
        .sort((a, b) => b.date.localeCompare(a.date)) || [];
    return careAvailable
      ? {
          "Current open follow-ups": open.length,
          "Latest recorded visit": visits[0]?.date || "None recorded",
        }
      : { "Follow-up information": "Session only" };
  };
  const matrix: ReportRow[] = [],
    shepherding: ReportRow[] = [],
    visitors: ReportRow[] = [],
    roll: ReportRow[] = [];
  const subjects = new WeakMap<ReportRow, string>();
  for (const person of ordered) {
    const name = `${person.firstName} ${person.lastName}`,
      household = family(person.householdId),
      state = at(person.id, filter.to),
      rate = rates(person);
    if (
      rate.eligible ||
      rate.marks ||
      (rate.unknown &&
        !person.isDeceased &&
        person.membershipStatus !== "former")
    )
      matrix.push({
        Household: household?.name || person.householdId,
        Name: name,
        ...Object.fromEntries(headers.map((key, i) => [key, rate.cells[i]])),
        Attended: rate.attended,
        Eligible: rate.eligible,
        "Unknown history services": rate.unknown,
        "Attendance %": rate.percent,
      });
    if (
      matches(person.id, filter.to) &&
      (state.known
        ? !!state.status && !["former", "visitor"].includes(state.status)
        : !person.isDeceased &&
          person.membershipStatus !== "former" &&
          person.membershipStatus !== "visitor")
    ) {
      const shepherdRate = rates(person, true);
      shepherding.push({
        Household: household?.name || person.householdId,
        Name: name,
        "Last attended": lastSeen(person.id),
        "Attendance %": shepherdRate.percent,
        "Recorded Lord's Days missed": shepherdRate.missed,
        Review:
          !state.known || shepherdRate.unknown
            ? "Review history"
            : shepherdRate.missed >= 3
              ? "Absent 3+ recorded Lord's Days"
              : "",
        ...care(person.id),
      });
      subjects.set(shepherding.at(-1)!, person.id);
    }
    const visitDates = [
      ...new Set(
        all
          .filter(
            (row) =>
              row.present[person.id] &&
              at(person.id, row.date).known &&
              at(person.id, row.date).status === "visitor",
          )
          .map((row) => row.date),
      ),
    ].sort();
    const inRange = visitDates.filter(
      (date) => date >= filter.from && matches(person.id, date),
    );
    if (inRange.length) {
      visitors.push({
        Name: name,
        Household: household?.name || person.householdId,
        "First recorded visit": visitDates[0],
        "Visit dates in range": inRange.join(", "),
        "Distinct visits in range": inRange.length,
        Returning:
          visitDates[0] < filter.from || inRange.length > 1 ? "Yes" : "No",
        Email: person.email,
        Mobile: person.mobilePhone,
        ...care(person.id, visitDates[0]),
      });
      subjects.set(visitors.at(-1)!, person.id);
    }
    if (state.known && member(state.status) && matches(person.id, filter.to)) {
      const received = source.history
        .filter(
          (row) =>
            row.personId === person.id &&
            row.date <= filter.to &&
            member(row.toStatus) &&
            !member(row.fromStatus),
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      const sacrament = (type: string) =>
        source.sacraments
          .filter(
            (row) =>
              row.personId === person.id &&
              row.type === type &&
              row.date <= filter.to,
          )
          .map((row) => row.date)
          .sort()[0] || "Not recorded";
      roll.push({
        Status: statusLabels[state.status!],
        Name: name,
        Household: household?.name || person.householdId,
        "Received / initial date": received?.date || "Not recorded",
        Method: received?.method || "Not recorded",
        "Other church": received?.otherChurch || "",
        Baptism: sacrament("baptism"),
        Profession: sacrament("profession"),
        Address: household?.address || "",
      });
      subjects.set(roll.at(-1)!, person.id);
    }
  }
  shepherding.sort(
    (a, b) =>
      Number(b["Recorded Lord's Days missed"]) -
        Number(a["Recorded Lord's Days missed"]) ||
      String(a.Household).localeCompare(String(b.Household)),
  );
  roll.sort(
    (a, b) =>
      [
        statusLabels.communicant,
        statusLabels.baptized,
        statusLabels.nonResident,
      ].indexOf(String(a.Status)) -
        [
          statusLabels.communicant,
          statusLabels.baptized,
          statusLabels.nonResident,
        ].indexOf(String(b.Status)) ||
      String(a.Household).localeCompare(String(b.Household)),
  );
  const changes = source.history
    .filter(
      (row) =>
        row.date >= filter.from &&
        row.date <= filter.to &&
        district(people.get(row.personId)) &&
        (!filter.status ||
          row.fromStatus === filter.status ||
          row.toStatus === filter.status),
    )
    .map((row) => ({
      Date: row.date,
      Name: people.has(row.personId)
        ? `${people.get(row.personId)!.firstName} ${people.get(row.personId)!.lastName}`
        : "Person record missing",
      From: row.fromStatus ? statusLabels[row.fromStatus] : "Initial entry",
      To: statusLabels[row.toStatus],
      Method: row.method,
      Reason: row.reason,
    }));
  const review: ReportRow[] = source.people
    .filter(district)
    .filter((row) => !at(row.id, filter.to).known)
    .map((row) => ({
      Name: `${row.firstName} ${row.lastName}`,
      Issue: "Missing or inconsistent membership history",
    }));
  for (const row of attendanceData.filter(
    (row) =>
      row.Status === "Unclassified" || row.Status === statusLabels.former,
  ))
    review.push({
      Name: row.Name,
      Issue: `${row.Date} ${row.Service} attendance needs review`,
    });
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = DateTime.fromISO(filter.to, { zone: "utc" })
      .startOf("month")
      .minus({ months: 11 - index })
      .toFormat("yyyy-MM");
    const rows = services.filter((row) => row.date.startsWith(month));
    return {
      Month: month,
      Services: rows.length,
      Average: average(rows.map(count)),
    };
  });
  return {
    summary,
    matrix,
    shepherding,
    visitors,
    roll,
    changes,
    review,
    attendanceData,
    monthly,
    headers,
    services,
    careAvailable,
    shepherdingIds: shepherding.map((row) => subjects.get(row)!),
    visitorIds: visitors.map((row) => subjects.get(row)!),
    rollIds: roll.map((row) => subjects.get(row)!),
  };
}

export function reportAttendanceRows(
  result: ReturnType<typeof attendanceReport>,
  kind: AttendanceReportKind,
  absentOnly = false,
) {
  const ids =
    kind === "visitors"
      ? new Set(result.visitorIds)
      : kind === "roll"
        ? new Set(result.rollIds)
        : kind === "shepherding"
          ? new Set(
              result.shepherdingIds.filter(
                (_, index) =>
                  !absentOnly ||
                  Number(
                    result.shepherding[index]["Recorded Lord's Days missed"],
                  ) >= 3,
              ),
            )
          : null;
  return result.attendanceData.filter(
    (row) =>
      (!ids || ids.has(String(row["Person ID"]))) &&
      (kind !== "visitors" || row.Status === statusLabels.visitor) &&
      (kind !== "shepherding" ||
        (row.Status !== statusLabels.visitor &&
          row.Status !== statusLabels.former)),
  );
}
