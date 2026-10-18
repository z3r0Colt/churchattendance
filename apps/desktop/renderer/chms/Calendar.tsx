import { useState } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  Title3,
  Subtitle2,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  EDITOR_ROLES,
  eventOccurrences,
  hasRole,
  localSchedule,
  type Role,
  type ChurchEvent,
  type Occurrence,
} from "@sycamore/shared";
import {
  churchLocalInput,
  recordRsvp,
  saveChurchEvent,
  usePublicChms,
  useRsvps,
} from "../data/chms";
import {
  Picker,
  Records,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";
export function Calendar({ roles }: { roles: Role[] }) {
  const data = usePublicChms();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [editing, setEditing] = useState<ChurchEvent | "new" | null>(null);
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState("yes");
  const [error, setError] = useState("");
  const editable = hasRole(roles, [...EDITOR_ROLES, "deacon"]);
  const first =
      from || DateTime.now().setZone(data.zone).startOf("month").toISODate()!,
    last =
      to ||
      DateTime.fromISO(first).plus({ months: 1 }).endOf("month").toISODate()!;
  const occurrences = data.events
    .flatMap((event) => eventOccurrences(event, first, last, data.zone))
    .sort((a, b) => a.start.localeCompare(b.start));
  const responses = useRsvps(selected?.eventId || "");
  const visible = responses.rows.filter((row) => row.date === selected?.date);
  const choices = data.people
    .filter((row) => !row.isDeceased && row.membershipStatus !== "former")
    .map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
  const fields: EditorField[] = [
    { key: "title", label: "Event title", required: true },
    {
      key: "start",
      label: `Starts, ${data.zone}`,
      kind: "datetime-local",
      required: true,
    },
    {
      key: "end",
      label: `Ends, ${data.zone}`,
      kind: "datetime-local",
      required: true,
    },
    { key: "location", label: "Location" },
    {
      key: "recurrence",
      label: "Repeats",
      kind: "select",
      options: [
        { id: "none", name: "Once" },
        { id: "weekly", name: "Weekly" },
        { id: "monthly", name: "Monthly" },
      ],
    },
    { key: "interval", label: "Repeat every", kind: "number" },
    { key: "until", label: "Final recurrence date", kind: "date" },
    {
      key: "capacity",
      label: "Registration limit, 0 for unlimited",
      kind: "number",
    },
    { key: "cancelled", label: "Cancelled", kind: "checkbox" },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CHURCH CALENDAR</span>
          <Title3 as="h1">Calendar & events</Title3>
          <p>Recurring gatherings and registration for each occurrence.</p>
        </div>
        {editable && (
          <Button appearance="primary" onClick={() => setEditing("new")}>
            Add event
          </Button>
        )}
      </div>
      {(error || data.error || responses.error) && (
        <MessageBar intent="error">
          {error || data.error || responses.error}
        </MessageBar>
      )}
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
        rows={occurrences.map((row) => ({
          id: row.id,
          Event: row.title,
          Starts: DateTime.fromISO(row.start)
            .setZone(data.zone)
            .toFormat("LLL d, yyyy h:mm a"),
          Ends: DateTime.fromISO(row.end).setZone(data.zone).toFormat("h:mm a"),
          Location: row.location,
        }))}
        choose={(index) => setSelected(occurrences[index])}
      />
      {selected && (
        <section className="surface communication-panel">
          <div className="section-heading">
            <Subtitle2>
              {selected.title} · {selected.date}
            </Subtitle2>
            {editable && (
              <Button
                onClick={() =>
                  setEditing(
                    data.events.find((row) => row.id === selected.eventId)!,
                  )
                }
              >
                Edit event series
              </Button>
            )}
          </div>
          <p>
            {visible.filter((row) => row.status === "yes").length} registered
            {selected.capacity ? ` of ${selected.capacity}` : ""}. Changes to an
            event series apply to all its occurrences. Existing RSVPs keep their
            original dates.
          </p>
          {editable && (
            <div className="report-filters">
              <Picker
                label="Register person"
                value={person}
                choices={choices}
                onChange={setPerson}
              />
              <Picker
                label="Response"
                value={status}
                choices={[
                  { id: "yes", name: "Attending" },
                  { id: "maybe", name: "Maybe" },
                  { id: "no", name: "Not attending" },
                ]}
                onChange={setStatus}
              />
              <Button
                disabled={!person || !status}
                onClick={() =>
                  void recordRsvp({
                    eventId: selected.eventId,
                    date: selected.date,
                    personId: person,
                    status,
                  }).catch((error) => setError(friendlyError(error)))
                }
              >
                Save RSVP
              </Button>
            </div>
          )}
          <Records
            rows={visible.map((row) => ({
              id: row.id,
              Name:
                choices.find((person) => person.id === row.personId)?.name ||
                row.personId,
              Response: row.status,
            }))}
          />
        </section>
      )}
      {editing && (
        <RecordEditor
          title={editing === "new" ? "Add event" : "Edit event series"}
          fields={fields}
          initial={
            editing === "new"
              ? {
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  title: "",
                  start: `${first}T18:00`,
                  end: `${first}T19:00`,
                  location: "",
                  recurrence: "none",
                  interval: 1,
                  until: "",
                  capacity: 0,
                  cancelled: false,
                }
              : {
                  ...editing,
                  expectedRevision: editing.revision || 0,
                  start: churchLocalInput(editing.start, data.zone),
                  end: churchLocalInput(editing.end, data.zone),
                }
          }
          save={(value) =>
            saveChurchEvent({
              ...value,
              start: localSchedule(String(value.start), data.zone),
              end: localSchedule(String(value.end), data.zone),
            })
          }
          close={() => setEditing(null)}
        />
      )}
      <details>
        <summary>Event series, including cancelled events</summary>
        <Records
          rows={data.events.map((row) => ({
            id: row.id,
            Event: row.title,
            Repeats: row.recurrence,
            Status: row.cancelled ? "Cancelled" : "Active",
          }))}
          choose={
            editable ? (index) => setEditing(data.events[index]) : undefined
          }
        />
      </details>
    </>
  );
}
