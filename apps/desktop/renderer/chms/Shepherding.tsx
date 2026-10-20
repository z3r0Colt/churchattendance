import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  Select,
  Tab,
  TabList,
  Textarea,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  canCompleteVisit,
  localSchedule,
  roundCoverage,
  visitState,
  visitWorkload,
  visitableHouseholds,
  type PastoralVisit,
  type ReportRow,
  type Role,
  type VisitState,
} from "@sycamore/shared";
import { ExportButton } from "../components/ExportButton";
import { churchLocalInput } from "../data/chms";
import {
  completeVisit,
  saveVisit,
  saveVisitRound,
  useShepherdingData,
} from "../data/shepherding";
import {
  Picker,
  Records,
  RecordEditor,
  friendlyError,
  type EditorField,
  TableScroll,
} from "./Common";
import { ContactGaps } from "./ContactGaps";
import { Locations } from "./Locations";
import { FlockHealth } from "./FlockHealth";

const stateLabels: Record<VisitState, string> = {
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
  cancelled: "Cancelled",
};
type Editing =
  | { kind: "visit"; value: Record<string, unknown>; visit?: PastoralVisit }
  | { kind: "round"; value: Record<string, unknown> };

export function Shepherding({ roles }: { roles: Role[] }) {
  const data = useShepherdingData(roles);
  const [tab, setTab] = useState("visits");
  const [filter, setFilter] = useState({ state: "", officer: "", round: "" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [completing, setCompleting] = useState<PastoralVisit | null>(null);
  const [roundId, setRoundId] = useState("");
  const now = new Date();
  const thisYear = DateTime.now().setZone(data.zone).year;
  const [range, setRange] = useState({
    from: `${thisYear}-01-01`,
    to: `${thisYear}-12-31`,
  });
  const household = (id: string) =>
    data.households.find((row) => row.id === id)?.name || "Household removed";
  const user = (uid: string) =>
    data.users.find((row) => row.id === uid)?.name || "Former account";
  const when = (iso: string) =>
    DateTime.fromISO(iso).setZone(data.zone).toFormat("LLL d, yyyy h:mm a");
  const officers = data.users
    .filter((row) => row.roles.some((role) => SESSION_ROLES.includes(role)))
    .map((row) => ({ id: row.id, name: row.name }));
  const deacons = data.users
    .filter((row) => row.roles.includes("deacon"))
    .map((row) => ({ id: row.id, name: row.name }));
  const rounds = data.rounds
    .filter((row) => !row.archived)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const visits = useMemo(
    () => [...data.visits].sort((a, b) => a.start.localeCompare(b.start)),
    [data.visits],
  );
  const shown = visits.filter(
    (row) =>
      (!filter.state || visitState(row, now) === filter.state) &&
      (!filter.officer || row.officerUids.includes(filter.officer)) &&
      (!filter.round || row.roundId === filter.round),
  );
  const visitRows: ReportRow[] = shown.map((row) => ({
    id: row.id,
    Household: household(row.householdId),
    When: when(row.start),
    State: stateLabels[visitState(row, now)],
    Officers: row.officerUids.map(user).join(", "),
    Deacons: row.deaconUids.map(user).join(", ") || "None",
    Round: data.rounds.find((round) => round.id === row.roundId)?.name || "",
    "Visit record": row.careNoteId ? "Linked" : "None",
  }));
  const workload = visitWorkload(visits, now, data.zone, range.from, range.to);
  const coverageHouseholds = visitableHouseholds(data.people, data.households);
  const coverage = roundId
    ? roundCoverage(roundId, visits, coverageHouseholds)
    : [];
  const planVisit = (preset: Record<string, unknown> = {}) =>
    setEditing({
      kind: "visit",
      value: {
        id: crypto.randomUUID(),
        expectedRevision: 0,
        householdId: "",
        start: "",
        durationMinutes: 60,
        location: "",
        officerUids: [],
        deaconUids: [],
        roundId: "",
        reminderHours: 24,
        purpose: "",
        ...preset,
      },
    });
  const editVisit = (visit: PastoralVisit) =>
    setEditing({
      kind: "visit",
      visit,
      value: {
        id: visit.id,
        expectedRevision: visit.revision,
        householdId: visit.householdId,
        start: churchLocalInput(visit.start, data.zone),
        durationMinutes: visit.durationMinutes,
        location: visit.location,
        officerUids: visit.officerUids,
        deaconUids: visit.deaconUids,
        roundId: visit.roundId,
        reminderHours: visit.reminderHours,
        purpose: visit.purpose,
        status: visit.status,
        cancelReason: visit.cancelReason,
      },
    });
  const showVisits = (next: Partial<typeof filter>) => {
    setFilter({ state: "", officer: "", round: "", ...next });
    setTab("visits");
  };
  const visitFields = (existing: boolean): EditorField[] => [
    {
      key: "householdId",
      label: "Household",
      kind: "select",
      required: true,
      options: [...data.households]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ id: row.id, name: row.name })),
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
      key: "officerUids",
      label: "Session officers",
      kind: "multi",
      options: officers,
    },
    {
      key: "deaconUids",
      label: "Invited deacons (see the time and place only)",
      kind: "multi",
      options: deacons,
    },
    {
      key: "roundId",
      label: "Visit round",
      kind: "select",
      options: rounds.map((row) => ({ id: row.id, name: row.name })),
    },
    {
      key: "reminderHours",
      label: "Reminder hours before (0 for none)",
      kind: "number",
    },
    { key: "purpose", label: "Purpose · Session only", kind: "textarea" },
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
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SHEPHERDING</span>
          <Title3 as="h1">
            <LockClosedRegular /> Shepherding
          </Title3>
          <p>
            Session only. Plan household visits, see each officer's work and
            find people who have not been contacted.
          </p>
        </div>
      </div>
      <MessageBar
        className="session-banner"
        intent="info"
        icon={<LockClosedRegular />}
      >
        Session only. Invited deacons see only the time and place of their
        visits.
      </MessageBar>
      {data.error && <MessageBar intent="error">{data.error}</MessageBar>}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="visits">Visits</Tab>
        <Tab value="workload">Workload</Tab>
        <Tab value="rounds">Visit rounds</Tab>
        <Tab value="contact">Contact gaps</Tab>
        <Tab value="locations">Locations and routes</Tab>
        <Tab value="health">Flock health</Tab>
      </TabList>
      {tab === "health" && <FlockHealth data={data} />}
      {tab === "contact" && <ContactGaps data={data} />}
      {tab === "locations" && <Locations data={data} />}
      {tab === "visits" && (
        <>
          <div className="report-filters">
            <Picker
              label="Visit state"
              value={filter.state}
              choices={Object.entries(stateLabels).map(([id, name]) => ({
                id,
                name,
              }))}
              onChange={(state) => setFilter({ ...filter, state })}
              empty="All states"
            />
            <Picker
              label="Officer"
              value={filter.officer}
              choices={officers}
              onChange={(officer) => setFilter({ ...filter, officer })}
              empty="All officers"
            />
            <Picker
              label="Round"
              value={filter.round}
              choices={data.rounds.map((row) => ({
                id: row.id,
                name: row.name,
              }))}
              onChange={(round) => setFilter({ ...filter, round })}
              empty="All rounds"
            />
            <Button appearance="primary" onClick={() => planVisit()}>
              Plan visit
            </Button>
          </div>
          <section className="surface table-card communication-panel session-panel">
            <div className="section-heading">
              <span>
                {shown.length} visit{shown.length === 1 ? "" : "s"}
                {!data.loaded && " · Loading"}
              </span>
              <ExportButton rows={visitRows} />
            </div>
            {!shown.length ? (
              <p>No visits match this view.</p>
            ) : (
              <TableScroll label="Visits">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(visitRows[0])
                        .filter((key) => key !== "id")
                        .map((key) => (
                          <th key={key}>{key}</th>
                        ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((visit, index) => (
                      <tr key={visit.id}>
                        {Object.entries(visitRows[index])
                          .filter(([key]) => key !== "id")
                          .map(([key, value]) => (
                            <td key={key}>{value}</td>
                          ))}
                        <td>
                          {visit.status !== "completed" && (
                            <Button
                              size="small"
                              onClick={() => editVisit(visit)}
                            >
                              Edit plan
                            </Button>
                          )}{" "}
                          {canCompleteVisit(visit, now) && (
                            <Button
                              size="small"
                              appearance="primary"
                              onClick={() => setCompleting(visit)}
                            >
                              Complete
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
        </>
      )}
      {tab === "workload" && (
        <>
          <div className="report-filters">
            <Field label="Finished from">
              <Input
                type="date"
                value={range.from}
                onChange={(_, value) =>
                  setRange({ ...range, from: value.value })
                }
              />
            </Field>
            <Field label="Finished through">
              <Input
                type="date"
                value={range.to}
                onChange={(_, value) => setRange({ ...range, to: value.value })}
              />
            </Field>
          </div>
          <p className="muted">
            Upcoming and overdue visits always count. Completed and cancelled
            visits count when they fall in the dates above. A planned visit is
            not contact until it is completed.
          </p>
          <section className="surface table-card communication-panel session-panel">
            <div className="section-heading">
              <span>Visit workload by officer</span>
              <ExportButton
                rows={workload.map((row) => ({
                  Officer: user(row.uid),
                  Upcoming: row.upcoming.length,
                  Overdue: row.overdue.length,
                  Completed: row.completed.length,
                  Cancelled: row.cancelled.length,
                }))}
              />
            </div>
            {!workload.length ? (
              <p>No visits are planned yet.</p>
            ) : (
              <TableScroll label="Visit workload by officer">
                <table>
                  <thead>
                    <tr>
                      <th>Officer</th>
                      {Object.values(stateLabels).map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {workload.map((row) => (
                      <tr key={row.uid}>
                        <td>{user(row.uid)}</td>
                        {(Object.keys(stateLabels) as VisitState[]).map(
                          (state) => (
                            <td key={state}>
                              <Button
                                appearance="transparent"
                                aria-label={`${stateLabels[state]} visits for ${user(row.uid)}`}
                                onClick={() =>
                                  showVisits({ state, officer: row.uid })
                                }
                              >
                                {row[state].length}
                              </Button>
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
        </>
      )}
      {tab === "rounds" && (
        <>
          <div className="report-filters">
            <Picker
              label="Visit round"
              value={roundId}
              choices={rounds.map((row) => ({ id: row.id, name: row.name }))}
              onChange={setRoundId}
            />
            <Button
              onClick={() =>
                setEditing({
                  kind: "round",
                  value: {
                    id: crypto.randomUUID(),
                    expectedRevision: 0,
                    name: `${thisYear} household visits`,
                    startDate: `${thisYear}-01-01`,
                    endDate: `${thisYear}-12-31`,
                    archived: false,
                  },
                })
              }
            >
              Add round
            </Button>
            {roundId && (
              <Button
                onClick={() => {
                  const round = data.rounds.find((row) => row.id === roundId)!;
                  setEditing({
                    kind: "round",
                    value: { ...round, expectedRevision: round.revision },
                  });
                }}
              >
                Edit round
              </Button>
            )}
          </div>
          {!roundId ? (
            <p>
              Choose a visit round to see which member and adherent households
              have been visited.
            </p>
          ) : (
            <>
              <p>
                Visited{" "}
                {coverage.filter((row) => row.state === "visited").length} of{" "}
                {coverage.length} households · Planned{" "}
                {coverage.filter((row) => row.state === "planned").length} · Not
                scheduled{" "}
                {coverage.filter((row) => row.state === "notScheduled").length}
              </p>
              <Records
                label="Visit round coverage"
                rows={coverage.map((row) => ({
                  id: row.householdId,
                  Household: household(row.householdId),
                  State:
                    row.state === "visited"
                      ? "Visited"
                      : row.state === "planned"
                        ? "Planned"
                        : "Not scheduled",
                  Visits: row.visitIds.length,
                }))}
                choose={(index) =>
                  coverage[index].state === "notScheduled"
                    ? planVisit({
                        householdId: coverage[index].householdId,
                        roundId,
                      })
                    : showVisits({ round: roundId })
                }
              />
            </>
          )}
        </>
      )}
      {editing?.kind === "visit" && (
        <RecordEditor
          title={
            editing.visit ? "Edit visit plan · Session only" : "Plan a visit"
          }
          fields={visitFields(!!editing.visit)}
          initial={editing.value}
          save={(value) =>
            saveVisit({
              ...value,
              start: localSchedule(String(value.start), data.zone),
              personIds: editing.visit?.personIds ?? [],
              followUpId: editing.visit?.followUpId ?? "",
              status: value.status || "planned",
            })
          }
          close={() => setEditing(null)}
        />
      )}
      {editing?.kind === "round" && (
        <RecordEditor
          title="Visit round"
          fields={[
            { key: "name", label: "Round name", required: true },
            {
              key: "startDate",
              label: "First day",
              kind: "date",
              required: true,
            },
            { key: "endDate", label: "Last day", kind: "date", required: true },
            { key: "archived", label: "Archived", kind: "checkbox" },
          ]}
          initial={editing.value}
          save={saveVisitRound}
          close={() => setEditing(null)}
        />
      )}
      {completing && (
        <CompleteVisit
          visit={completing}
          householdName={household(completing.householdId)}
          people={data.people
            .filter(
              (row) =>
                row.householdId === completing.householdId &&
                !row.isDeceased &&
                row.membershipStatus !== "former",
            )
            .map((row) => ({
              id: row.id,
              name: `${row.firstName} ${row.lastName}`,
            }))}
          notes={data.visitNotes
            .filter((note) =>
              data.people.some(
                (row) =>
                  row.id === note.personId &&
                  row.householdId === completing.householdId,
              ),
            )
            .map((note) => ({
              id: note.id,
              name: `${note.date} · ${
                data.people.find((row) => row.id === note.personId)
                  ?.firstName || "Person"
              }`,
            }))}
          close={() => setCompleting(null)}
        />
      )}
    </>
  );
}

function CompleteVisit({
  visit,
  householdName,
  people,
  notes,
  close,
}: {
  visit: PastoralVisit;
  householdName: string;
  people: { id: string; name: string }[];
  notes: { id: string; name: string }[];
  close: () => void;
}) {
  const [kind, setKind] = useState<"create" | "link" | "none">("create");
  const [personId, setPersonId] = useState(people[0]?.id || "");
  const [body, setBody] = useState("");
  const [careNoteId, setCareNoteId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await completeVisit({
        id: visit.id,
        expectedRevision: visit.revision,
        record:
          kind === "create"
            ? { kind, noteId: crypto.randomUUID(), personId, body }
            : kind === "link"
              ? { kind, careNoteId }
              : { kind },
      });
      close();
    } catch (failure) {
      setError(
        friendlyError(failure).startsWith("The record could not")
          ? "Choose a person and write the visit record, or choose another option."
          : friendlyError(failure),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !busy) close();
      }}
    >
      <DialogSurface className="record-dialog">
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>Complete visit with {householdName}</DialogTitle>
            <DialogContent>
              <p>A completed visit cannot be completed again.</p>
              <Field label="Visit record">
                <Select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as typeof kind)
                  }
                >
                  <option value="create">Write a visit record now</option>
                  <option value="link">Link an existing visit record</option>
                  <option value="none">Complete without a record</option>
                </Select>
              </Field>
              {kind === "create" && (
                <>
                  <Field label="Person" required>
                    <Select
                      value={personId}
                      onChange={(event) => setPersonId(event.target.value)}
                    >
                      {people.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Visit record · Session only" required>
                    <Textarea
                      rows={5}
                      required
                      value={body}
                      onChange={(_, data) => setBody(data.value)}
                    />
                  </Field>
                </>
              )}
              {kind === "link" && (
                <Field label="Recorded visit" required>
                  <Select
                    value={careNoteId}
                    onChange={(event) => setCareNoteId(event.target.value)}
                  >
                    <option value="">Choose</option>
                    {notes.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {error && <MessageBar intent="error">{error}</MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={busy}>
                {busy ? "Saving" : "Complete visit"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
