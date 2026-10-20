import { useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Title3,
  Subtitle2,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import { EDITOR_ROLES, hasRole, type Role, type Group } from "@sycamore/shared";
import {
  markGroupAttendance,
  saveGroup,
  useGroupMeetings,
  usePublicChms,
} from "../data/chms";
import { ExportButton } from "../components/ExportButton";
import {
  Records,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";
export function Groups({
  roles,
  message,
}: {
  roles: Role[];
  message: (id: string) => void;
}) {
  const data = usePublicChms();
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const group = data.groups.find((row) => row.id === selected);
  const meetings = useGroupMeetings(selected);
  const day = date || DateTime.now().setZone(data.zone).toISODate()!;
  const present = meetings.rows.find((row) => row.date === day)?.present || {};
  const editable = hasRole(roles, [...EDITOR_ROLES, "deacon"]);
  const active = data.people.filter(
    (row) => !row.isDeceased && row.membershipStatus !== "former",
  );
  const people = active.map((row) => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`,
  }));
  const members = active.filter((row) => group?.memberIds.includes(row.id));
  const fields: EditorField[] = [
    { key: "name", label: "Group name", required: true },
    {
      key: "type",
      label: "Type",
      kind: "select",
      options: [
        "smallGroup",
        "class",
        "choir",
        "committee",
        "diaconate",
        "session",
      ].map((id) => ({
        id,
        name: {
          smallGroup: "Small group",
          class: "Sabbath School class",
          choir: "Choir",
          committee: "Committee",
          diaconate: "Diaconate",
          session: "Session",
        }[id]!,
      })),
    },
    { key: "leaderPersonId", label: "Leader", kind: "select", options: people },
    { key: "schedule", label: "Meeting schedule" },
    { key: "memberIds", label: "Members", kind: "multi", options: people },
    { key: "archived", label: "Archived", kind: "checkbox" },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LIFE TOGETHER</span>
          <Title3 as="h1">Groups</Title3>
          <p>Members, meeting schedules and attendance by name.</p>
        </div>
        {editable && (
          <Button appearance="primary" onClick={() => setEditing("new")}>
            Add group
          </Button>
        )}
      </div>
      {(error || data.error || meetings.error) && (
        <MessageBar intent="error">
          {error || data.error || meetings.error}
        </MessageBar>
      )}
      <Records
        label="Groups"
        rows={data.groups.map((row) => ({
          id: row.id,
          Name: row.name,
          Type: row.type,
          Schedule: row.schedule,
          Members: row.memberIds.length,
          Status: row.archived ? "Archived" : "Active",
        }))}
        choose={(index) => setSelected(data.groups[index].id)}
      />
      {group && (
        <section className="surface communication-panel">
          <div className="section-heading">
            <Subtitle2>{group.name}</Subtitle2>
            <div className="actions">
              {editable && (
                <Button onClick={() => setEditing(group)}>Edit group</Button>
              )}
              {hasRole(roles, EDITOR_ROLES) && (
                <Button onClick={() => message(group.id)}>
                  Message this group
                </Button>
              )}
            </div>
          </div>
          <p>{group.schedule || "No meeting schedule recorded."}</p>
          <Field label="Meeting date">
            <Input
              type="date"
              value={day}
              onChange={(_, value) => setDate(value.value)}
            />
          </Field>
          <div className="section-heading">
            <strong>{Object.keys(present).length} present</strong>
            <ExportButton
              rows={members.map((row) => ({
                Name: `${row.firstName} ${row.lastName}`,
                Date: day,
                Present: present[row.id] ? "Yes" : "No",
              }))}
            />
          </div>
          <div className="group-roll">
            {members.map((row) => (
              <Checkbox
                key={row.id}
                label={`${row.firstName} ${row.lastName}`}
                checked={
                  optimistic[`${group.id}_${day}_${row.id}`] ??
                  !!present[row.id]
                }
                disabled={!editable || group.archived || busy === row.id}
                onChange={(_, value) => {
                  setBusy(row.id);
                  const key = `${group.id}_${day}_${row.id}`;
                  setOptimistic((before) => ({
                    ...before,
                    [key]: value.checked === true,
                  }));
                  void markGroupAttendance({
                    groupId: group.id,
                    date: day,
                    personId: row.id,
                    present: value.checked === true,
                  })
                    .catch((error) => setError(friendlyError(error)))
                    .finally(() => {
                      setBusy("");
                      setOptimistic((before) => {
                        const next = { ...before };
                        delete next[key];
                        return next;
                      });
                    });
                }}
              />
            ))}
          </div>
          <Records
            label="Meetings"
            rows={meetings.rows
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((row) => ({
                Date: row.date,
                Present: Object.keys(row.present || {}).length,
              }))}
          />
        </section>
      )}
      {editing && (
        <RecordEditor
          title={editing === "new" ? "Add group" : "Edit group"}
          fields={fields}
          initial={
            editing === "new"
              ? {
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  name: "",
                  type: "smallGroup",
                  leaderPersonId: "",
                  memberIds: [],
                  schedule: "",
                  archived: false,
                }
              : { ...editing, expectedRevision: editing.revision || 0 }
          }
          save={saveGroup}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
