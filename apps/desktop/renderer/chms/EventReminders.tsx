import { useState } from "react";
import {
  Button,
  Field,
  MessageBar,
  Select,
  Subtitle2,
} from "@fluentui/react-components";
import {
  reminderAudienceLabels,
  reminderAudiences,
  reminderLeadLabels,
  reminderLeadMinutes,
  type ChurchEvent,
  type EventReminder,
  type Group,
} from "@sycamore/shared";
import { saveEventReminders } from "../data/chms";
import { friendlyError } from "./Common";

// Reminders belong to the whole series and go out for each of its dates.
export function EventReminders({
  event,
  groups,
}: {
  event: ChurchEvent;
  groups: Group[];
}) {
  const [rows, setRows] = useState<EventReminder[]>(event.reminders ?? []);
  const [revision, setRevision] = useState(event.revision);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const active = groups.filter((group) => !group.archived);
  const update = (index: number, change: Partial<EventReminder>) =>
    setRows((before) =>
      before.map((row, position) =>
        position === index ? { ...row, ...change } : row,
      ),
    );
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveEventReminders({
        eventId: event.id,
        expectedRevision: revision,
        reminders: rows,
      });
      setRevision(revision + 1);
      setNotice("Reminders saved for every date of this event.");
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reminder-panel">
      <Subtitle2>Reminders for this event</Subtitle2>
      {event.revision !== revision && (
        <MessageBar intent="warning">
          This event changed. Reload its reminders before saving.
          <Button
            onClick={() => {
              setRows(event.reminders ?? []);
              setRevision(event.revision);
              setNotice("");
            }}
          >
            Reload reminders
          </Button>
        </MessageBar>
      )}
      <p className="muted">
        Sent before each date to people who have chosen to receive church email
        or texts. A changed or cancelled date stops reminders that have not gone
        out yet.
      </p>
      {rows.map((row, index) => (
        <div className="report-filters" key={row.id}>
          <Field label={`Reminder ${index + 1} timing`}>
            <Select
              value={String(row.minutesBefore)}
              onChange={(_, value) =>
                update(index, { minutesBefore: Number(value.value) })
              }
            >
              {reminderLeadMinutes.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {reminderLeadLabels[minutes]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Reminder ${index + 1} sent by`}>
            <Select
              value={row.channel}
              onChange={(_, value) =>
                update(index, {
                  channel: value.value as EventReminder["channel"],
                })
              }
            >
              <option value="email">Email</option>
              <option value="sms">Text</option>
              <option value="both">Email and text</option>
            </Select>
          </Field>
          <Field label={`Reminder ${index + 1} goes to`}>
            <Select
              value={row.audience}
              onChange={(_, value) =>
                update(index, {
                  audience: value.value as EventReminder["audience"],
                  groupId: value.value === "group" ? active[0]?.id || "" : "",
                })
              }
            >
              {reminderAudiences.map((audience) => (
                <option key={audience} value={audience}>
                  {reminderAudienceLabels[audience]}
                </option>
              ))}
            </Select>
          </Field>
          {row.audience === "group" && (
            <Field label={`Reminder ${index + 1} group`}>
              <Select
                value={row.groupId}
                onChange={(_, value) => update(index, { groupId: value.value })}
              >
                {active.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button
            onClick={() =>
              setRows((before) =>
                before.filter((_, position) => position !== index),
              )
            }
          >
            Remove reminder {index + 1}
          </Button>
        </div>
      ))}
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <div className="actions">
        <Button
          disabled={rows.length >= 3}
          onClick={() =>
            setRows((before) => [
              ...before,
              {
                id: Math.random().toString(36).slice(2, 10),
                minutesBefore: 1440,
                channel: "email",
                audience: "attending",
                groupId: "",
              },
            ])
          }
        >
          Add reminder
        </Button>
        <Button
          appearance="primary"
          disabled={busy}
          onClick={() => void save()}
        >
          Save reminders
        </Button>
      </div>
    </section>
  );
}
