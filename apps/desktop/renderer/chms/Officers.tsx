import { useState } from "react";
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
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  TERM_REVIEW_DAYS,
  eligibilityRoles,
  membershipAt,
  membershipStatuses,
  officeConflicts,
  officeEndReasonLabels,
  officeEndReasons,
  officeRoleLabels,
  officeRoles,
  officeState,
  officeStateLabels,
  officerDecisionLabels,
  officerDecisions,
  officerEligibility,
  statusLabels,
  termReviews,
  type Office,
  type OfficerPolicy,
  type Role,
} from "@sycamore/shared";
import {
  removeOffice,
  saveOffice,
  saveOfficerDecision,
  saveOfficerPolicy,
  useOfficerData,
} from "../data/records";
import {
  ActionTable,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";
import { Quorum } from "./Quorum";

const resultLabels = {
  met: "Meets recorded criteria",
  notMet: "Does not meet",
  unknown: "Needs review",
};
type Role2 = (typeof eligibilityRoles)[number];
const defaultPolicy = (role: Role2): OfficerPolicy => ({
  role,
  statuses: ["communicant"],
  minimumAge: 0,
  minimumMemberYears: 0,
  excludeUnderDiscipline: true,
  source: "",
  revision: 0,
});

export function Officers({ roles, zone }: { roles: Role[]; zone: string }) {
  const data = useOfficerData(roles);
  const today = DateTime.now().setZone(zone).toISODate()!;
  const [tab, setTab] = useState("records");
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [removing, setRemoving] = useState<Office | null>(null);
  const [policyEdit, setPolicyEdit] = useState<OfficerPolicy | null>(null);
  const [decision, setDecision] = useState<Record<string, unknown> | null>(
    null,
  );
  const [role, setRole] = useState<Role2>("elder");
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState("");
  const name = (id: string) => {
    const row = data.people.find((p) => p.id === id);
    return row
      ? `${row.preferredName || row.firstName} ${row.lastName}`
      : "Person removed";
  };
  const people = [...data.people]
    .filter((row) => row.membershipStatus !== "visitor")
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
    .map((row) => ({
      id: row.id,
      name: `${row.lastName}, ${row.preferredName || row.firstName}${row.isDeceased ? " (deceased)" : ""}`,
    }));
  const conflicts = officeConflicts(data.offices, data.people);
  const offices = [...data.offices].sort(
    (a, b) =>
      officeRoles.indexOf(a.role) - officeRoles.indexOf(b.role) ||
      name(a.personId).localeCompare(name(b.personId)) ||
      (b.installedOn || b.ordainedOn).localeCompare(
        a.installedOn || a.ordainedOn,
      ),
  );
  const reviews = termReviews(data.offices, today);
  const policy =
    data.policies.find((row) => row.role === role) ?? defaultPolicy(role);
  const eligibility = officerEligibility({
    people: data.people,
    history: data.history,
    offices: data.offices,
    policy,
    decisions: data.decisions,
    disciplinedOn: data.disciplinedOn,
    statusOn: (person, date) => membershipAt(person, data.history, date),
    asOf,
  }).sort(
    (a, b) =>
      ["met", "unknown", "notMet"].indexOf(a.result) -
        ["met", "unknown", "notMet"].indexOf(b.result) ||
      name(a.personId).localeCompare(name(b.personId)),
  );
  const officeFields: EditorField[] = [
    {
      key: "personId",
      label: "Person",
      kind: "select",
      required: true,
      options: people,
    },
    {
      key: "role",
      label: "Office",
      kind: "select",
      required: true,
      options: officeRoles.map((id) => ({ id, name: officeRoleLabels[id] })),
    },
    { key: "ordainedOn", label: "Ordained on", kind: "date" },
    { key: "installedOn", label: "Installed here on", kind: "date" },
    {
      key: "termEndsOn",
      label: "Term ends on (leave empty for no term)",
      kind: "date",
    },
    { key: "endedOn", label: "Active service ended on", kind: "date" },
    {
      key: "endReason",
      label: "Why service ended",
      kind: "select",
      options: officeEndReasons.map((id) => ({
        id,
        name: officeEndReasonLabels[id],
      })),
    },
    { key: "emeritusOn", label: "Emeritus from", kind: "date" },
  ];
  const openOffice = (row: Office | null) =>
    setEditing(
      row
        ? { ...row, expectedRevision: row.revision }
        : {
            id: crypto.randomUUID(),
            expectedRevision: 0,
            personId: "",
            role: "elder",
            ordainedOn: "",
            installedOn: "",
            termEndsOn: "",
            endedOn: "",
            endReason: "",
            emeritusOn: "",
          },
    );
  const recordRows = offices.map((row) => ({
    id: row.id,
    Name: name(row.personId),
    Office: officeRoleLabels[row.role],
    State: officeStateLabels[officeState(row, today)],
    Ordained: row.ordainedOn,
    Installed: row.installedOn,
    "Term ends": row.termEndsOn,
    Ended: row.endedOn,
    "End reason": row.endReason ? officeEndReasonLabels[row.endReason] : "",
    Emeritus: row.emeritusOn,
    Check: conflicts
      .filter((problem) => problem.officeId === row.id)
      .map((problem) => problem.message)
      .join("; "),
  }));
  // Terms ending by year, so the Session can plan rotation ahead.
  const ending = Object.entries(
    data.offices
      .filter((row) => row.termEndsOn && officeState(row, today) === "serving")
      .reduce<Record<string, number>>((all, row) => {
        const key = `${row.termEndsOn.slice(0, 4)} · ${officeRoleLabels[row.role]}`;
        return { ...all, [key]: (all[key] || 0) + 1 };
      }, {}),
  ).sort();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CHURCH RECORDS</span>
          <Title3 as="h1">Officers</Title3>
          <p>
            Ordination, installation and terms of service. Eligibility lists
            restate recorded facts and Session decisions. They never decide a
            call to office.
          </p>
        </div>
        <Button appearance="primary" onClick={() => openOffice(null)}>
          Add office record
        </Button>
      </div>
      {(error || data.error) && (
        <MessageBar intent="error">{error || data.error}</MessageBar>
      )}
      <MessageBar
        className="session-banner"
        intent="info"
        icon={<LockClosedRegular />}
      >
        Session only. Office history is visible to staff on each person; terms,
        eligibility, decisions and quorum are kept here for the Session.
      </MessageBar>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="records">Office records</Tab>
        <Tab value="reviews">
          Term reviews{reviews.length ? ` (${reviews.length})` : ""}
        </Tab>
        <Tab value="eligibility">Eligibility</Tab>
        <Tab value="quorum">Quorum</Tab>
      </TabList>
      {tab === "records" && (
        <>
          {!!conflicts.length && (
            <MessageBar intent="warning">
              {conflicts.length} record
              {conflicts.length === 1 ? " needs" : "s need"} review. See the
              Check column.
            </MessageBar>
          )}
          <ActionTable
            label="Office records"
            session
            rows={recordRows}
            empty="No office records yet. Add each officer's ordination and installation."
            actions={(index) => (
              <>
                <Button size="small" onClick={() => openOffice(offices[index])}>
                  Edit
                </Button>
                <Button
                  size="small"
                  onClick={() => setRemoving(offices[index])}
                >
                  Remove
                </Button>
              </>
            )}
          />
        </>
      )}
      {tab === "reviews" && (
        <>
          <p className="muted">
            Serving officers whose term ends within {TERM_REVIEW_DAYS} days, or
            has passed without an end date. The daily officer summary gives the
            count and dates only.
          </p>
          <ActionTable
            label="Term reviews"
            session
            empty="No terms end in the next 60 days."
            rows={reviews.map((row) => ({
              id: row.id,
              Name: name(row.personId),
              Office: officeRoleLabels[row.role],
              "Term ends": row.termEndsOn,
              State: row.review === "overdue" ? "Overdue" : "Review due",
            }))}
            actions={(index) => (
              <Button size="small" onClick={() => openOffice(reviews[index])}>
                Record outcome
              </Button>
            )}
          />
          <section className="surface communication-panel session-panel">
            <h2>Terms ending by year</h2>
            {ending.length ? (
              <dl className="facts">
                {ending.map(([key, count]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">No serving officer has a recorded term.</p>
            )}
          </section>
        </>
      )}
      {tab === "eligibility" && (
        <>
          <div className="service-bar">
            <Field label="Office">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as Role2)}
              >
                {eligibilityRoles.map((id) => (
                  <option key={id} value={id}>
                    {officeRoleLabels[id]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="As of">
              <Input
                type="date"
                value={asOf}
                onChange={(_, value) => setAsOf(value.value || today)}
              />
            </Field>
          </div>
          <section className="surface communication-panel session-panel">
            <div className="section-heading">
              <h2>Recorded criteria</h2>
              <Button onClick={() => setPolicyEdit(policy)}>
                Edit criteria
              </Button>
            </div>
            <p>
              {policy.revision ? "" : "Not yet adopted. "}
              Status:{" "}
              {policy.statuses.map((status) => statusLabels[status]).join(", ")}
              {policy.minimumAge ? ` · Age ${policy.minimumAge} or older` : ""}
              {policy.minimumMemberYears
                ? ` · Member for ${policy.minimumMemberYears} years`
                : ""}
              {policy.excludeUnderDiscipline ? " · Not under discipline" : ""}
              {policy.source ? ` · ${policy.source}` : ""}
            </p>
            <p className="muted">
              Qualifications the records do not hold, such as the Session's
              judgment of character and gifts, belong in a Session decision.
            </p>
          </section>
          <ActionTable
            label="Recorded criteria"
            session
            empty="No one on the roll to review."
            rows={eligibility.map((row) => ({
              id: row.personId,
              Name: name(row.personId),
              State: resultLabels[row.result],
              Details: row.criteria
                .map((c) => `${c.label}: ${c.detail}`)
                .join(" · "),
              "Serving now": row.serving ? "Yes" : "",
              "Session decision": row.decision
                ? `${officerDecisionLabels[row.decision.decision]} on ${row.decision.decidedOn}`
                : "",
            }))}
            actions={(index) => (
              <Button
                size="small"
                onClick={() => {
                  const row = eligibility[index];
                  setDecision(
                    row.decision
                      ? {
                          ...row.decision,
                          expectedRevision: row.decision.revision,
                        }
                      : {
                          id: crypto.randomUUID(),
                          expectedRevision: 0,
                          personId: row.personId,
                          role,
                          decision: "approved",
                          decidedOn: today,
                          note: "",
                        },
                  );
                }}
              >
                Record decision
              </Button>
            )}
          />
        </>
      )}
      {tab === "quorum" && <Quorum data={data} today={today} name={name} />}
      {editing && (
        <RecordEditor
          title="Office record"
          fields={officeFields}
          initial={editing}
          save={saveOffice}
          close={() => {
            setEditing(null);
            data.refresh();
          }}
        />
      )}
      {decision && (
        <RecordEditor
          title={`Session decision · ${name(String(decision.personId))}`}
          fields={[
            {
              key: "decision",
              label: "Decision",
              kind: "select",
              required: true,
              options: officerDecisions.map((id) => ({
                id,
                name: officerDecisionLabels[id],
              })),
            },
            { key: "decidedOn", label: "Decided on", kind: "date" },
            { key: "note", label: "Note · Session only", kind: "textarea" },
          ]}
          initial={decision}
          save={(value) =>
            saveOfficerDecision({
              ...value,
              personId: decision.personId,
              role: decision.role,
            })
          }
          close={() => setDecision(null)}
        />
      )}
      {policyEdit && (
        <RecordEditor
          title={`${officeRoleLabels[policyEdit.role]} criteria`}
          fields={[
            {
              key: "statuses",
              label: "Qualifying membership statuses",
              kind: "multi",
              options: membershipStatuses
                .filter((id) => id !== "former")
                .map((id) => ({ id, name: statusLabels[id] })),
            },
            {
              key: "minimumAge",
              label: "Minimum age (0 for none)",
              kind: "number",
            },
            {
              key: "minimumMemberYears",
              label: "Minimum years as a member (0 for none)",
              kind: "number",
            },
            {
              key: "excludeUnderDiscipline",
              label: "Leave out people under discipline",
              kind: "checkbox",
            },
            {
              key: "source",
              label: "Where these criteria come from",
            },
          ]}
          initial={{ ...policyEdit, expectedRevision: policyEdit.revision }}
          save={(value) =>
            saveOfficerPolicy({ ...value, role: policyEdit.role })
          }
          close={() => setPolicyEdit(null)}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(_, value) => !value.open && setRemoving(null)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove this office record</DialogTitle>
              <DialogContent>
                {name(removing.personId)} · {officeRoleLabels[removing.role]}.
                Remove only a record entered by mistake. To show that service
                ended, edit it and add the end date.
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setRemoving(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    const row = removing;
                    setRemoving(null);
                    void removeOffice({
                      id: row.id,
                      personId: row.personId,
                      expectedRevision: row.revision,
                    })
                      .then(data.refresh)
                      .catch((cause) => setError(friendlyError(cause)));
                  }}
                >
                  Remove record
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </>
  );
}
