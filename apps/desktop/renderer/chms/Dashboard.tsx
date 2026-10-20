import { churchDayLabel } from "@sycamore/shared";
import { useMemo, useState } from "react";
import {
  Button,
  MessageBar,
  Spinner,
  Subtitle2,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  attendanceReport,
  churchDate,
  eventOccurrences,
  historicalMembership,
  termReviews,
  type ChurchEvent,
  type Role,
  type Serving,
} from "@sycamore/shared";
import { useAttendanceReports } from "../data/attendance-reports";
import { useCollection } from "../data/chms";
import { Picker } from "./Common";
import type { ReportRequest } from "./AttendanceReports";
export function Dashboard({
  roles,
  timeZone,
  report,
  open,
}: {
  roles: Role[];
  timeZone: string;
  report: (request: ReportRequest) => void;
  open: (page: "care" | "serving" | "people" | "calendar" | "officers") => void;
}) {
  const data = useAttendanceReports(roles),
    serving = useCollection<Serving>("serving"),
    events = useCollection<ChurchEvent>("events");
  const today = churchDate(new Date(), timeZone),
    date = DateTime.fromISO(today, { zone: "utc" });
  const [typeId, setType] = useState<string | null>(null);
  const defaultType =
    [...data.types]
      .filter((row) => row.dayOfWeek === 0 && row.isActive)
      .sort((a, b) => a.defaultTime.localeCompare(b.defaultTime))[0]?.id || "";
  const selected = typeId ?? defaultType;
  const filter = {
    from: date.minus({ months: 3 }).toISODate()!,
    to: today,
    serviceTypeId: selected,
    districtId: "",
    status: "" as const,
  };
  const result = useMemo(
    () => attendanceReport(data, filter),
    [
      data.people,
      data.households,
      data.history,
      data.sacraments,
      data.services,
      data.types,
      selected,
      today,
      data.followUps,
      data.careNotes,
    ],
  );
  const sunday = result.summary
    .filter((row) => DateTime.fromISO(row.Date, { zone: "utc" }).weekday === 7)
    .at(-1);
  const monthStart = date.startOf("month").toISODate()!;
  const visitors = new Set(
    data.services
      .filter(
        (row) =>
          (!selected || row.serviceTypeId === selected) &&
          row.date >= monthStart &&
          row.date <= today,
      )
      .flatMap((row) =>
        Object.keys(row.present).filter(
          (id) =>
            historicalMembership(
              data.people.find((person) => person.id === id),
              data.history,
              row.date,
            ).status === "visitor",
        ),
      ),
  );
  const absent = result.shepherding.filter(
    (row) => Number(row["Recorded Lord's Days missed"]) >= 3,
  );
  const birthdays = data.people
    .filter(
      (person) =>
        !person.isDeceased &&
        person.membershipStatus !== "former" &&
        person.birthDate,
    )
    .flatMap((person) => {
      const day = DateTime.fromISO(
        `${date.year}-${person.birthDate.slice(5)}`,
        { zone: "utc" },
      );
      const next =
        day.isValid && day < date
          ? DateTime.fromISO(`${date.year + 1}-${person.birthDate.slice(5)}`, {
              zone: "utc",
            })
          : day;
      return next.isValid &&
        next.toISODate()! <= date.plus({ days: 6 }).toISODate()!
        ? [
            {
              Name: `${person.firstName} ${person.lastName}`,
              Birthday: next.toISODate()!,
            },
          ]
        : [];
    })
    .sort((a, b) => a.Birthday.localeCompare(b.Birthday));
  const gaps = serving.rows.filter(
    (row) =>
      !row.cancelled &&
      !row.personId &&
      row.date >= today &&
      row.date <= date.plus({ days: 6 }).toISODate()!,
  );
  const due =
    data.followUps?.filter((row) => !row.done && row.dueDate <= today) || [];
  const reviews = data.session ? termReviews(data.offices, today) : [];
  // The last twelve recorded Lord's Days for the selected service type.
  const weeks = result.summary
    .filter((row) => DateTime.fromISO(row.Date, { zone: "utc" }).weekday === 7)
    .slice(-12)
    .map((row) => ({ date: String(row.Date), total: Number(row.Total) || 0 }));
  const peak = Math.max(1, ...weeks.map((row) => row.total));
  const weekEnd = date.plus({ days: 6 }).toISODate()!;
  // One date-ordered list of what is coming up this week.
  const week = [
    ...events.rows.flatMap((event) =>
      eventOccurrences(event, today, weekEnd, timeZone).map((row) => {
        const start = DateTime.fromISO(row.start).setZone(timeZone);
        return {
          key: row.id,
          date: start.toISODate()!,
          sort: start.toFormat("HH:mm"),
          title: row.title,
          detail: [start.toFormat("h:mm a"), row.location]
            .filter(Boolean)
            .join(" · "),
        };
      }),
    ),
    ...birthdays.map((row) => ({
      key: `birthday_${row.Name}`,
      date: row.Birthday,
      sort: "00:00",
      title: `${row.Name}'s birthday`,
      detail: "Birthday",
    })),
    ...gaps.map((row) => ({
      key: `serving_${row.id}`,
      date: row.date,
      sort: row.time,
      title: `${row.role} needed`,
      detail: [row.time, row.location, "not yet filled"]
        .filter(Boolean)
        .join(" · "),
    })),
  ].sort((a, b) => `${a.date}${a.sort}`.localeCompare(`${b.date}${b.sort}`));
  const canExtendedReport = roles.some((role) =>
    ["admin", "pastor", "clerk", "elder", "readOnly"].includes(role),
  );
  const go = (
    kind: ReportRequest["kind"],
    extra: Partial<ReportRequest> = {},
    range = filter,
  ) => report({ kind, filter: range, ...extra });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{dayLine(date)}</span>
          <Title3 as="h1">The week ahead</Title3>
          <p>Recorded attendance and what is coming up.</p>
        </div>
        <div className="actions heading-tools">
          <Picker
            label="Dashboard service type"
            value={selected}
            choices={data.types.map((row) => ({ id: row.id, name: row.name }))}
            empty="All recorded types"
            onChange={(value) => setType(value)}
          />
          <Button onClick={data.refresh}>Refresh history</Button>
        </div>
      </div>
      {(data.error || serving.error) && (
        <MessageBar intent="error">{data.error || serving.error}</MessageBar>
      )}
      {!data.loaded ? (
        <Spinner label="Loading dashboard" />
      ) : (
        <>
          {!!result.review.length && (
            <MessageBar intent="warning">
              Membership history needs review. Visitor and absence totals
              include only people whose recorded history supports them.
            </MessageBar>
          )}
          <div className="tiles">
            <Button
              className="tile tile-button lead"
              onClick={() =>
                go(
                  "summary",
                  {},
                  {
                    ...filter,
                    from: sunday?.Date || today,
                    to: sunday?.Date || today,
                  },
                )
              }
            >
              <span>Last recorded Lord's Day</span>
              <strong>{sunday ? sunday.Total : "–"}</strong>
              <small>
                {sunday
                  ? DateTime.fromISO(String(sunday.Date)).toFormat("LLLL d")
                  : "None in the last three months"}
              </small>
            </Button>
            <Button
              className="tile tile-button"
              onClick={() =>
                go(
                  "summary",
                  {},
                  {
                    ...filter,
                    from: sunday
                      ? DateTime.fromISO(sunday.Date, { zone: "utc" })
                          .minus({ weeks: 4 })
                          .toISODate()!
                      : filter.from,
                    to: sunday
                      ? DateTime.fromISO(sunday.Date, { zone: "utc" })
                          .minus({ days: 1 })
                          .toISODate()!
                      : today,
                  },
                )
              }
            >
              <span>Prior 4 week average</span>
              <strong>{sunday?.["Prior 4 week average"] ?? "–"}</strong>
              <small>Recorded services only</small>
            </Button>
            {canExtendedReport && (
              <>
                <Button
                  className="tile tile-button"
                  onClick={() =>
                    go("visitors", {}, { ...filter, from: monthStart })
                  }
                >
                  <span>Visitors this month</span>
                  <strong>{visitors.size}</strong>
                  <small>Distinct people with visitor history</small>
                </Button>
                <Button
                  className="tile tile-button"
                  onClick={() => go("shepherding", { absentOnly: true })}
                >
                  <span>Absent 3+ recorded Lord's Days</span>
                  <strong>{absent.length}</strong>
                  <small>Within the last three months</small>
                </Button>
              </>
            )}
          </div>
          <div className="dashboard-columns">
            <section className="surface communication-panel">
              <div className="section-heading">
                <Subtitle2>Lord's Day attendance</Subtitle2>
                <span className="muted">Last 12 recorded · present</span>
              </div>
              {weeks.length ? (
                <>
                  <div
                    className="week-bars"
                    role="img"
                    aria-label={`Present on the last ${weeks.length} recorded Lord's Days: ${weeks.map((row) => `${DateTime.fromISO(row.date).toFormat("LLL d")} ${row.total}`).join(", ")}`}
                  >
                    {weeks.map((row, index) => (
                      <div key={row.date} className="week-bar">
                        <span>{row.total}</span>
                        <div
                          className={
                            index === weeks.length - 1 ? "bar latest" : "bar"
                          }
                          style={{ height: `${(row.total / peak) * 140}px` }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="week-axis muted">
                    <span>
                      {DateTime.fromISO(weeks[0].date).toFormat("LLL d")}
                    </span>
                    <span>
                      {DateTime.fromISO(weeks.at(-1)!.date).toFormat("LLL d")}
                    </span>
                  </div>
                </>
              ) : (
                <p className="records-empty">
                  No Lord's Day services are recorded for this service type in
                  the last three months.
                </p>
              )}
            </section>
            <section className="surface communication-panel">
              <div className="section-heading">
                <Subtitle2>This week</Subtitle2>
              </div>
              {week.length ? (
                <ul className="week-list">
                  {week.map((row) => {
                    const day = DateTime.fromISO(row.date);
                    return (
                      <li key={row.key}>
                        <span className="date-badge" aria-hidden="true">
                          <small>
                            {day.weekday === 7
                              ? "Lord's Day"
                              : day.toFormat("ccc")}
                          </small>
                          <strong>{day.day}</strong>
                        </span>
                        <span>
                          <strong>{row.title}</strong>
                          <small className="muted">
                            {churchDayLabel(day)}
                            {row.detail ? ` · ${row.detail}` : ""}
                          </small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="records-empty">
                  No gatherings, birthdays or open serving slots this week.
                </p>
              )}
              <div className="actions">
                <Button appearance="subtle" onClick={() => open("calendar")}>
                  Open calendar
                </Button>
                <Button appearance="subtle" onClick={() => open("serving")}>
                  Open serving
                </Button>
              </div>
            </section>
          </div>
          {data.session && (
            <section className="surface session-strip session-panel">
              <span className="session-badge">
                <LockClosedRegular aria-hidden /> Session only
              </span>
              {data.careError ? (
                <MessageBar intent="error">{data.careError}</MessageBar>
              ) : !data.careReady ? (
                <Spinner label="Loading Session follow-ups" />
              ) : (
                <p>
                  {due.length === 1
                    ? "1 follow-up is due"
                    : `${due.length} follow-ups are due`}{" "}
                  today or earlier.
                  {!!reviews.length &&
                    ` ${reviews.length === 1 ? "1 officer term needs" : `${reviews.length} officer terms need`} review within 60 days.`}
                </p>
              )}
              <Button onClick={() => open("care")}>Open pastoral care</Button>
              {!!reviews.length && (
                <Button onClick={() => open("officers")}>Review terms</Button>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
// "Monday, October 19, 2026", with Sunday named the Lord's Day.
function dayLine(date: DateTime) {
  return `${date.weekday === 7 ? "Lord's Day" : date.toFormat("cccc")}, ${date.toFormat("LLLL d, yyyy")}`;
}
