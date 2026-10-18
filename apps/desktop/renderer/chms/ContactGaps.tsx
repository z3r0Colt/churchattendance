import { useState } from "react";
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
  contactGaps,
  contactSourceLabels,
  statusLabels,
  type ContactFlag,
  type ContactState,
  type ReportRow,
} from "@sycamore/shared";
import { ExportButton } from "../components/ExportButton";
import { saveCareNote } from "../data/chms";
import {
  saveContactPolicy,
  useContactHistory,
  type useShepherdingData,
} from "../data/shepherding";
import { Picker, Records, RecordEditor, type EditorField } from "./Common";

const stateLabels: Record<ContactState, string> = {
  gap: "Contact gap",
  unknown: "Unknown",
  notDue: "Not yet due",
  current: "Current",
};
const display = (date: string) =>
  date ? DateTime.fromISO(date).toFormat("LLL d, yyyy") : "";

export function ContactGaps({
  data,
}: {
  data: ReturnType<typeof useShepherdingData>;
}) {
  const { history, error } = useContactHistory(true);
  const [filter, setFilter] = useState({ district: "", state: "" });
  const [open, setOpen] = useState<ContactFlag | null>(null);
  const [editing, setEditing] = useState<
    "policy" | { personId: string } | null
  >(null);
  const policy = history?.policy ?? null;
  const person = (id: string) => data.people.find((row) => row.id === id);
  const name = (id: string) =>
    person(id)
      ? `${person(id)!.firstName} ${person(id)!.lastName}`
      : "Person removed";
  const districts = data.districts.filter((row) => !row.archived);
  const districtName = (id: string) =>
    data.districts.find((row) => row.id === id)?.name || "No district";
  const flags =
    history && policy
      ? contactGaps(
          data.people,
          history.events,
          policy,
          history.today,
          history.rollEntry,
        )
      : [];
  const shown = flags.filter(
    (row) =>
      (!filter.state || row.state === filter.state) &&
      (!filter.district ||
        person(row.personId)?.elderDistrictId === filter.district),
  );
  const explain = (row: ContactFlag) =>
    row.state === "gap"
      ? `${row.daysPastDue} days past due`
      : row.state === "unknown"
        ? `Records begin ${display(policy!.historyStart)}`
        : row.state === "notDue"
          ? `On the roll since ${display(row.measuredFrom)}`
          : `Due ${display(row.dueDate)}`;
  const rows: ReportRow[] = shown.map((row) => ({
    id: row.personId,
    Person: name(row.personId),
    Household:
      data.households.find(
        (household) => household.id === person(row.personId)?.householdId,
      )?.name || "",
    District: districtName(person(row.personId)?.elderDistrictId || ""),
    "Last contact": row.lastContact
      ? `${display(row.lastContact.date)} · ${contactSourceLabels[row.lastContact.source]}`
      : "None recorded",
    Rule: `${row.rule === "district" ? districtName(person(row.personId)?.elderDistrictId || "") : "Church policy"}: ${row.thresholdDays} days`,
    State: stateLabels[row.state],
    Detail: explain(row),
  }));
  const policyFields: EditorField[] = [
    {
      key: "historyStart",
      label: "Contact records are complete from",
      kind: "date",
      required: true,
    },
    {
      key: "defaultContactDays",
      label: "Church policy: days between contacts",
      kind: "number",
    },
    ...districts.map((row): EditorField => ({
      key: `district:${row.id}`,
      label: `${row.name}: days between contacts (blank uses church policy)`,
      kind: "number",
    })),
    {
      key: "trackedStatuses",
      label: "Track contact for",
      kind: "multi",
      options: (
        ["communicant", "baptized", "nonResident", "adherent"] as const
      ).map((id) => ({ id, name: statusLabels[id] })),
    },
    {
      key: "countPersonalMessages",
      label:
        "Count personal texts delivered and emails accepted, sent by a Session officer to three or fewer people",
      kind: "checkbox",
    },
  ];
  const timeline = open
    ? (history?.events || [])
        .filter((row) => row.personId === open.personId)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  return (
    <>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {history && !policy && (
        <MessageBar intent="warning">
          Set the contact policy to start tracking contact gaps. Contact before
          its start date is treated as unknown.
        </MessageBar>
      )}
      <div className="report-filters">
        <Picker
          label="Contact state"
          value={filter.state}
          choices={Object.entries(stateLabels).map(([id, label]) => ({
            id,
            name: label,
          }))}
          onChange={(state) => setFilter({ ...filter, state })}
          empty="All states"
        />
        <Picker
          label="Elder district"
          value={filter.district}
          choices={districts.map((row) => ({ id: row.id, name: row.name }))}
          onChange={(district) => setFilter({ ...filter, district })}
          empty="All districts"
        />
        <Button onClick={() => setEditing("policy")} disabled={!history}>
          Contact policy
        </Button>
      </div>
      {policy && (
        <p className="muted">
          Contact means a completed visit, a recorded visit, call or
          conversation, a text reply
          {policy.countPersonalMessages
            ? ", or a personal message that reached the person"
            : ""}
          . Planned visits, bulletins, group messages and failed or waiting
          messages never count. Church policy is {policy.defaultContactDays}{" "}
          days.
        </p>
      )}
      <section className="surface table-card communication-panel session-panel">
        <div className="section-heading">
          <span>
            {shown.length} {shown.length === 1 ? "person" : "people"}
            {!history && !error && " · Loading"}
          </span>
          <ExportButton rows={rows} />
        </div>
        {!rows.length ? (
          <p>No people match this view.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(rows[0])
                    .filter((key) => key !== "id")
                    .map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((flag, index) => (
                  <tr key={flag.personId}>
                    {Object.entries(rows[index])
                      .filter(([key]) => key !== "id")
                      .map(([key, value], column) => (
                        <td key={key}>
                          {column === 0 ? (
                            <Button
                              appearance="transparent"
                              onClick={() => setOpen(flag)}
                            >
                              {value}
                            </Button>
                          ) : (
                            value
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
      {open && (
        <Dialog open onOpenChange={(_, value) => !value.open && setOpen(null)}>
          <DialogSurface className="record-dialog">
            <DialogBody>
              <DialogTitle>Contact with {name(open.personId)}</DialogTitle>
              <DialogContent>
                <p>
                  {stateLabels[open.state]} · {explain(open)}. Rule:{" "}
                  {open.rule === "district" ? "district" : "church"} policy of{" "}
                  {open.thresholdDays} days, measured from{" "}
                  {display(open.measuredFrom)}.
                </p>
                <Records
                  rows={timeline.map((row, index) => ({
                    id: `${row.refId}-${index}`,
                    Date: display(row.date),
                    Contact: contactSourceLabels[row.source],
                  }))}
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setOpen(null)}>Close</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setEditing({ personId: open.personId });
                    setOpen(null);
                  }}
                >
                  Record contact
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {editing === "policy" && (
        <RecordEditor
          title="Contact policy · Session only"
          fields={policyFields}
          initial={{
            historyStart: policy?.historyStart || history?.today || "",
            defaultContactDays: policy?.defaultContactDays ?? 90,
            trackedStatuses: policy?.trackedStatuses ?? [
              "communicant",
              "adherent",
            ],
            countPersonalMessages: policy?.countPersonalMessages ?? true,
            ...Object.fromEntries(
              Object.entries(policy?.districtContactDays || {}).map(
                ([id, days]) => [`district:${id}`, days],
              ),
            ),
          }}
          save={(value) =>
            saveContactPolicy({
              expectedRevision: policy?.revision ?? 0,
              historyStart: value.historyStart,
              defaultContactDays: Number(value.defaultContactDays),
              trackedStatuses: value.trackedStatuses,
              countPersonalMessages: value.countPersonalMessages,
              districtContactDays: Object.fromEntries(
                districts
                  .map((row) => [row.id, Number(value[`district:${row.id}`])])
                  .filter(([, days]) => Number(days) > 0),
              ),
            })
          }
          close={() => setEditing(null)}
        />
      )}
      {editing && editing !== "policy" && (
        <RecordEditor
          title={`Session only contact with ${name(editing.personId)}`}
          fields={[
            {
              key: "kind",
              label: "Contact type",
              kind: "select",
              required: true,
              options: [
                { id: "call", name: "Phone call" },
                { id: "conversation", name: "Conversation" },
                { id: "visit", name: "Visit" },
              ],
            },
            { key: "date", label: "Date", kind: "date", required: true },
            {
              key: "body",
              label: "Session only record",
              kind: "textarea",
              required: true,
            },
          ]}
          initial={{
            id: crypto.randomUUID(),
            expectedRevision: 0,
            kind: "call",
            date: history?.today || "",
            body: "",
          }}
          save={(value) =>
            saveCareNote({ ...value, personId: editing.personId })
          }
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
