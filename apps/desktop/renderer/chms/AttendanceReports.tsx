import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Select,
  Spinner,
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  attendanceReport,
  reportAttendanceRows,
  attendanceReportFilterSchema,
  attendanceReportTitles,
  churchDate,
  membershipStatuses,
  statusLabels,
  type AttendanceReportKind,
  type AttendanceReportFilter,
  type ReportRow,
  type Role,
} from "@sycamore/shared";
import { useAttendanceReports } from "../data/attendance-reports";
import {
  escapeHtml,
  exportReportWorkbook,
  reportChart,
  reportHtml,
  reportTable,
  savePdf,
} from "../data/reports";
import { ExportButton } from "../components/ExportButton";
import { friendlyError, Picker } from "./Common";
export type ReportRequest = {
  kind: AttendanceReportKind;
  filter?: Partial<AttendanceReportFilter>;
  absentOnly?: boolean;
};
export function AttendanceReports({
  roles,
  timeZone,
  initial,
}: {
  roles: Role[];
  timeZone: string;
  initial?: ReportRequest;
}) {
  const data = useAttendanceReports(roles),
    today = churchDate(new Date(), timeZone);
  const deacon = !roles.some((role) =>
    ["admin", "pastor", "clerk", "elder", "readOnly"].includes(role),
  );
  const [kind, setKind] = useState<AttendanceReportKind>(
    initial?.kind || "summary",
  );
  const [filter, setFilter] = useState<AttendanceReportFilter>({
    from: DateTime.fromISO(today, { zone: "utc" })
      .minus({ months: 3 })
      .toISODate()!,
    to: today,
    serviceTypeId: "",
    status: "",
    districtId: "",
    ...initial?.filter,
  });
  const [view, setView] = useState("detail"),
    [chart, setChart] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [absentOnly, setAbsentOnly] = useState(initial?.absentOnly || false);
  const parsed = attendanceReportFilterSchema.safeParse(filter);
  const result = useMemo(
    () => (parsed.success ? attendanceReport(data, parsed.data) : null),
    [
      data.people,
      data.households,
      data.services,
      data.types,
      data.history,
      data.sacraments,
      data.followUps,
      data.careNotes,
      filter,
    ],
  );
  const privateReport =
    data.session && ["shepherding", "visitors"].includes(kind);
  const ready =
    data.loaded &&
    (!privateReport || data.careReady) &&
    !data.error &&
    (!privateReport || !data.careError) &&
    !!result;
  const title =
    attendanceReportTitles[kind] + (privateReport ? " (Session only)" : "");
  const detail: ReportRow[] = !result
    ? []
    : kind === "summary"
      ? result.summary
      : kind === "matrix"
        ? result.matrix
        : kind === "shepherding"
          ? result.shepherding.filter(
              (row) =>
                !absentOnly || Number(row["Recorded Lord's Days missed"]) >= 3,
            )
          : kind === "visitors"
            ? result.visitors
            : result.roll;
  const attendance = useMemo(
    () => (result ? reportAttendanceRows(result, kind, absentOnly) : []),
    [result, kind, absentOnly],
  );
  useEffect(() => {
    setChart(
      result
        ? reportChart(
            result.monthly.map((row) => row.Month),
            result.monthly.map((row) =>
              row.Services
                ? Math.round(
                    (attendance.filter((record) =>
                      String(record.Date).startsWith(row.Month),
                    ).length /
                      row.Services) *
                      10,
                  ) / 10
                : null,
            ),
          )
        : "",
    );
  }, [result, attendance]);
  const source: ReportRow[] = result
    ? kind === "roll"
      ? result.changes
      : [
          ...attendance.map((row) => ({
            ...row,
            Record: "Attendance",
            Review: "",
          })),
          ...result.review.map((row) => ({
            Date: "",
            Service: "",
            "Service ID": "",
            "Person ID": "",
            Name: row.Name,
            Status: "",
            Method: "",
            Record: "Review",
            Review: row.Issue,
          })),
        ]
    : [];
  const summary: ReportRow[] = result
    ? [
        { Measure: "Period", Value: `${filter.from} to ${filter.to}` },
        { Measure: "Recorded services", Value: result.services.length },
        {
          Measure: "Attendance marks matching filters",
          Value: attendance.length,
        },
        { Measure: "Rows in report", Value: detail.length },
        { Measure: "Records needing review", Value: result.review.length },
        {
          Measure: "Review scope",
          Value: "Includes unclassified people outside named report subjects",
        },
        {
          Measure: "District assignments",
          Value: "Current assignments are used for historical dates",
        },
        {
          Measure: "Membership categories",
          Value:
            "Recorded history on each service date; no current-status fallback",
        },
        {
          Measure: "Missing meetings",
          Value: "Unrecorded meetings are excluded, not counted as zero",
        },
        {
          Measure: "Follow-up information",
          Value: privateReport
            ? "Session only; current open tasks and recorded visits"
            : "Excluded",
        },
      ]
    : [];
  const visible =
    view === "detail"
      ? detail
      : view === "data"
        ? source
        : result?.review || [];
  const xlsx = () =>
    exportReportWorkbook(
      title,
      summary,
      kind === "roll" ? result?.changes || [] : detail,
      kind === "roll" ? detail : source,
      chart,
    );
  async function pdf() {
    setBusy(true);
    setError("");
    try {
      const sections =
        kind === "matrix" && result
          ? Array.from(
              { length: Math.ceil(result.headers.length / 6) },
              (_, index) => {
                const headers = result.headers.slice(index * 6, index * 6 + 6);
                return `<h2 class="${index ? "page-break" : ""}">Services ${index * 6 + 1} to ${Math.min(result.headers.length, index * 6 + 6)}</h2>${reportTable(detail.map((row) => Object.fromEntries(["Household", "Name", ...headers, "Attended", "Eligible", "Attendance %"].map((key) => [key, row[key]]))))}`;
              },
            ).join("")
          : reportTable(detail);
      await savePdf(
        title,
        reportHtml(
          title,
          `${filter.from} to ${filter.to}`,
          `${privateReport ? '<p class="privacy">Session only. Keep this report within the Session.</p>' : ""}<h2>Summary</h2>${reportTable(summary)}${chart ? `<img class="chart" alt="Average recorded attendance" src="${chart}">` : ""}<h2 class="page-break">Detail</h2>${sections}${kind === "roll" ? `<h2 class="page-break">Membership changes</h2>${reportTable(result?.changes || [])}` : ""}<p>${escapeHtml("Percentages use recorded eligible services. A question mark means membership history needs review. Three missed Lord's Days means three recorded dates, not three calendar weeks. Visitor visits are distinct dates. The 52-week comparison preserves the weekday.")}</p><h2>Review</h2>${reportTable(result?.review || [])}`,
        ),
      );
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REPORTS</span>
          <Title3 as="h1">{attendanceReportTitles[kind]}</Title3>
          <p>{reportDescriptions[kind]}</p>
        </div>
        <div className="actions">
          <Button onClick={data.refresh}>Refresh history</Button>
          <Button disabled={!ready || busy} onClick={() => void pdf()}>
            Print / PDF
          </Button>
        </div>
      </div>
      {privateReport && (
        <span className="session-badge">
          <LockClosedRegular aria-hidden /> Session only
        </span>
      )}
      {(error || data.error || (privateReport && data.careError)) && (
        <MessageBar intent="error">
          {error || data.error || data.careError}
        </MessageBar>
      )}
      <section className="surface communication-panel">
        <div className="report-filters">
          <Field label="Report">
            <Select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as AttendanceReportKind);
                setView("detail");
              }}
            >
              {Object.entries(attendanceReportTitles)
                .filter(([id]) => !deacon || ["summary", "matrix"].includes(id))
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={filter.from}
              onChange={(_, row) => setFilter({ ...filter, from: row.value })}
            />
          </Field>
          <Field label="Through">
            <Input
              type="date"
              value={filter.to}
              onChange={(_, row) => setFilter({ ...filter, to: row.value })}
            />
          </Field>
          <Picker
            label="Service type filter"
            value={filter.serviceTypeId}
            choices={data.types.map((row) => ({ id: row.id, name: row.name }))}
            empty="All recorded service types"
            onChange={(value) => setFilter({ ...filter, serviceTypeId: value })}
          />
          <Picker
            label="Membership filter"
            value={filter.status}
            choices={membershipStatuses.map((id) => ({
              id,
              name: statusLabels[id],
            }))}
            empty="All historical statuses"
            onChange={(value) =>
              setFilter({
                ...filter,
                status: value as AttendanceReportFilter["status"],
              })
            }
          />
          <Picker
            label="Elder district filter"
            value={filter.districtId}
            choices={data.districts.map((row) => ({
              id: row.id,
              name: row.name,
            }))}
            empty="All current districts"
            onChange={(value) => setFilter({ ...filter, districtId: value })}
          />
        </div>
        <p>
          Percentages use eligible recorded services. Choose a single service
          type for shepherding comparisons. District assignments are current.
          Unclassified records cannot match a specific membership filter.
        </p>
      </section>
      {kind === "shepherding" && (
        <Checkbox
          label="Absent 3+ recorded Lord's Days only"
          checked={absentOnly}
          onChange={(_, row) => setAbsentOnly(row.checked === true)}
        />
      )}
      {!parsed.success && (
        <MessageBar intent="warning">
          Choose valid dates in order, covering no more than 366 days.
        </MessageBar>
      )}
      {kind === "roll" && (
        <p>
          The roll uses the Through date. From applies to membership changes;
          the service type applies to the attendance chart.
        </p>
      )}
      {!data.loaded && !data.error && (
        <Spinner label="Loading report records" />
      )}
      {privateReport && !data.careReady && !data.careError && (
        <Spinner label="Loading Session follow-ups" />
      )}
      {result &&
        data.loaded &&
        (!privateReport || (data.careReady && !data.careError)) && (
          <>
            {!!result.review.length && (
              <MessageBar intent="warning">
                {result.review.length} records need review. Missing history is
                not inferred from the current roll. Open Review records before
                distributing this report.
              </MessageBar>
            )}
            <div className="report-metrics" aria-label="Report totals">
              {summary.slice(1, 5).map((row) => (
                <div className="surface" key={String(row.Measure)}>
                  <span>{row.Measure}</span>
                  <strong>{row.Value}</strong>
                </div>
              ))}
            </div>
            {chart && (
              <img
                className="report-chart"
                src={chart}
                alt="Monthly average recorded attendance"
              />
            )}
            <TabList
              selectedValue={view}
              onTabSelect={(_, row) => setView(String(row.value))}
            >
              <Tab value="detail">Report detail</Tab>
              <Tab value="data">
                {kind === "roll" ? "Membership changes" : "Source rows"}
              </Tab>
              <Tab value="review">Review records</Tab>
            </TabList>
            <section className="surface communication-panel">
              <div className="section-heading">
                <span>{visible.length} rows</span>
                {ready && (
                  <ExportButton
                    rows={visible}
                    onXlsx={view === "detail" ? xlsx : undefined}
                  />
                )}
              </div>
              {!visible.length ? (
                <p>No records match this view.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {Object.keys(visible[0]).map((key) => (
                          <th key={key}>{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row, index) => (
                        <tr key={index}>
                          {Object.entries(row).map(([key, value]) => (
                            <td key={key}>{value}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
    </>
  );
}

// What each report answers, shown under its title.
const reportDescriptions: Record<AttendanceReportKind, string> = {
  summary:
    "People present at each recorded service, with averages and the same week last year.",
  matrix: "Who was marked present at each recorded service in the period.",
  shepherding:
    "Recorded Lord's Days missed and follow-up for each person, by elder district.",
  visitors:
    "Visitors in the period, how often they came and whether anyone has followed up.",
  roll: "The membership roll on the last date, and every change in the period.",
};
