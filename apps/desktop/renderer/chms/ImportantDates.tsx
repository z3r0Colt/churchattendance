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
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  bereavementDateKinds,
  bereavementDateSchema,
  hasRole,
  importantDateLabels,
  importantDateSchema,
  nextReminder,
  ordinaryDateKinds,
  reminderChange,
  type BereavementDate,
  type ImportantDate,
  type Role,
} from "@sycamore/shared";
import { ExportButton } from "../components/ExportButton";
import { usePublicChms } from "../data/chms";
import {
  removeBereavementDate,
  removeImportantDate,
  saveBereavementDate,
  saveImportantDate,
  useImportantDates,
} from "../data/dates";
import { RecordEditor, friendlyError, type EditorField } from "./Common";

type Row = ImportantDate | BereavementDate;
type Editing = {
  bereavement: boolean;
  before: Row | null;
  value: Record<string, unknown>;
};
const endLabels = {
  never: "Every year",
  year: "Through a year",
  count: "Through an anniversary number",
};

export function ImportantDates({ roles }: { roles: Role[] }) {
  const session = hasRole(roles, SESSION_ROLES);
  const data = useImportantDates(roles);
  const congregation = usePublicChms();
  const [tab, setTab] = useState("ordinary");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Row | null>(null);
  const today = DateTime.now().setZone(congregation.zone).toISODate()!;
  const person = (id: string) => {
    const row = congregation.people.find((p) => p.id === id);
    return row ? `${row.firstName} ${row.lastName}` : "Person removed";
  };
  const recipient = (uid: string) =>
    data.recipients.find((row) => row.id === uid)?.name ||
    (uid ? "Former account" : "No one");
  const bereavement = tab === "bereavement" && session;
  const rows: Row[] = bereavement ? data.bereavement : data.ordinary;
  const living = congregation.people
    .filter((row) => !row.isDeceased)
    .map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
  const recurrenceFields: EditorField[] = [
    {
      key: "remindDaysBefore",
      label: "Remind this many days before (0 to 30)",
      kind: "number",
    },
    {
      key: "remindUid",
      label: bereavement
        ? "Remind this Session officer"
        : "Remind this staff member",
      kind: "select",
      options: data.recipients
        .filter((row) =>
          bereavement
            ? row.roles.some((role) => SESSION_ROLES.includes(role))
            : true,
        )
        .map((row) => ({ id: row.id, name: row.name })),
    },
    {
      key: "endKind",
      label: "Reminders continue",
      kind: "select",
      options: Object.entries(endLabels).map(([id, name]) => ({ id, name })),
    },
    {
      key: "endYear",
      label: "Last year (when ending in a year)",
      kind: "number",
    },
    {
      key: "endCount",
      label: "Last anniversary number (when ending after an anniversary)",
      kind: "number",
    },
  ];
  const fields: EditorField[] = bereavement
    ? [
        {
          key: "personId",
          label: "Person to care for",
          kind: "select",
          required: true,
          options: living,
        },
        {
          key: "relatedPersonId",
          label: "Related person (may be deceased)",
          kind: "select",
          options: congregation.people.map((row) => ({
            id: row.id,
            name: `${row.firstName} ${row.lastName}${row.isDeceased ? " (deceased)" : ""}`,
          })),
        },
        {
          key: "kind",
          label: "Date",
          kind: "select",
          required: true,
          options: bereavementDateKinds.map((id) => ({
            id,
            name: importantDateLabels[id],
          })),
        },
        { key: "date", label: "Original date", kind: "date", required: true },
        { key: "note", label: "Private note · Session only", kind: "textarea" },
        ...recurrenceFields,
      ]
    : [
        {
          key: "personId",
          label: "Person",
          kind: "select",
          required: true,
          options: living,
        },
        {
          key: "kind",
          label: "Date",
          kind: "select",
          required: true,
          options: ordinaryDateKinds.map((id) => ({
            id,
            name: importantDateLabels[id],
          })),
        },
        { key: "label", label: "Name of the date (for Other)" },
        { key: "date", label: "Original date", kind: "date", required: true },
        ...recurrenceFields,
      ];
  const open = (before: Row | null) =>
    setEditing({
      bereavement,
      before,
      value: before
        ? { ...before, expectedRevision: before.revision }
        : {
            id: crypto.randomUUID(),
            expectedRevision: 0,
            personId: "",
            kind: bereavement ? "deathAnniversary" : "weddingAnniversary",
            date: "",
            remindDaysBefore: 3,
            remindUid: "",
            endKind: "never",
            endYear: 0,
            endCount: 0,
            ...(bereavement
              ? { relatedPersonId: "", note: "" }
              : { label: "" }),
          },
    });
  // The preview validates the draft and explains what happens to the reminder still waiting.
  const preview = (value: Record<string, unknown>) => {
    const parsed = (
      editing?.bereavement ? bereavementDateSchema : importantDateSchema
    ).safeParse({ ...value, id: value.id || "draft" });
    return parsed.success
      ? reminderChange(editing?.before ?? null, parsed.data, today)
      : "Choose a date and when reminders end to see the next reminder.";
  };
  const shown = [...rows].sort((a, b) =>
    (nextReminder(a, today)?.date || "9999").localeCompare(
      nextReminder(b, today)?.date || "9999",
    ),
  );
  const table = shown.map((row) => {
    const next = nextReminder(row, today);
    return {
      id: row.id,
      Person: person(row.personId),
      Date:
        importantDateLabels[row.kind] +
        ("label" in row && row.label ? ` · ${row.label}` : ""),
      "Original date": row.date,
      "Next date": next
        ? `${next.date} (${next.anniversary})`
        : "No further reminders",
      "Reminder on": next?.remindOn || "",
      Remind: recipient(row.remindUid),
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CARE</span>
          <Title3 as="h1">Important dates</Title3>
          <p>
            Yearly reminders to reach out. A Feb 29 date falls on Feb 28 in
            other years. Reminders whose day has passed are never sent late.
          </p>
        </div>
      </div>
      {(error || data.error) && (
        <MessageBar intent="error">{error || data.error}</MessageBar>
      )}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="ordinary">Anniversaries</Tab>
        {session && (
          <Tab value="bereavement" icon={<LockClosedRegular />}>
            Bereavement care · Session only
          </Tab>
        )}
      </TabList>
      {bereavement && (
        <MessageBar
          className="session-banner"
          intent="info"
          icon={<LockClosedRegular />}
        >
          Session only. Reminders name the person and the day, never the reason
          or the note.
        </MessageBar>
      )}
      <Button appearance="primary" onClick={() => open(null)}>
        {bereavement ? "Add bereavement date" : "Add important date"}
      </Button>
      <section
        className={`surface table-card communication-panel${bereavement ? " session-panel" : ""}`}
      >
        <div className="section-heading">
          <span>
            {rows.length} date{rows.length === 1 ? "" : "s"}
          </span>
          <ExportButton rows={table} />
        </div>
        {!rows.length ? (
          <p>No dates yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(table[0])
                    .filter((key) => key !== "id")
                    .map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr key={row.id}>
                    {Object.entries(table[index])
                      .filter(([key]) => key !== "id")
                      .map(([key, value]) => (
                        <td key={key}>{value}</td>
                      ))}
                    <td>
                      <Button size="small" onClick={() => open(row)}>
                        Edit
                      </Button>
                      <Button size="small" onClick={() => setRemoving(row)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {removing && (
        <Dialog
          open
          onOpenChange={(_, value) => !value.open && setRemoving(null)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove this date</DialogTitle>
              <DialogContent>
                {person(removing.personId)} ·{" "}
                {importantDateLabels[removing.kind]}. No further reminders will
                be sent, including one already waiting.
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setRemoving(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    const row = removing;
                    setRemoving(null);
                    void (
                      bereavement ? removeBereavementDate : removeImportantDate
                    )({
                      id: row.id,
                      expectedRevision: row.revision,
                    }).catch((cause) => setError(friendlyError(cause)));
                  }}
                >
                  Remove date
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {editing && (
        <RecordEditor
          title={
            editing.bereavement
              ? "Bereavement date · Session only"
              : "Important date"
          }
          fields={fields}
          initial={editing.value}
          preview={preview}
          save={editing.bereavement ? saveBereavementDate : saveImportantDate}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
