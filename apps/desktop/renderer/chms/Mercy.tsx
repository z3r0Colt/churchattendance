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
  canCompleteVisit,
  localSchedule,
  visitState,
  mercyCategories,
  displayValue,
  mercyCategoryLabels,
  mercyOpen,
  mercyStatusLabels,
  mercyStatuses,
  type MercyNote,
  type MercyRequest,
  type MercyTask,
  type MercyVisit,
} from "@sycamore/shared";
import { ExportButton } from "../components/ExportButton";
import { churchLocalInput, usePublicChms } from "../data/chms";
import { useVisitLogistics } from "../data/shepherding";
import {
  completeMercyVisit,
  saveMercyVisit,
  progressMercyRequest,
  saveMercyAssignment,
  saveMercyNote,
  saveMercyRequest,
  saveMercySettings,
  saveMercyTask,
  shareMercyNote,
  triageMercyRequest,
  useMercyWorkspace,
} from "../data/mercy";
import {
  Picker,
  Records,
  StatusPill,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";

type Editing = {
  title: string;
  fields: EditorField[];
  value: Record<string, unknown>;
  save: (value: Record<string, unknown>) => Promise<unknown>;
};
const PRIVATE_TEXT = "Assigned deacons and the Pastor only";

export function Mercy() {
  const { data, error: loadError } = useMercyWorkspace(true);
  const congregation = usePublicChms();
  const [tab, setTab] = useState("requests");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sharing, setSharing] = useState<MercyNote | null>(null);
  const [error, setError] = useState("");
  const today = DateTime.now().toISODate()!;
  const viewer = data?.viewer;
  const zone = data?.zone || congregation.zone;
  const invited = useVisitLogistics(!!viewer?.session);
  const when = (iso: string) =>
    DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy h:mm a");
  const household = (id: string) =>
    congregation.households.find((row) => row.id === id)?.name ||
    "Household removed";
  const person = (id: string) => {
    const row = congregation.people.find((p) => p.id === id);
    return row ? `${row.firstName} ${row.lastName}` : "";
  };
  const deacon = (uid: string) =>
    data?.deacons.find((row) => row.uid === uid)?.name || "Former deacon";
  const deaconChoices = (data?.deacons || []).map((row) => ({
    id: row.uid,
    name: row.name,
  }));
  const households = [...congregation.households]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name }));
  const run = (action: () => Promise<unknown>) =>
    void action().catch((cause) => setError(friendlyError(cause)));
  const assigned = new Map(
    (data?.assignments || []).map((row) => [row.householdId, row]),
  );
  const requests = [...(data?.requests || [])]
    .filter((row) => !status || row.status === status)
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const requestName = (id: string) => {
    const row = data?.requests.find((r) => r.id === id);
    return row
      ? `${household(row.householdId)} · ${mercyCategoryLabels[row.category]}`
      : "";
  };
  const requestFields: EditorField[] = [
    {
      key: "householdId",
      label: "Household",
      kind: "select",
      required: true,
      options: households,
    },
    {
      key: "personId",
      label: "Person (optional)",
      kind: "select",
      options: congregation.people
        .filter((row) => !row.isDeceased)
        .map((row) => ({
          id: row.id,
          name: `${row.firstName} ${row.lastName}`,
        })),
    },
    {
      key: "category",
      label: "Kind of help",
      kind: "select",
      required: true,
      options: mercyCategories.map((id) => ({
        id,
        name: mercyCategoryLabels[id],
      })),
    },
    { key: "urgent", label: "Urgent", kind: "checkbox" },
    { key: "neededBy", label: "Needed by", kind: "date" },
    {
      key: "details",
      label: `What is needed · ${PRIVATE_TEXT}`,
      kind: "textarea",
      required: true,
    },
  ];
  const raise = (preset: Partial<MercyRequest> = {}) =>
    setEditing({
      title: "Practical help request",
      fields: requestFields,
      value: {
        id: crypto.randomUUID(),
        expectedRevision: 0,
        householdId: "",
        personId: "",
        category: "meals",
        urgent: false,
        neededBy: "",
        details: "",
        ...preset,
      },
      save: saveMercyRequest,
    });
  const triage = (row: MercyRequest) =>
    setEditing({
      title: `Triage · ${household(row.householdId)}`,
      fields: [
        {
          key: "action",
          label: "Decision",
          kind: "select",
          required: true,
          options:
            row.status === "new"
              ? [
                  { id: "approve", name: "Approve and assign" },
                  { id: "decline", name: "Decline" },
                ]
              : [{ id: "reassign", name: "Reassign" }],
        },
        {
          key: "deaconUids",
          label: "Assigned deacons",
          kind: "multi",
          options: deaconChoices,
        },
        { key: "reason", label: "Reason for declining", kind: "textarea" },
      ],
      value: {
        id: row.id,
        expectedRevision: row.revision,
        action: row.status === "new" ? "approve" : "reassign",
        deaconUids: row.deaconUids.length
          ? row.deaconUids
          : assigned.get(row.householdId)?.deaconUids || [],
        reason: "",
      },
      save: ({ id, expectedRevision, action, deaconUids, reason }) =>
        triageMercyRequest(
          action === "decline"
            ? { id, expectedRevision, action, reason }
            : { id, expectedRevision, action, deaconUids },
        ),
    });
  const progress = (row: MercyRequest, next: "inProgress" | "resolved") =>
    next === "inProgress"
      ? run(() =>
          progressMercyRequest({
            id: row.id,
            expectedRevision: row.revision,
            status: next,
          }),
        )
      : setEditing({
          title: "Resolve request",
          fields: [
            {
              key: "outcome",
              label: `How it was resolved · ${PRIVATE_TEXT}`,
              kind: "textarea",
              required: true,
            },
          ],
          value: { id: row.id, expectedRevision: row.revision, outcome: "" },
          save: (value) =>
            progressMercyRequest({ ...value, status: "resolved" }),
        });
  const note = (preset: Partial<MercyNote> = {}, existing?: MercyNote) =>
    setEditing({
      title: "Mercy note",
      fields: [
        {
          key: "householdId",
          label: "Household",
          kind: "select",
          required: true,
          options: viewer?.pastor
            ? households
            : households.filter(
                (row) =>
                  assigned
                    .get(row.id)
                    ?.deaconUids.includes(viewer?.uid || "") ||
                  data?.requests.some(
                    (r) => r.householdId === row.id && r.details !== undefined,
                  ),
              ),
        },
        {
          key: "requestId",
          label: "Request (optional)",
          kind: "select",
          options: (data?.requests || [])
            .filter((row) => row.details !== undefined)
            .map((row) => ({ id: row.id, name: requestName(row.id) })),
        },
        { key: "date", label: "Date", kind: "date", required: true },
        {
          key: "body",
          label: `Mercy note · ${PRIVATE_TEXT}`,
          kind: "textarea",
          required: true,
        },
      ],
      value: existing
        ? { ...existing, expectedRevision: existing.revision }
        : {
            id: crypto.randomUUID(),
            expectedRevision: 0,
            householdId: "",
            requestId: "",
            date: today,
            body: "",
            ...preset,
          },
      save: saveMercyNote,
    });
  const task = (requestId: string, existing?: MercyTask) => {
    const linked = data?.requests.find((row) => row.id === requestId);
    const serving = new Set([
      ...(linked?.deaconUids || []),
      ...(assigned.get(linked?.householdId || "")?.deaconUids || []),
    ]);
    setEditing({
      title: "Mercy task",
      fields: [
        { key: "title", label: "Task", required: true },
        {
          key: "assignedToUid",
          label: "Deacon",
          kind: "select",
          required: true,
          options: deaconChoices.filter((row) => serving.has(row.id)),
        },
        { key: "dueDate", label: "Due date", kind: "date", required: true },
        { key: "done", label: "Completed", kind: "checkbox" },
      ],
      value: existing
        ? { ...existing, expectedRevision: existing.revision }
        : {
            id: crypto.randomUUID(),
            expectedRevision: 0,
            requestId,
            title: "",
            assignedToUid: viewer?.uid || "",
            dueDate: today,
            done: false,
          },
      save: (value) => saveMercyTask({ ...value, requestId }),
    });
  };
  const visitStates = {
    upcoming: "Upcoming",
    overdue: "Overdue",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  const servedHouseholds = viewer?.pastor
    ? households
    : households.filter(
        (row) =>
          assigned.get(row.id)?.deaconUids.includes(viewer?.uid || "") ||
          data?.requests.some(
            (r) => r.householdId === row.id && r.details !== undefined,
          ),
      );
  const planVisit = (existing?: MercyVisit) =>
    setEditing({
      title: "Deacon visit",
      fields: [
        {
          key: "householdId",
          label: "Household",
          kind: "select",
          required: true,
          options: servedHouseholds,
        },
        {
          key: "requestId",
          label: "Request (optional)",
          kind: "select",
          options: (data?.requests || [])
            .filter((row) => row.details !== undefined)
            .map((row) => ({ id: row.id, name: requestName(row.id) })),
        },
        {
          key: "start",
          label: "Date and time",
          kind: "datetime-local",
          required: true,
        },
        { key: "durationMinutes", label: "Minutes", kind: "number" },
        { key: "location", label: "Where" },
        {
          key: "deaconUids",
          label: "Deacons visiting",
          kind: "multi",
          options: deaconChoices,
        },
        {
          key: "officerUids",
          label: "Invited Session officers (see the time and place only)",
          kind: "multi",
          options: (data?.officers || []).map((row) => ({
            id: row.uid,
            name: row.name,
          })),
        },
        {
          key: "purpose",
          label: `Purpose · ${PRIVATE_TEXT}`,
          kind: "textarea",
        },
        ...(existing
          ? ([
              {
                key: "status",
                label: "Plan status",
                kind: "select",
                options: [
                  { id: "planned", name: "Planned" },
                  { id: "cancelled", name: "Cancelled" },
                ],
              },
              { key: "cancelReason", label: "Reason for cancelling" },
            ] satisfies EditorField[])
          : []),
      ],
      value: existing
        ? {
            ...existing,
            expectedRevision: existing.revision,
            start: churchLocalInput(existing.start, zone),
          }
        : {
            id: crypto.randomUUID(),
            expectedRevision: 0,
            householdId: "",
            requestId: "",
            start: "",
            durationMinutes: 60,
            location: "",
            deaconUids: viewer?.deacon ? [viewer.uid] : [],
            officerUids: [],
            purpose: "",
          },
      save: (value) =>
        saveMercyVisit({
          ...value,
          start: localSchedule(String(value.start), zone),
        }),
    });
  const completeVisit = (row: MercyVisit) =>
    setEditing({
      title: `Complete visit with ${household(row.householdId)}`,
      fields: [
        {
          key: "note",
          label: `Mercy note (optional) · ${PRIVATE_TEXT}`,
          kind: "textarea",
        },
      ],
      value: { id: row.id, expectedRevision: row.revision, note: "" },
      save: completeMercyVisit,
    });
  const officerName = (uid: string) =>
    data?.officers.find((row) => row.uid === uid)?.name || "Session officer";
  const visits = [...(data?.visits || [])].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const notes = [...(data?.notes || [])].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const tasks = [...(data?.tasks || [])].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  );
  const roleLabel = viewer?.pastor
    ? "Pastor oversight"
    : viewer?.triage
      ? viewer.session
        ? "Session triage"
        : "Deacon chair"
      : "Assigned deacon";
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DIACONAL CARE</span>
          <Title3 as="h1">
            <LockClosedRegular /> Mercy ministry
          </Title3>
          <p>
            Practical help for households. No money or donation records are kept
            here.
          </p>
        </div>
      </div>
      <MessageBar
        className="session-banner"
        intent="info"
        icon={<LockClosedRegular />}
      >
        Mercy ministry · {PRIVATE_TEXT}. Triage shows who needs which kind of
        help, never the notes.{" "}
        {viewer ? `You are viewing as: ${roleLabel}.` : ""}
      </MessageBar>
      {(error || loadError || congregation.error) && (
        <MessageBar intent="error">
          {error || loadError || congregation.error}
        </MessageBar>
      )}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="requests">Requests</Tab>
        <Tab value="households">Households</Tab>
        <Tab value="notes">Mercy notes</Tab>
        <Tab value="tasks">Tasks</Tab>
        <Tab value="visits">Visits</Tab>
        {viewer?.session && <Tab value="settings">Deacon chairs</Tab>}
      </TabList>
      {!data && !loadError && <p>Loading mercy ministry records.</p>}
      {data && tab === "requests" && (
        <>
          <div className="report-filters">
            <Picker
              label="Request status"
              value={status}
              choices={mercyStatuses.map((id) => ({
                id,
                name: mercyStatusLabels[id],
              }))}
              onChange={setStatus}
              empty="All requests"
            />
            <Button appearance="primary" onClick={() => raise()}>
              Raise request
            </Button>
          </div>
          <section className="surface table-card communication-panel">
            <div className="section-heading">
              <span>
                {requests.length} request{requests.length === 1 ? "" : "s"}
              </span>
              <ExportButton
                rows={requests.map((row) => ({
                  id: row.id,
                  Household: household(row.householdId),
                  Person: person(row.personId),
                  Help: mercyCategoryLabels[row.category],
                  From: row.source === "member" ? "Member" : "Officer",
                  Urgent: row.urgent ? "Yes" : "No",
                  "Needed by": row.neededBy,
                  Status: mercyStatusLabels[row.status],
                  Deacons: row.deaconUids.map(deacon).join(", "),
                  Details: row.details ?? PRIVATE_TEXT,
                }))}
              />
            </div>
            {!requests.length ? (
              <p>No requests match this view.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Household</th>
                      <th>Help</th>
                      <th>Status</th>
                      <th>Deacons</th>
                      <th>Details</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {household(row.householdId)}
                          {row.personId ? ` · ${person(row.personId)}` : ""}
                        </td>
                        <td>
                          {mercyCategoryLabels[row.category]}
                          {row.source === "member" ? " · Member request" : ""}
                          {row.urgent ? " · Urgent" : ""}
                          {row.neededBy ? ` · by ${row.neededBy}` : ""}
                        </td>
                        <td>
                          <StatusPill text={mercyStatusLabels[row.status]} />
                        </td>
                        <td>
                          {row.deaconUids.map(deacon).join(", ") || "None"}
                        </td>
                        <td>
                          {row.details ?? PRIVATE_TEXT}
                          {row.outcome ? ` · Outcome: ${row.outcome}` : ""}
                          {row.declineReason
                            ? ` · Declined: ${row.declineReason}`
                            : ""}
                        </td>
                        <td>
                          {viewer?.triage &&
                            (row.status === "new" || mercyOpen(row.status)) && (
                              <Button size="small" onClick={() => triage(row)}>
                                {row.status === "new" ? "Triage" : "Reassign"}
                              </Button>
                            )}
                          {row.details !== undefined && (
                            <>
                              {(row.status === "new" ||
                                mercyOpen(row.status)) && (
                                <Button
                                  size="small"
                                  onClick={() =>
                                    raise({
                                      ...row,
                                      expectedRevision: row.revision,
                                    } as Partial<MercyRequest>)
                                  }
                                >
                                  Edit
                                </Button>
                              )}
                              {row.status === "approved" && (
                                <Button
                                  size="small"
                                  onClick={() => progress(row, "inProgress")}
                                >
                                  Start
                                </Button>
                              )}
                              {mercyOpen(row.status) && (
                                <>
                                  <Button
                                    size="small"
                                    onClick={() => progress(row, "resolved")}
                                  >
                                    Resolve
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() => task(row.id)}
                                  >
                                    Add task
                                  </Button>
                                </>
                              )}
                              <Button
                                size="small"
                                onClick={() =>
                                  note({
                                    householdId: row.householdId,
                                    requestId: row.id,
                                  })
                                }
                              >
                                Add note
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {data && tab === "households" && (
        <>
          <p className="muted">
            {viewer?.triage
              ? "Assign up to four deacons to each household. Removing a deacon ends their access to that household's notes at once."
              : "Households assigned to you."}
          </p>
          <Records
            rows={(viewer?.triage
              ? households
              : households.filter((row) => assigned.has(row.id))
            ).map((row) => ({
              id: row.id,
              Household: row.name,
              Deacons:
                assigned.get(row.id)?.deaconUids.map(deacon).join(", ") ||
                "Not assigned",
            }))}
            choose={
              viewer?.triage
                ? (index) => {
                    const row = households[index];
                    const current = assigned.get(row.id);
                    setEditing({
                      title: `Deacons for ${row.name}`,
                      fields: [
                        {
                          key: "deaconUids",
                          label: "Assigned deacons",
                          kind: "multi",
                          options: deaconChoices,
                        },
                      ],
                      value: {
                        householdId: row.id,
                        expectedRevision: current?.revision || 0,
                        deaconUids: current?.deaconUids || [],
                      },
                      save: (value) =>
                        saveMercyAssignment({
                          ...value,
                          householdId: row.id,
                          expectedRevision: current?.revision || 0,
                        }),
                    });
                  }
                : undefined
            }
          />
        </>
      )}
      {data && tab === "notes" && (
        <>
          {(viewer?.pastor || viewer?.deacon) && (
            <Button appearance="primary" onClick={() => note()}>
              Add mercy note
            </Button>
          )}
          <section className="surface table-card communication-panel">
            <div className="section-heading">
              <span>
                {notes.length} note{notes.length === 1 ? "" : "s"}
              </span>
              <ExportButton
                rows={notes.map((row) => ({
                  id: row.id,
                  Date: row.date,
                  Household: household(row.householdId),
                  Request: requestName(row.requestId),
                  Note: row.body,
                  Shared: row.sharedWithSession ? "Session" : "No",
                }))}
              />
            </div>
            {!notes.length ? (
              <p>No mercy notes you can read.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Household</th>
                      <th>Request</th>
                      <th>Note</th>
                      <th>Shared</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.map((row) => (
                      <tr key={row.id}>
                        <td>{displayValue(row.date)}</td>
                        <td>{household(row.householdId)}</td>
                        <td>{requestName(row.requestId)}</td>
                        <td>{row.body}</td>
                        <td>
                          {row.sharedWithSession
                            ? "Shared with the Session"
                            : "Not shared"}
                        </td>
                        <td>
                          {row.authorUid === viewer?.uid && (
                            <Button size="small" onClick={() => note({}, row)}>
                              Edit
                            </Button>
                          )}
                          {!row.sharedWithSession &&
                            (viewer?.pastor || viewer?.deacon) && (
                              <Button
                                size="small"
                                onClick={() => setSharing(row)}
                              >
                                Share with the Session
                              </Button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {data && tab === "tasks" && (
        <Records
          rows={tasks.map((row) => ({
            id: row.id,
            Task: row.title,
            Request: requestName(row.requestId),
            Deacon: deacon(row.assignedToUid),
            Due: row.dueDate,
            Status: row.done
              ? "Complete"
              : row.dueDate < today
                ? "Overdue"
                : "Open",
          }))}
          choose={(index) => task(tasks[index].requestId, tasks[index])}
        />
      )}
      {data && tab === "visits" && (
        <>
          {(viewer?.deacon || viewer?.pastor) && (
            <>
              <p className="muted">
                Plan visits for the households and requests you serve. Invited
                Session officers see only the time, place and who is going.
                Planning a visit does not record that it happened.
              </p>
              <Button appearance="primary" onClick={() => planVisit()}>
                Plan visit
              </Button>
              <section className="surface table-card communication-panel">
                <div className="section-heading">
                  <span>
                    {visits.length} visit{visits.length === 1 ? "" : "s"}
                  </span>
                  <ExportButton
                    rows={visits.map((row) => ({
                      id: row.id,
                      When: when(row.start),
                      Household: household(row.householdId),
                      Deacons: row.deaconUids.map(deacon).join(", "),
                      State: visitStates[visitState(row, new Date())],
                    }))}
                  />
                </div>
                {!visits.length ? (
                  <p>No deacon visits are planned.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Household</th>
                          <th>Deacons</th>
                          <th>Officers invited</th>
                          <th>State</th>
                          <th>Purpose</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visits.map((row) => (
                          <tr key={row.id}>
                            <td>{when(row.start)}</td>
                            <td>{household(row.householdId)}</td>
                            <td>{row.deaconUids.map(deacon).join(", ")}</td>
                            <td>
                              {row.officerUids.map(officerName).join(", ") ||
                                "None"}
                            </td>
                            <td>
                              <StatusPill
                                text={visitStates[visitState(row, new Date())]}
                              />
                            </td>
                            <td>{row.purpose}</td>
                            <td>
                              {row.status !== "completed" && (
                                <Button
                                  size="small"
                                  onClick={() => planVisit(row)}
                                >
                                  Edit
                                </Button>
                              )}
                              {canCompleteVisit(row, new Date()) && (
                                <Button
                                  size="small"
                                  onClick={() => completeVisit(row)}
                                >
                                  Complete
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
          {viewer?.session && (
            <section className="surface table-card communication-panel">
              <div className="section-heading">
                <span>Deacon visits you are invited to</span>
              </div>
              <p className="muted">
                You see the time and place of deacon visits you are invited to.
                Purposes and mercy notes stay with the deacons.
              </p>
              {invited.error && (
                <MessageBar intent="error">{invited.error}</MessageBar>
              )}
              <Records
                rows={invited.visits
                  .filter((row) => row.ministry === "mercy")
                  .map((row) => ({
                    id: row.id,
                    When: when(row.start),
                    Household: row.householdName,
                    Where: row.location || row.address || "Ask the deacons",
                    With: row.deaconNames.join(", "),
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
        </>
      )}
      {data && tab === "settings" && viewer?.session && (
        <section className="surface communication-panel">
          <p>
            Deacon chairs can see the triage queue and assign households and
            requests, like the Session. They read mercy notes only for the
            households assigned to them.
          </p>
          <p>
            Current chairs:{" "}
            {data.settings?.chairUids.map(deacon).join(", ") || "None"}
          </p>
          <Button
            onClick={() =>
              setEditing({
                title: "Deacon chairs",
                fields: [
                  {
                    key: "chairUids",
                    label: "Deacon chairs",
                    kind: "multi",
                    options: deaconChoices,
                  },
                ],
                value: {
                  expectedRevision: data.settings?.revision || 0,
                  chairUids: data.settings?.chairUids || [],
                },
                save: (value) =>
                  saveMercySettings({
                    ...value,
                    expectedRevision: data.settings?.revision || 0,
                  }),
              })
            }
          >
            Choose deacon chairs
          </Button>
        </section>
      )}
      {editing && (
        <RecordEditor
          title={editing.title}
          fields={editing.fields}
          initial={editing.value}
          save={editing.save}
          close={() => setEditing(null)}
        />
      )}
      {sharing && (
        <Dialog
          open
          onOpenChange={(_, value) => !value.open && setSharing(null)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Share this note with the Session</DialogTitle>
              <DialogContent>
                The Pastor, the Clerk and every Elder will be able to read this
                note. Other deacons still cannot. Sharing is logged and cannot
                be undone here.
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSharing(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    const row = sharing;
                    setSharing(null);
                    run(() =>
                      shareMercyNote({
                        id: row.id,
                        expectedRevision: row.revision,
                        audience: "session",
                      }),
                    );
                  }}
                >
                  Share with the Session
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </>
  );
}
