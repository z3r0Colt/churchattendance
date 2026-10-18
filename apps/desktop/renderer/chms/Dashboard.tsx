import { useEffect, useMemo, useState } from "react";
import {
  Badge,
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
  historicalMembership,
  type Role,
  type Serving,
} from "@sycamore/shared";
import { useAttendanceReports } from "../data/attendance-reports";
import { useCollection } from "../data/chms";
import { reportChart } from "../data/reports";
import { Picker, Records } from "./Common";
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
  open: (page: "care" | "serving" | "people") => void;
}) {
  const data = useAttendanceReports(roles),
    serving = useCollection<Serving>("serving");
  const today = churchDate(new Date(), timeZone),
    date = DateTime.fromISO(today, { zone: "utc" });
  const [typeId, setType] = useState<string | null>(null),
    [chart, setChart] = useState("");
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
  const year = useMemo(
    () =>
      attendanceReport(data, {
        ...filter,
        from: date.minus({ months: 11 }).startOf("month").toISODate()!,
      }),
    [
      data.people,
      data.households,
      data.history,
      data.sacraments,
      data.services,
      data.types,
      selected,
      today,
    ],
  );
  useEffect(
    () =>
      setChart(
        reportChart(
          year.monthly.map((row) => row.Month),
          year.monthly.map((row) =>
            typeof row.Average === "number" ? row.Average : null,
          ),
          undefined,
          "Average recorded attendance",
          "line",
        ),
      ),
    [year],
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
          <Title3 as="h1">Dashboard</Title3>
          <p>Recorded attendance and the week ahead</p>
        </div>
        <Button onClick={data.refresh}>Refresh history</Button>
      </div>
      {(data.error || serving.error) && (
        <MessageBar intent="error">{data.error || serving.error}</MessageBar>
      )}
      <Picker
        label="Dashboard service type"
        value={selected}
        choices={data.types.map((row) => ({ id: row.id, name: row.name }))}
        empty="All recorded types"
        onChange={(value) => setType(value)}
      />
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
          <div className="dashboard-grid">
            <Button
              className="dashboard-tile"
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
              <strong>{sunday ? sunday.Total : "No record"}</strong>
              <small>
                {sunday?.Date || "No service recorded in the last three months"}
              </small>
            </Button>
            <Button
              className="dashboard-tile"
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
              <strong>
                {sunday?.["Prior 4 week average"] ?? "No records"}
              </strong>
              <small>Recorded services only</small>
            </Button>
            {canExtendedReport && (
              <>
                <Button
                  className="dashboard-tile"
                  onClick={() =>
                    go("visitors", {}, { ...filter, from: monthStart })
                  }
                >
                  <span>Visitors this month</span>
                  <strong>{visitors.size}</strong>
                  <small>Distinct people with visitor history</small>
                </Button>
                <Button
                  className="dashboard-tile"
                  onClick={() => go("shepherding", { absentOnly: true })}
                >
                  <span>Absent 3+ recorded Lord's Days</span>
                  <strong>{absent.length}</strong>
                  <small>Within the last three months</small>
                </Button>
              </>
            )}
          </div>
          <section className="surface communication-panel">
            <Subtitle2>Attendance over twelve months</Subtitle2>
            {chart && (
              <img
                className="report-chart"
                src={chart}
                alt="Twelve month average recorded attendance"
              />
            )}
            <p>
              Missing months have no plotted value. The selected service type
              applies to the attendance tiles and chart.
            </p>
          </section>
          <div className="dashboard-columns">
            <section className="surface communication-panel">
              <div className="section-heading">
                <Subtitle2>Birthdays in the next seven days</Subtitle2>
                <Button onClick={() => open("people")}>Open people</Button>
              </div>
              <Records rows={birthdays} />
            </section>
            <section className="surface communication-panel">
              <div className="section-heading">
                <Subtitle2>Serving gaps in the next seven days</Subtitle2>
                <Button onClick={() => open("serving")}>Open serving</Button>
              </div>
              <Records
                rows={gaps.map((row) => ({
                  Date: row.date,
                  Time: row.time,
                  Role: row.role,
                  Location: row.location,
                }))}
              />
            </section>
          </div>
          {data.session && (
            <section className="surface communication-panel session-panel">
              <Badge
                icon={<LockClosedRegular />}
                color="important"
                appearance="outline"
              >
                Session only
              </Badge>
              <h2>Follow-ups due</h2>
              {data.careError ? (
                <MessageBar intent="error">{data.careError}</MessageBar>
              ) : !data.careReady ? (
                <Spinner label="Loading Session follow-ups" />
              ) : (
                <p>
                  {due.length} open follow-ups are due on or before {today}.
                </p>
              )}
              <Button onClick={() => open("care")}>Open pastoral care</Button>
            </section>
          )}
        </>
      )}
    </>
  );
}
