import { useState } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  Title3,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  EDITOR_ROLES,
  hasRole,
  type Role,
  type Serving as Assignment,
} from "@sycamore/shared";
import { saveServingAssignment, usePublicChms } from "../data/chms";
import { Records, RecordEditor, type EditorField } from "./Common";
export function Serving({ roles }: { roles: Role[] }) {
  const data = usePublicChms();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<Assignment | "new" | null>(null);
  const editable = hasRole(roles, [...EDITOR_ROLES, "deacon"]);
  const first = from || DateTime.now().setZone(data.zone).toISODate()!,
    last = to || DateTime.fromISO(first).plus({ months: 2 }).toISODate()!;
  const assignments = data.serving
    .filter((row) => row.date >= first && row.date <= last)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const people = data.people
    .filter((row) => !row.isDeceased && row.membershipStatus !== "former")
    .map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
  const fields: EditorField[] = [
    { key: "role", label: "Serving role", required: true },
    { key: "date", label: "Date", kind: "date", required: true },
    { key: "time", label: `Time, ${data.zone}`, kind: "time", required: true },
    {
      key: "personId",
      label: "Person, blank for a gap",
      kind: "select",
      options: people,
    },
    { key: "location", label: "Location" },
    {
      key: "reminderHours",
      label: "Remind this many hours before",
      kind: "number",
    },
    { key: "cancelled", label: "Cancelled", kind: "checkbox" },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SERVE ONE ANOTHER</span>
          <Title3 as="h1">Serving schedule</Title3>
          <p>Fill open roles and send consented reminder texts.</p>
        </div>
        {editable && (
          <Button appearance="primary" onClick={() => setEditing("new")}>
            Add assignment
          </Button>
        )}
      </div>
      {data.error && <MessageBar intent="error">{data.error}</MessageBar>}
      <MessageBar intent="info">
        Reminders use recorded text consent. Changed or cancelled assignments
        stop their old queued reminders. An empty person marks a serving gap.
      </MessageBar>
      <div className="report-filters">
        <Field label="From">
          <Input
            type="date"
            value={first}
            onChange={(_, row) => setFrom(row.value)}
          />
        </Field>
        <Field label="Through">
          <Input
            type="date"
            value={last}
            onChange={(_, row) => setTo(row.value)}
          />
        </Field>
      </div>
      <Records
        label="Serving assignments"
        rows={assignments.map((row) => ({
          id: row.id,
          Role: row.role,
          Date: row.date,
          Time: DateTime.fromFormat(row.time, "HH:mm").toFormat("h:mm a"),
          Person:
            people.find((person) => person.id === row.personId)?.name ||
            "Unfilled",
          Location: row.location,
          Status: row.cancelled
            ? "Cancelled"
            : !row.personId
              ? "Needs a volunteer"
              : "Assigned",
        }))}
        choose={
          editable ? (index) => setEditing(assignments[index]) : undefined
        }
      />
      {editing && (
        <RecordEditor
          title={editing === "new" ? "Add assignment" : "Edit assignment"}
          fields={fields}
          initial={
            editing === "new"
              ? {
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  role: "",
                  date: first,
                  time: "10:30",
                  personId: "",
                  location: "",
                  reminderHours: 24,
                  cancelled: false,
                }
              : { ...editing, expectedRevision: editing.revision || 0 }
          }
          save={saveServingAssignment}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
