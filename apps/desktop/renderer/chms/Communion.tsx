import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
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
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  approvalOn,
  communionFlags,
  isOnline,
  statusLabels,
  type Role,
} from "@sycamore/shared";
import {
  approveCommunicants,
  saveCommunionDecision,
  saveCommunionRecord,
  useCommunionData,
} from "../data/records";
import { ActionTable, RecordEditor, friendlyError } from "./Common";

const longDate = (date: string) =>
  date ? DateTime.fromISO(date).toFormat("LLL d, yyyy") : "";

export function Communion({ roles, zone }: { roles: Role[]; zone: string }) {
  const data = useCommunionData(roles);
  const today = DateTime.now().setZone(zone).toISODate()!;
  const [tab, setTab] = useState("approved");
  const [asOf, setAsOf] = useState(today);
  const [deciding, setDeciding] = useState<Record<string, unknown> | null>(
    null,
  );
  const [bulk, setBulk] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const name = (id: string) => {
    const row = data.people.find((p) => p.id === id);
    return row
      ? `${row.preferredName || row.firstName} ${row.lastName}`
      : "Person removed";
  };
  const typeName = (id: string) =>
    data.types.find((row) => row.id === id)?.name || "Service";
  const decided = new Set(data.decisions.map((row) => row.personId));
  // Everyone on the roll, plus anyone the Session has ever decided about.
  const listed = data.people
    .filter(
      (row) =>
        decided.has(row.id) ||
        (!row.isDeceased &&
          !["former", "visitor"].includes(row.membershipStatus)),
    )
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
  const stateText = (personId: string, date: string) => {
    const state = approvalOn(data.decisions, personId, date);
    if (!state) return "No decision";
    if (!state.approved)
      return state.until && state.until < date ? "Visit ended" : "Not approved";
    return state.kind === "visiting"
      ? `Visiting communicant${state.until ? ` through ${longDate(state.until)}` : ""}`
      : "Approved";
  };
  const waiting = data.people.filter(
    (row) =>
      !row.isDeceased &&
      row.membershipStatus === "communicant" &&
      !data.decisions.some((decision) => decision.personId === row.id),
  );
  const services = [...data.services].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      a.serviceTypeId.localeCompare(b.serviceTypeId),
  );
  const service = services.find((row) => row.id === serviceId);
  const record = data.records.find((row) => row.serviceId === serviceId);
  useEffect(() => {
    setChosen(record?.personIds ?? []);
  }, [serviceId, record?.revision]);
  const candidates = service
    ? data.people
        .filter(
          (row) =>
            !row.isDeceased &&
            (row.membershipStatus !== "former" || !!service.present[row.id]),
        )
        .sort(
          (a, b) =>
            Number(!service.present[b.id]) - Number(!service.present[a.id]) ||
            a.lastName.localeCompare(b.lastName) ||
            a.firstName.localeCompare(b.firstName),
        )
    : [];
  const draftFlags = service
    ? communionFlags(
        { personIds: chosen, date: service.date },
        service,
        data.decisions,
      )
    : [];
  const records = [...data.records].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const decisions = [...data.decisions].sort(
    (a, b) =>
      b.effectiveOn.localeCompare(a.effectiveOn) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CHURCH RECORDS</span>
          <Title3 as="h1">Communion</Title3>
          <p>
            The Session's approved list and who partook at each service. Being a
            member or being present never adds anyone to the list.
          </p>
        </div>
      </div>
      {(error || data.error) && (
        <MessageBar intent="error">{error || data.error}</MessageBar>
      )}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <MessageBar
        className="session-banner"
        intent="info"
        icon={<LockClosedRegular />}
      >
        Session only. Admins, deacons and volunteers never see this list or who
        partook.
      </MessageBar>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="approved">Approved list</Tab>
        <Tab value="participation">Record participation</Tab>
        <Tab value="history">History</Tab>
      </TabList>
      {tab === "approved" && (
        <>
          <div className="service-bar">
            <Field label="As of">
              <Input
                type="date"
                value={asOf}
                onChange={(_, value) => setAsOf(value.value || today)}
              />
            </Field>
            {!!waiting.length && (
              <Button onClick={() => setBulk(true)}>
                Approve communicant members with no decision ({waiting.length})
              </Button>
            )}
          </div>
          <ActionTable
            session
            empty="No one is on the roll yet."
            rows={listed.map((row) => {
              const state = approvalOn(data.decisions, row.id, asOf);
              return {
                id: row.id,
                Name: name(row.id),
                Membership: statusLabels[row.membershipStatus],
                State: stateText(row.id, asOf),
                Since: state?.since || "",
              };
            })}
            actions={(index) => (
              <Button
                size="small"
                onClick={() =>
                  setDeciding({
                    id: crypto.randomUUID(),
                    personId: listed[index].id,
                    approved: "true",
                    kind:
                      listed[index].membershipStatus === "visitor"
                        ? "visiting"
                        : "member",
                    effectiveOn: today,
                    until: "",
                    note: "",
                  })
                }
              >
                Record decision
              </Button>
            )}
          />
        </>
      )}
      {tab === "participation" && (
        <>
          <div className="service-bar">
            <Field label="Service">
              <Select
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
              >
                <option value="">Choose a service</option>
                {services.map((row) => (
                  <option key={row.id} value={row.id}>
                    {longDate(row.date)} · {typeName(row.serviceTypeId)}
                    {data.records.some((r) => r.serviceId === row.id)
                      ? " · recorded"
                      : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {service && (
            <section className="surface communication-panel session-panel">
              <div className="section-heading">
                <h2>Who partook</h2>
                <span className="muted">
                  {chosen.length} chosen · present people are listed first
                </span>
              </div>
              <fieldset className="member-picker">
                <legend>People</legend>
                {candidates.map((row) => (
                  <Checkbox
                    key={row.id}
                    label={`${row.lastName}, ${row.preferredName || row.firstName}${
                      service.present[row.id]
                        ? isOnline(service.present[row.id])
                          ? " · online"
                          : " · present"
                        : ""
                    }${approvalOn(data.decisions, row.id, service.date)?.approved ? "" : " · not approved"}`}
                    checked={chosen.includes(row.id)}
                    onChange={(_, value) =>
                      setChosen((before) =>
                        value.checked
                          ? [...new Set([...before, row.id])]
                          : before.filter((id) => id !== row.id),
                      )
                    }
                  />
                ))}
              </fieldset>
              {!!draftFlags.length && (
                <MessageBar intent="warning">
                  Please check:{" "}
                  {draftFlags
                    .map(
                      (row) =>
                        `${name(row.personId)} (${row.flags.join(", ")})`,
                    )
                    .join("; ")}
                  .
                </MessageBar>
              )}
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void saveCommunionRecord({
                    serviceId,
                    expectedRevision: record?.revision ?? 0,
                    personIds: chosen,
                  })
                    .then(() =>
                      setNotice(
                        `Saved ${chosen.length} for ${longDate(service.date)}.`,
                      ),
                    )
                    .catch((cause) => setError(friendlyError(cause)))
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? "Saving" : "Save participation"}
              </Button>
            </section>
          )}
        </>
      )}
      {tab === "history" && (
        <>
          <h2>Communion services</h2>
          <ActionTable
            session
            empty="No communion participation recorded yet."
            rows={records.map((row) => {
              const at = data.services.find((s) => s.id === row.serviceId);
              const marks = at ? Object.values(at.present) : [];
              return {
                id: row.id,
                Date: row.date,
                Service: typeName(row.serviceTypeId),
                Partook: row.personIds.length,
                "Approved on that date": data.people.filter(
                  (p) => approvalOn(data.decisions, p.id, row.date)?.approved,
                ).length,
                "Present in person": marks.filter((m) => !isOnline(m)).length,
                "To check": communionFlags(row, at, data.decisions).length,
              };
            })}
          />
          <h2>Session decisions</h2>
          <ActionTable
            session
            empty="No decisions recorded yet."
            rows={decisions.map((row) => ({
              id: row.id,
              Name: name(row.personId),
              "Effective on": row.effectiveOn,
              Decision: row.approved
                ? row.kind === "visiting"
                  ? "Approved as a visiting communicant"
                  : "Approved"
                : "Not approved",
              "Last day": row.until,
              Note: row.note,
            }))}
          />
        </>
      )}
      {deciding && (
        <RecordEditor
          title={`Communion decision · ${name(String(deciding.personId))}`}
          fields={[
            {
              key: "approved",
              label: "Decision",
              kind: "select",
              required: true,
              options: [
                { id: "true", name: "Approved for the Lord's Table" },
                { id: "false", name: "Not approved" },
              ],
            },
            {
              key: "kind",
              label: "As",
              kind: "select",
              required: true,
              options: [
                { id: "member", name: "Member of this congregation" },
                { id: "visiting", name: "Visiting communicant" },
              ],
            },
            { key: "effectiveOn", label: "Effective on", kind: "date" },
            {
              key: "until",
              label: "Last day (visiting communicants only)",
              kind: "date",
            },
            { key: "note", label: "Note · Session only", kind: "textarea" },
          ]}
          initial={deciding}
          save={(value) =>
            saveCommunionDecision({
              ...value,
              personId: deciding.personId,
              approved: value.approved === "true",
            })
          }
          close={() => setDeciding(null)}
        />
      )}
      {bulk && (
        <Dialog open onOpenChange={(_, value) => !value.open && setBulk(false)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                Approve {waiting.length} communicant members
              </DialogTitle>
              <DialogContent>
                <p>
                  This records a Session decision, effective {longDate(today)},
                  for each living communicant member who has no decision yet:{" "}
                  {waiting.map((row) => name(row.id)).join(", ")}.
                </p>
                <p className="muted">
                  People with an earlier decision, including not approved, are
                  left as they are.
                </p>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setBulk(false)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setBulk(false);
                    void approveCommunicants({
                      batchId: crypto.randomUUID(),
                      personIds: waiting.map((row) => row.id),
                      effectiveOn: today,
                      note: "Approved together as communicant members",
                    })
                      .then((result) =>
                        setNotice(`Recorded ${result.created} approvals.`),
                      )
                      .catch((cause) => setError(friendlyError(cause)));
                  }}
                >
                  Record approvals
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </>
  );
}
