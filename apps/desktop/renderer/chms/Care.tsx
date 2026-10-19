import { useState } from "react";
import {
  Button,
  MessageBar,
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  hasRole,
  type Role,
  memberRequestKindLabels,
  sessionRequestStatusLabels,
  type CareNote,
  type FollowUp,
  type MemberRequest,
} from "@sycamore/shared";
import {
  completeDiaconalTask,
  recordDiscipline,
  saveCareNote,
  saveDiaconalTask,
  saveFollowUp,
  updateMemberRequest,
  useCareData,
} from "../data/chms";
import { ExportButton } from "../components/ExportButton";
import {
  Picker,
  Records,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";
import { useVisitLogistics } from "../data/shepherding";
type Editing = {
  kind: "note" | "followUp" | "deacon" | "discipline";
  value: Record<string, unknown>;
};
export function Care({ roles }: { roles: Role[] }) {
  const session = hasRole(roles, SESSION_ROLES);
  const data = useCareData(roles);
  const joint = useVisitLogistics(!session);
  const [tab, setTab] = useState(session ? "notes" : "deacon");
  const [person, setPerson] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const today = DateTime.now().toISODate()!;
  const people = data.people.map((row) => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`,
  }));
  const name = (id: string) => people.find((row) => row.id === id)?.name || id;
  const user = (id: string) =>
    data.users.find((row) => row.id === id)?.name || id;
  const personField: EditorField = {
    key: "personId",
    label: "Person",
    kind: "select",
    required: true,
    options: people,
  };
  const taskFields = (kind: "followUp" | "deacon"): EditorField[] => [
    personField,
    { key: "title", label: "Task", required: true },
    {
      key: "assignedToUid",
      label: "Assigned to",
      kind: "select",
      required: true,
      options: data.users
        .filter((row) =>
          row.roles.some((role) =>
            (kind === "deacon" ? ["deacon"] : SESSION_ROLES).includes(role),
          ),
        )
        .map((row) => ({ id: row.id, name: row.name })),
    },
    { key: "dueDate", label: "Due date", kind: "date", required: true },
    { key: "done", label: "Completed", kind: "checkbox" },
  ];
  const noteFields: EditorField[] = [
    personField,
    {
      key: "kind",
      label: "Record type",
      kind: "select",
      options: [
        { id: "note", name: "Pastoral note (not contact)" },
        { id: "visit", name: "Visit" },
        { id: "call", name: "Phone call" },
        { id: "conversation", name: "Conversation" },
      ],
    },
    { key: "date", label: "Date", kind: "date", required: true },
    {
      key: "body",
      label: "Session only record",
      kind: "textarea",
      required: true,
    },
  ];
  const newTask = (kind: "followUp" | "deacon") =>
    setEditing({
      kind,
      value: {
        id: crypto.randomUUID(),
        expectedRevision: 0,
        personId: person,
        title: "",
        assignedToUid: "",
        dueDate: today,
        done: false,
      },
    });
  const editTask = (kind: "followUp" | "deacon", row: FollowUp) =>
    setEditing({
      kind,
      value: { ...row, expectedRevision: row.revision || 0 },
    });
  const privateRecord = data.privateRecords.find((row) => row.id === person);
  const notes = data.notes
    .filter((row) => !person || row.personId === person)
    .sort((a, b) => b.date.localeCompare(a.date));
  const followUps = data.followUps
    .filter((row) => !person || row.personId === person)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const tasks = data.tasks
    .filter((row) => !person || row.personId === person)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const requests = data.requests
    .filter((row) => !person || row.personId === person)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const waiting = data.requests.filter(
    (row) => row.status === "received",
  ).length;
  async function moveRequest(
    row: MemberRequest,
    status: "acknowledged" | "closed",
  ) {
    setError("");
    try {
      await updateMemberRequest({
        id: row.id,
        expectedRevision: row.revision,
        status,
      });
    } catch (failure) {
      setError(friendlyError(failure));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {session ? "SHEPHERDING CARE" : "ASSIGNED SERVICE"}
          </span>
          <Title3 as="h1">
            {session ? (
              <>
                <LockClosedRegular /> Pastoral care
              </>
            ) : (
              "Deacon tasks"
            )}
          </Title3>
          <p>
            {session
              ? "Session only. Pastoral records are visible to the Pastor, Clerk and Elders."
              : "Only tasks assigned to your account are shown."}
          </p>
        </div>
      </div>
      {session && (
        <MessageBar
          className="session-banner"
          intent="info"
          icon={<LockClosedRegular />}
        >
          Session only. Keep these records within the Session.
        </MessageBar>
      )}
      {(error || data.error) && (
        <MessageBar intent="error">{error || data.error}</MessageBar>
      )}
      {session && (
        <>
          <Picker
            label="Filter by person"
            value={person}
            choices={people}
            onChange={setPerson}
            empty="All people"
          />
          <TabList
            selectedValue={tab}
            onTabSelect={(_, value) => setTab(String(value.value))}
          >
            <Tab value="notes">Notes & visits</Tab>
            <Tab value="followUps">Follow-ups</Tab>
            <Tab value="discipline">Discipline record</Tab>
            <Tab value="deacon">Diaconal tasks</Tab>
            <Tab value="requests">
              Member requests
              {waiting ? ` (${waiting})` : ""}
            </Tab>
          </TabList>
        </>
      )}
      {tab === "notes" && (
        <>
          <Button
            appearance="primary"
            onClick={() =>
              setEditing({
                kind: "note",
                value: {
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  personId: person,
                  kind: "note",
                  date: today,
                  body: "",
                },
              })
            }
          >
            Add note or visit
          </Button>
          <Records
            rows={notes.map((row) => ({
              id: row.id,
              Person: name(row.personId),
              Date: row.date,
              Type: row.kind,
              Record: row.body,
            }))}
            choose={(index) => {
              const row = notes[index] as CareNote;
              setEditing({
                kind: "note",
                value: { ...row, expectedRevision: row.revision || 0 },
              });
            }}
          />
        </>
      )}
      {tab === "requests" && session && (
        <>
          <p className="muted">
            Prayer and pastoral care requests members sent through the portal.
            Members see only that a request was received, acknowledged or
            closed. Reply to them in person; record care as a note.
          </p>
          <ExportButton
            rows={requests.map((row) => ({
              id: row.id,
              Person: name(row.personId),
              Received: row.createdAt.slice(0, 10),
              Kind: memberRequestKindLabels[row.kind],
              Status: sessionRequestStatusLabels[row.status],
              Request: row.body,
            }))}
          />
          {!requests.length ? (
            <p>No member requests match this view.</p>
          ) : (
            <div className="request-cards">
              {requests.map((row) => (
                <section
                  key={row.id}
                  className="surface communication-panel session-panel"
                >
                  <h2>
                    {memberRequestKindLabels[row.kind]} from{" "}
                    {name(row.personId)}
                  </h2>
                  <p className="muted">
                    Received{" "}
                    {DateTime.fromISO(row.createdAt).toFormat("LLL d, yyyy")} ·{" "}
                    {sessionRequestStatusLabels[row.status]}
                  </p>
                  <p className="message-body">{row.body}</p>
                  <div className="actions">
                    {row.status === "received" && (
                      <Button
                        onClick={() => void moveRequest(row, "acknowledged")}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {row.status !== "closed" && (
                      <Button onClick={() => void moveRequest(row, "closed")}>
                        Close request
                      </Button>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {tab === "followUps" && (
        <>
          <Button appearance="primary" onClick={() => newTask("followUp")}>
            Add follow-up
          </Button>
          <Records
            rows={followUps.map((row) => ({
              id: row.id,
              Task: row.title,
              Person: name(row.personId),
              Assigned: user(row.assignedToUid),
              Due: row.dueDate,
              Status: row.done
                ? "Complete"
                : row.dueDate < today
                  ? "Overdue"
                  : "Open",
            }))}
            choose={(index) => editTask("followUp", followUps[index])}
          />
        </>
      )}
      {tab === "discipline" && (
        <section className="surface communication-panel session-panel">
          {!person ? (
            <p>Choose a person to open the private discipline record.</p>
          ) : (
            <>
              <p>
                Current flag ·{" "}
                {privateRecord?.disciplineFlag
                  ? "Under discipline"
                  : "No active discipline flag"}
              </p>
              <Button
                onClick={() =>
                  setEditing({
                    kind: "discipline",
                    value: {
                      expectedRevision: privateRecord?.revision || 0,
                      date: today,
                      entry: "",
                      disciplineFlag: privateRecord?.disciplineFlag || false,
                    },
                  })
                }
              >
                Append discipline record
              </Button>
              <Records
                rows={(privateRecord?.disciplineHistory || []).map((row) => ({
                  Date: row.date,
                  Entry: row.entry,
                  Flag: row.flag ? "Active" : "Cleared",
                }))}
              />
            </>
          )}
        </section>
      )}
      {tab === "deacon" && (
        <>
          {session && (
            <>
              <p>
                Include only the practical details the assigned Deacon needs.
                Pastoral notes are never included.
              </p>
              <Button appearance="primary" onClick={() => newTask("deacon")}>
                Add diaconal task
              </Button>
            </>
          )}
          <Records
            rows={tasks.map((row) => ({
              id: row.id,
              Task: row.title,
              ...(session
                ? {
                    Person: name(row.personId),
                    Assigned: user(row.assignedToUid),
                  }
                : {}),
              Due: row.dueDate,
              Status: row.done ? "Complete" : "Open",
            }))}
            choose={
              session ? (index) => editTask("deacon", tasks[index]) : undefined
            }
          />
          {!session && (
            <section className="surface table-card communication-panel">
              <div className="section-heading">
                <span>Joint visits</span>
              </div>
              <p className="muted">
                You see the time and place of visits you are invited to. Visit
                purposes and records stay with the Session.
              </p>
              {joint.error && (
                <MessageBar intent="error">{joint.error}</MessageBar>
              )}
              <Records
                rows={joint.visits.map((row) => ({
                  id: row.id,
                  When: DateTime.fromISO(row.start)
                    .setZone(joint.zone)
                    .toFormat("LLL d, yyyy h:mm a"),
                  Household: row.householdName,
                  Where: row.location || row.address || "Ask the officer",
                  With: row.officerNames.join(", "),
                  Status:
                    row.status === "planned"
                      ? "Planned"
                      : row.status === "completed"
                        ? "Completed"
                        : "Cancelled",
                }))}
              />
            </section>
          )}
          {!session &&
            tasks
              .filter((row) => !row.done)
              .map((row) => (
                <Button
                  key={row.id}
                  onClick={() =>
                    void completeDiaconalTask(row.id).catch((error) =>
                      setError(friendlyError(error)),
                    )
                  }
                >
                  Complete {row.title}
                </Button>
              ))}
        </>
      )}
      {editing && (
        <RecordEditor
          title={
            editing.kind === "note"
              ? "Session only note or visit"
              : editing.kind === "followUp"
                ? "Session only follow-up"
                : editing.kind === "deacon"
                  ? "Assigned diaconal task"
                  : "Session only discipline entry"
          }
          fields={
            editing.kind === "note"
              ? noteFields
              : editing.kind === "discipline"
                ? [
                    {
                      key: "date",
                      label: "Date",
                      kind: "date",
                      required: true,
                    },
                    {
                      key: "entry",
                      label: "Discipline entry",
                      kind: "textarea",
                      required: true,
                    },
                    {
                      key: "disciplineFlag",
                      label: "Under discipline",
                      kind: "checkbox",
                    },
                  ]
                : taskFields(editing.kind)
          }
          initial={editing.value}
          save={(value) =>
            editing.kind === "note"
              ? saveCareNote(value)
              : editing.kind === "followUp"
                ? saveFollowUp(value)
                : editing.kind === "deacon"
                  ? saveDiaconalTask(value)
                  : recordDiscipline({ ...value, personId: person })
          }
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
