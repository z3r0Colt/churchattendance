import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  SUGGESTED_ASSESSMENT_LABELS,
  attendanceReport,
  contactGaps,
  healthIndicatorKeys,
  healthIndicatorLabels,
  healthIndicators,
  communionParticipation,
  type CommunionRecord,
  indicatorStateLabels,
  statusLabels,
  type Assessment,
  type HealthIndicator,
  type ReportRow,
} from "@sycamore/shared";
import { usePrivateRecords } from "../data/private";
import { ExportButton } from "../components/ExportButton";
import { useReportData } from "../data/chms";
import {
  saveAssessment,
  saveHealthSettings,
  useAssessments,
  useContactHistory,
  type useShepherdingData,
} from "../data/shepherding";
import { Picker, Records, RecordEditor } from "./Common";

export function FlockHealth({
  data,
}: {
  data: ReturnType<typeof useShepherdingData>;
}) {
  const { history, error } = useContactHistory(true);
  const assessments = useAssessments(true);
  const report = useReportData();
  const communion = usePrivateRecords<CommunionRecord>(
    "communionRecords",
    true,
  );
  const [filter, setFilter] = useState({ district: "", concern: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    | "settings"
    | { assessment: Partial<Assessment> & { personId: string } }
    | null
  >(null);
  const settings = history?.health;
  const today =
    history?.today || DateTime.now().setZone(data.zone).toISODate()!;
  const name = (id: string) => {
    const person = data.people.find((row) => row.id === id);
    return person ? `${person.firstName} ${person.lastName}` : "Person removed";
  };
  const user = (uid: string) =>
    data.users.find((row) => row.id === uid)?.name || "Former account";
  const label = (id: string) =>
    settings?.labels.find((row) => row.id === id)?.name ||
    (id ? "Label removed" : "No label");
  // Attendance comes from the Phase 6 shepherding calculation over the configured weeks.
  const attendance = useMemo(() => {
    if (!settings || !report.loaded) return new Map<string, number | string>();
    const result = attendanceReport(
      {
        people: report.people,
        households: report.households,
        services: report.services,
        types: report.types,
        history: report.history,
        sacraments: report.sacraments,
      },
      {
        from: DateTime.fromISO(today)
          .minus({ weeks: settings.attendanceWeeks })
          .toISODate()!,
        to: today,
        serviceTypeId: "",
        districtId: "",
        status: "",
      },
    );
    return new Map(
      result.shepherdingIds.map((id, index) => [
        id,
        result.shepherding[index]["Attendance %"],
      ]),
    );
  }, [settings, report, today]);
  const flags = useMemo(
    () =>
      history?.policy
        ? contactGaps(
            data.people,
            history.events,
            history.policy,
            today,
            history.rollEntry,
          )
        : [],
    [history, data.people, today],
  );
  const people = data.people
    .filter(
      (row) =>
        !row.isDeceased &&
        !["former", "visitor"].includes(row.membershipStatus),
    )
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
  const ninetyDaysAgo = DateTime.fromISO(today)
    .minus({ days: 90 })
    .toISODate()!;
  const indicators = (personId: string): HealthIndicator[] => {
    const person = data.people.find((row) => row.id === personId)!;
    const visits = data.visits
      .filter(
        (visit) =>
          visit.status === "completed" &&
          visit.householdId === person.householdId,
      )
      .map((visit) =>
        DateTime.fromISO(visit.start).setZone(data.zone).toISODate()!,
      )
      .sort();
    return healthIndicators(
      {
        attendancePercent: attendance.get(personId),
        groups: data.groups.filter(
          (group) => !group.archived && group.memberIds.includes(personId),
        ).length,
        serving: data.serving.filter(
          (row) =>
            row.personId === personId &&
            !row.cancelled &&
            row.date >= ninetyDaysAgo &&
            row.date <= today,
        ).length,
        involvementRecorded: data.groups.length > 0 || data.serving.length > 0,
        contact: flags.find((row) => row.personId === personId),
        lastVisit: visits.at(-1) || "",
        visitRecordsSince: history?.policy?.historyStart || "",
        communion: communionParticipation(communion.rows, personId, today),
      },
      settings!,
      today,
    );
  };
  const latest = (personId: string) =>
    assessments.rows
      .filter((row) => row.personId === personId)
      .sort((a, b) => b.assessedOn.localeCompare(a.assessedOn))[0];
  const ready = !!settings && report.loaded;
  const rows = ready
    ? people
        .map((person) => ({ person, list: indicators(person.id) }))
        .filter(
          ({ person, list }) =>
            (!filter.district || person.elderDistrictId === filter.district) &&
            (!filter.concern ||
              (filter.concern === "below"
                ? list.some((row) => row.state === "below")
                : (latest(person.id)?.reviewOn || "9999") <= today)),
        )
    : [];
  const tableRows: ReportRow[] = rows.map(({ person, list }) => {
    const last = latest(person.id);
    return {
      id: person.id,
      Person: `${person.firstName} ${person.lastName}`,
      Status: statusLabels[person.membershipStatus],
      ...Object.fromEntries(
        list.map((row) => [
          healthIndicatorLabels[row.key],
          indicatorStateLabels[row.state],
        ]),
      ),
      "Latest assessment": last
        ? `${label(last.labelId)} · ${last.assessedOn}`
        : "None recorded",
      "Review due": last
        ? last.reviewOn <= today
          ? `Due ${last.reviewOn}`
          : last.reviewOn
        : "",
    };
  });
  const keys = Object.keys(tableRows[0] || {}).filter((key) => key !== "id");
  return (
    <>
      <MessageBar intent="info">
        Indicators restate recorded facts for pastoral review. They do not
        describe anyone's spiritual condition and never change membership or
        start discipline. Assessments are the Session's own dated judgments.
      </MessageBar>
      {(error || report.error || assessments.error) && (
        <MessageBar intent="error">
          {error || report.error || assessments.error}
        </MessageBar>
      )}
      <div className="report-filters">
        <Picker
          label="Elder district"
          value={filter.district}
          choices={data.districts
            .filter((row) => !row.archived)
            .map((row) => ({ id: row.id, name: row.name }))}
          onChange={(district) => setFilter({ ...filter, district })}
          empty="All districts"
        />
        <Picker
          label="Show"
          value={filter.concern}
          choices={[
            { id: "below", name: "Any indicator below policy" },
            { id: "review", name: "Assessment review due" },
          ]}
          onChange={(concern) => setFilter({ ...filter, concern })}
          empty="Everyone on the roll"
        />
        <Button disabled={!settings} onClick={() => setEditing("settings")}>
          Health settings
        </Button>
        {settings && !settings.labels.length && (
          <Button
            onClick={() =>
              void saveHealthSettings({
                expectedRevision: settings.revision,
                indicators: settings.indicators,
                attendanceWeeks: settings.attendanceWeeks,
                attendanceBelowPercent: settings.attendanceBelowPercent,
                visitWithinDays: settings.visitWithinDays,
                labels: SUGGESTED_ASSESSMENT_LABELS,
              })
            }
          >
            Adopt suggested labels: Healthy, Weak, Stray, Lost
          </Button>
        )}
      </div>
      <section className="surface table-card communication-panel session-panel">
        <div className="section-heading">
          <span>
            {tableRows.length} {tableRows.length === 1 ? "person" : "people"}
            {!ready && " · Loading"}
          </span>
          <ExportButton rows={tableRows} />
        </div>
        {!tableRows.length ? (
          <p>No people match this view.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {keys.map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={String(row.id)}>
                    {keys.map((key, column) => (
                      <td key={key}>
                        {column === 0 ? (
                          <Button
                            appearance="transparent"
                            onClick={() => setOpen(String(row.id))}
                          >
                            {row[key]}
                          </Button>
                        ) : (
                          row[key]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && ready && (
        <Dialog open onOpenChange={(_, value) => !value.open && setOpen(null)}>
          <DialogSurface className="record-dialog">
            <DialogBody>
              <DialogTitle>{name(open)} · Session only</DialogTitle>
              <DialogContent>
                <Records
                  rows={indicators(open).map((row) => ({
                    id: row.key,
                    Indicator: healthIndicatorLabels[row.key],
                    State: indicatorStateLabels[row.state],
                    "Recorded facts": row.explanation,
                  }))}
                />
                <Records
                  rows={assessments.rows
                    .filter((row) => row.personId === open)
                    .sort((a, b) => b.assessedOn.localeCompare(a.assessedOn))
                    .map((row) => ({
                      id: row.id,
                      Assessed: row.assessedOn,
                      Label: label(row.labelId),
                      Reasons: row.reasons,
                      By: user(row.authorUid),
                      "Review on": row.reviewOn,
                    }))}
                  choose={(index) => {
                    const row = assessments.rows
                      .filter((item) => item.personId === open)
                      .sort((a, b) => b.assessedOn.localeCompare(a.assessedOn))[
                      index
                    ];
                    setEditing({ assessment: row });
                    setOpen(null);
                  }}
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setOpen(null)}>Close</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setEditing({ assessment: { personId: open } });
                    setOpen(null);
                  }}
                >
                  Record assessment
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {editing === "settings" && settings && (
        <RecordEditor
          title="Flock health settings · Session only"
          fields={[
            {
              key: "indicators",
              label: "Show these indicators",
              kind: "multi",
              options: healthIndicatorKeys.map((id) => ({
                id,
                name: healthIndicatorLabels[id],
              })),
            },
            {
              key: "attendanceWeeks",
              label: "Attendance period in weeks",
              kind: "number",
            },
            {
              key: "attendanceBelowPercent",
              label: "Attendance policy: at least this percent",
              kind: "number",
            },
            {
              key: "visitWithinDays",
              label: "Household visit policy: within this many days",
              kind: "number",
            },
            {
              key: "labels",
              label: "Assessment labels, one per line (blank for none)",
              kind: "textarea",
            },
          ]}
          initial={{
            ...settings,
            labels: settings.labels.map((row) => row.name).join("\n"),
          }}
          save={(value) => {
            const names = String(value.labels || "")
              .split("\n")
              .map((row) => row.trim())
              .filter(Boolean);
            return saveHealthSettings({
              expectedRevision: settings.revision,
              indicators: value.indicators,
              attendanceWeeks: Number(value.attendanceWeeks),
              attendanceBelowPercent: Number(value.attendanceBelowPercent),
              visitWithinDays: Number(value.visitWithinDays),
              // Existing labels keep their IDs so past assessments still read correctly.
              labels: names.map((labelName, index) => ({
                id:
                  settings.labels.find((row) => row.name === labelName)?.id ||
                  `${
                    labelName
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "") || "label"
                  }-${index + 1}`,
                name: labelName,
              })),
            });
          }}
          close={() => setEditing(null)}
        />
      )}
      {editing && editing !== "settings" && (
        <RecordEditor
          title={`Session only assessment for ${name(editing.assessment.personId)}`}
          fields={[
            {
              key: "labelId",
              label: "Label",
              kind: "select",
              options: [
                { id: "", name: "No label" },
                ...(settings?.labels || []),
              ].filter((row) => row.id),
            },
            {
              key: "reasons",
              label: "Reasons · Session only",
              kind: "textarea",
              required: true,
            },
            {
              key: "assessedOn",
              label: "Assessment date",
              kind: "date",
              required: true,
            },
            {
              key: "reviewOn",
              label: "Review on",
              kind: "date",
              required: true,
            },
          ]}
          initial={{
            id: editing.assessment.id || crypto.randomUUID(),
            expectedRevision: editing.assessment.revision || 0,
            labelId: editing.assessment.labelId || "",
            reasons: editing.assessment.reasons || "",
            assessedOn: editing.assessment.assessedOn || today,
            reviewOn:
              editing.assessment.reviewOn ||
              DateTime.fromISO(today).plus({ months: 6 }).toISODate()!,
          }}
          save={(value) =>
            saveAssessment({ ...value, personId: editing.assessment.personId })
          }
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
