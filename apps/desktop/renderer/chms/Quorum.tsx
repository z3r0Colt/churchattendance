import { useState } from "react";
import { Button, MessageBar } from "@fluentui/react-components";
import {
  meetingTypeLabels,
  meetingTypes,
  membershipAt,
  membershipStatuses,
  officeRoleLabels,
  officeRoles,
  policyOn,
  quorumReport,
  statusLabels,
  type QuorumMeeting,
  type QuorumPolicy,
} from "@sycamore/shared";
import {
  saveQuorumMeeting,
  saveQuorumPolicy,
  type OfficerData,
} from "../data/records";
import { ActionTable, RecordEditor } from "./Common";

const entryLabels = {
  included: "Counted",
  excluded: "Not counted",
  unknown: "Needs review",
};
export function Quorum({
  data,
  today,
  name,
}: {
  data: OfficerData;
  today: string;
  name: (id: string) => string;
}) {
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [meeting, setMeeting] = useState<Record<string, unknown> | null>(null);
  const [openId, setOpenId] = useState("");
  const report = (
    row: Pick<QuorumMeeting, "meetingType" | "date" | "presentPersonIds">,
  ) =>
    quorumReport({
      policy: policyOn(data.quorumPolicies, row.meetingType, row.date),
      meeting: row,
      people: data.people,
      offices: data.offices,
      statusOn: (person, date) => membershipAt(person, data.history, date),
      disciplinedOn: data.disciplinedOn,
    });
  const meetings = [...data.meetings].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const policies = [...data.quorumPolicies].sort(
    (a, b) =>
      a.meetingType.localeCompare(b.meetingType) ||
      b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const outcome = (result: ReturnType<typeof report>) =>
    !result
      ? "No rule adopted"
      : result.met === null
        ? "Depends on records to review"
        : result.met
          ? "Quorum met"
          : "Quorum not met";
  const opened = meetings.find((row) => row.id === openId);
  const detail = opened ? report(opened) : null;
  const people = [...data.people]
    .filter((row) => !row.isDeceased && row.membershipStatus !== "former")
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
    .map((row) => ({
      id: row.id,
      name: `${row.lastName}, ${row.preferredName || row.firstName}`,
    }));
  return (
    <>
      <p className="muted">
        Quorum is calculated from the rule the Session adopted for that meeting
        type and date, and from each person's recorded history on that date. The
        app does not supply denominational rules.
      </p>
      <div className="section-heading">
        <h2>Adopted rules</h2>
        <Button
          onClick={() =>
            setPolicy({
              id: crypto.randomUUID(),
              expectedRevision: 0,
              meetingType: "session",
              effectiveFrom: today,
              electorate: "officers",
              offices: ["pastor", "elder"],
              includeEmeritus: false,
              statuses: [],
              minimumAge: 0,
              excludeUnderDiscipline: false,
              minimumCount: 0,
              percent: 0,
              source: "",
            })
          }
        >
          Add quorum rule
        </Button>
      </div>
      <ActionTable
        session
        empty="No quorum rules yet. Add the rule your Session follows, with its source."
        rows={policies.map((row) => ({
          id: row.id,
          Meeting: meetingTypeLabels[row.meetingType],
          "Effective from": row.effectiveFrom,
          Electorate:
            row.electorate === "officers"
              ? `${row.offices.map((id) => officeRoleLabels[id]).join(", ")} serving${row.includeEmeritus ? " and emeritus" : ""}`
              : `${row.statuses.map((id) => statusLabels[id]).join(", ")}${row.minimumAge ? `, ${row.minimumAge} or older` : ""}${row.excludeUnderDiscipline ? ", not under discipline" : ""}`,
          Required: [
            row.minimumCount ? `at least ${row.minimumCount}` : "",
            row.percent ? `${row.percent}%` : "",
          ]
            .filter(Boolean)
            .join(" and "),
          Source: row.source,
        }))}
        actions={(index) => (
          <Button
            size="small"
            onClick={() =>
              setPolicy({
                ...policies[index],
                expectedRevision: policies[index].revision,
              })
            }
          >
            Edit
          </Button>
        )}
      />
      <div className="section-heading">
        <h2>Meetings</h2>
        <Button
          appearance="primary"
          onClick={() =>
            setMeeting({
              id: crypto.randomUUID(),
              expectedRevision: 0,
              meetingType: "session",
              date: today,
              title: "",
              presentPersonIds: [],
            })
          }
        >
          Record a meeting
        </Button>
      </div>
      <ActionTable
        session
        empty="No meetings recorded yet."
        rows={meetings.map((row) => {
          const result = report(row);
          return {
            id: row.id,
            Meeting: row.title,
            Date: row.date,
            Type: meetingTypeLabels[row.meetingType],
            Present: row.presentPersonIds.length,
            State: outcome(result),
          };
        })}
        actions={(index) => (
          <>
            <Button size="small" onClick={() => setOpenId(meetings[index].id)}>
              Show calculation
            </Button>
            <Button
              size="small"
              onClick={() =>
                setMeeting({
                  ...meetings[index],
                  expectedRevision: meetings[index].revision,
                })
              }
            >
              Edit
            </Button>
          </>
        )}
      />
      {opened && (
        <section
          className="surface communication-panel session-panel"
          aria-label="Quorum calculation"
        >
          <div className="section-heading">
            <h2>
              {opened.title} · {opened.date}
            </h2>
            <Button onClick={() => setOpenId("")}>Close</Button>
          </div>
          {!detail ? (
            <MessageBar intent="warning">
              No {meetingTypeLabels[opened.meetingType].toLowerCase()} rule was
              in effect on this date. Add the rule the Session followed.
            </MessageBar>
          ) : (
            <>
              <p>
                <strong>{outcome(detail)}.</strong> Rule effective{" "}
                {detail.policy.effectiveFrom} ({detail.policy.source}).
                Electorate {detail.electorate}: {detail.calculation}
              </p>
              {!!detail.presentOutside.length && (
                <p className="muted">
                  Also present but not in the electorate:{" "}
                  {detail.presentOutside.map(name).join(", ")}.
                </p>
              )}
            </>
          )}
        </section>
      )}
      {opened && detail && (
        <ActionTable
          session
          empty="No one was considered for this electorate."
          rows={detail.entries.map((row) => ({
            id: row.personId,
            Name: name(row.personId),
            State: entryLabels[row.state],
            Reason: row.reason,
            Present: opened.presentPersonIds.includes(row.personId)
              ? "Yes"
              : "",
          }))}
        />
      )}
      {policy && (
        <RecordEditor
          title="Quorum rule · Session only"
          fields={[
            {
              key: "meetingType",
              label: "Meeting",
              kind: "select",
              required: true,
              options: meetingTypes.map((id) => ({
                id,
                name: meetingTypeLabels[id],
              })),
            },
            { key: "effectiveFrom", label: "Effective from", kind: "date" },
            {
              key: "electorate",
              label: "Electorate",
              kind: "select",
              required: true,
              options: [
                { id: "officers", name: "Serving officers" },
                { id: "members", name: "Members by status" },
              ],
            },
            {
              key: "offices",
              label: "Offices counted (officer electorate)",
              kind: "multi",
              options: officeRoles.map((id) => ({
                id,
                name: officeRoleLabels[id],
              })),
            },
            {
              key: "includeEmeritus",
              label: "Count emeritus officers",
              kind: "checkbox",
            },
            {
              key: "statuses",
              label: "Statuses counted (member electorate)",
              kind: "multi",
              options: membershipStatuses
                .filter((id) => id !== "former")
                .map((id) => ({ id, name: statusLabels[id] })),
            },
            {
              key: "minimumAge",
              label: "Minimum age (0 for none)",
              kind: "number",
            },
            {
              key: "excludeUnderDiscipline",
              label: "Leave out people under discipline",
              kind: "checkbox",
            },
            {
              key: "minimumCount",
              label: "At least this many present (0 for none)",
              kind: "number",
            },
            {
              key: "percent",
              label: "Percent of the electorate, rounded up (0 for none)",
              kind: "number",
            },
            {
              key: "source",
              label: "Source of this rule",
              required: true,
            },
          ]}
          initial={policy}
          save={saveQuorumPolicy}
          close={() => setPolicy(null)}
        />
      )}
      {meeting && (
        <RecordEditor
          title="Meeting · Session only"
          fields={[
            { key: "title", label: "Meeting name", required: true },
            {
              key: "meetingType",
              label: "Meeting type",
              kind: "select",
              required: true,
              options: meetingTypes.map((id) => ({
                id,
                name: meetingTypeLabels[id],
              })),
            },
            { key: "date", label: "Date", kind: "date" },
            {
              key: "presentPersonIds",
              label: "Present",
              kind: "multi",
              options: people,
            },
          ]}
          initial={meeting}
          preview={(value) => {
            const result = report({
              meetingType: value.meetingType as QuorumPolicy["meetingType"],
              date: String(value.date || today),
              presentPersonIds: (value.presentPersonIds as string[]) || [],
            });
            return result
              ? `${outcome(result)}. ${result.calculation}`
              : "No rule is in effect for this meeting type on this date.";
          }}
          save={saveQuorumMeeting}
          close={() => setMeeting(null)}
        />
      )}
    </>
  );
}
