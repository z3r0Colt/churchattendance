import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  Tab,
  TabList,
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
  type CalendarFeed,
  type ChurchEvent,
  type Occurrence,
} from "@sycamore/shared";
import {
  changeEventOccurrence,
  churchLocalInput,
  createStaffCalendarFeed,
  recordRsvp,
  revokeStaffCalendarFeed,
  staffCalendarFeeds,
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
import { EventReminders } from "./EventReminders";
import { MonthGrid } from "./MonthGrid";
export function Calendar({ roles }: { roles: Role[] }) {
  const data = usePublicChms();
  const [view, setView] = useState("month");
  const [month, setMonth] = useState(() =>
    DateTime.now().startOf("month").toISODate()!,
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Occurrence | null>(null);
  const [changing, setChanging] = useState<Occurrence | null>(null);
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
  // Cancelled dates stay listed so they can be restored.
  const occurrences = data.events
    .flatMap((event) =>
      eventOccurrences(event, first, last, data.zone, {
        includeCancelled: true,
      }),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const selected =
    occurrences.find((row) => row.id === picked?.id) ?? picked ?? null;
  const series = data.events.find((row) => row.id === selected?.eventId);
  async function change(occurrence: Occurrence, action: "cancel" | "restore") {
    setError("");
    try {
      await changeEventOccurrence({
        eventId: occurrence.eventId,
        date: occurrence.date,
        expectedRevision: occurrence.revision,
        action,
      });
    } catch (failure) {
      setError(friendlyError(failure));
    }
  }
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
          <span className="eyebrow">THE CHURCH CALENDAR</span>
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
      <TabList
        selectedValue={view}
        onTabSelect={(_, value) => setView(String(value.value))}
      >
        <Tab value="month">Month</Tab>
        <Tab value="list">List</Tab>
      </TabList>
      {view === "month" && (
        <MonthGrid
          events={data.events}
          zone={data.zone}
          month={month}
          setMonth={setMonth}
          selectedId={selected?.id || ""}
          choose={setPicked}
        />
      )}
      {view === "list" && (
        <>
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
              Ends: DateTime.fromISO(row.end)
                .setZone(data.zone)
                .toFormat("h:mm a"),
              Location: row.location,
              Status: row.cancelled
                ? "Cancelled"
                : row.changed
                  ? "Changed for this date"
                  : "As scheduled",
            }))}
            choose={(index) => setPicked(occurrences[index])}
            empty="No gatherings in these dates."
          />
        </>
      )}
      {selected && (
        <section
          className="surface communication-panel occurrence-panel"
          aria-label="Selected date"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {DateTime.fromISO(selected.start)
                  .setZone(data.zone)
                  .toFormat("cccc, LLLL d · h:mm a")
                  .replace(/^Sunday/, "Lord's Day")}
              </span>
              <Subtitle2 as="h2">{selected.title}</Subtitle2>
            </div>
            {editable && series && !series.cancelled && (
              <div className="actions">
                {selected.cancelled || selected.changed ? (
                  <Button onClick={() => void change(selected, "restore")}>
                    Restore this date
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => setChanging(selected)}>
                      Change this date
                    </Button>
                    <Button onClick={() => void change(selected, "cancel")}>
                      Cancel this date
                    </Button>
                  </>
                )}
              </div>
            )}
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
          {selected.cancelled && (
            <MessageBar intent="warning">
              This date is cancelled. Calendar subscribers see it as cancelled.
            </MessageBar>
          )}
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
          {series && hasRole(roles, EDITOR_ROLES) && (
            <EventReminders
              key={series.id}
              event={series}
              groups={data.groups}
            />
          )}
          <Records
            empty="No responses for this date yet."
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
      {changing && (
        <RecordEditor
          title={`Change ${changing.title} on ${changing.date}`}
          fields={[
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
          ]}
          initial={{
            start: churchLocalInput(changing.start, data.zone),
            end: churchLocalInput(changing.end, data.zone),
            location: changing.location,
          }}
          save={(value) =>
            changeEventOccurrence({
              eventId: changing.eventId,
              date: changing.date,
              expectedRevision: changing.revision,
              action: "reschedule",
              start: localSchedule(String(value.start), data.zone),
              end: localSchedule(String(value.end), data.zone),
              location: String(value.location || ""),
            })
          }
          close={() => setChanging(null)}
        />
      )}
      <StaffSubscriptions />
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

// A private calendar link for this staff account: all church events and the
// account's own serving dates. Care visits are never included.
function StaffSubscriptions() {
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [created, setCreated] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const refresh = () =>
    staffCalendarFeeds()
      .then(setFeeds)
      .catch((failure) => setError(friendlyError(failure)));
  useEffect(() => {
    void refresh();
  }, []);
  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(friendlyError(failure));
    }
  }
  return (
    <section className="surface communication-panel">
      <div className="section-heading">
        <Subtitle2>My calendar link</Subtitle2>
      </div>
      <p>
        Subscribe in Outlook or another calendar app to see church events and
        your serving dates. The link works for one year and can be stopped here.
        Anyone with the link can see these dates.
      </p>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <div className="report-filters">
        <Field label="Name this link">
          <Input
            value={label}
            maxLength={60}
            onChange={(_, row) => setLabel(row.value)}
          />
        </Field>
        <Button
          disabled={!label.trim()}
          onClick={() =>
            void run(async () => {
              setCreated((await createStaffCalendarFeed(label.trim())).url);
              setLabel("");
            })
          }
        >
          Create calendar link
        </Button>
      </div>
      {created && (
        <MessageBar intent="success" layout="multiline">
          Copy this link into your calendar app now. It is shown only once:{" "}
          <code className="feed-url">{created}</code>
        </MessageBar>
      )}
      <Records
        empty="No calendar links yet."
        rows={feeds.map((feed) => ({
          id: feed.id,
          Name: feed.label,
          Created: feed.createdAt.slice(0, 10),
          "Works until": feed.expiresAt.slice(0, 10),
          "Last used": feed.lastUsedAt.slice(0, 10) || "Not yet",
        }))}
        choose={(index) =>
          void run(async () => {
            await revokeStaffCalendarFeed(feeds[index].id);
            setCreated("");
          })
        }
      />
      {feeds.length > 0 && (
        <p className="muted">Choose a link name to stop that link.</p>
      )}
    </section>
  );
}
