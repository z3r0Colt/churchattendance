import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
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
  WORKFLOW_TEMPLATES,
  bereavementDateKinds,
  conditionLabels,
  conditionTests,
  describeStep,
  importantDateLabels,
  mercyCategories,
  mercyCategoryLabels,
  ordinaryDateKinds,
  runStatusLabels,
  workflowProblems,
  workflowTriggerKinds,
  workflowTriggerLabels,
  type RunStatus,
  type WorkflowDraft,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowTrigger,
} from "@sycamore/shared";
import { ExportButton } from "../components/ExportButton";
import { chmsCall, usePublicChms, type Assignee } from "../data/chms";
import {
  controlWorkflow,
  controlWorkflowRun,
  decideWorkflowApproval,
  previewWorkflow,
  publishWorkflow,
  saveWorkflowDraft,
  useWorkflowData,
  type WorkflowPreview,
} from "../data/workflows";
import { Picker, friendlyError, TableScroll } from "./Common";

type Draft = WorkflowDraft & { revision: number };
const stepKinds: Record<WorkflowStep["kind"], string> = {
  message: "Send a message",
  task: "Assign a task",
  approval: "Ask for approval",
  wait: "Wait",
  condition: "Check a condition",
};
function newStep(kind: WorkflowStep["kind"], taken: string[]): WorkflowStep {
  let n = 1;
  while (taken.includes(`${kind}-${n}`)) n++;
  const id = `${kind}-${n}`;
  switch (kind) {
    case "wait":
      return { id, kind, days: 7 };
    case "condition":
      return { id, kind, test: "stillVisitor", onFalse: "end", skipTo: "" };
    case "task":
      return {
        id,
        kind,
        title: "Follow up",
        assignTo: "districtElder",
        uid: "",
        dueInDays: 3,
        waitForCompletion: false,
      };
    case "approval":
      return {
        id,
        kind,
        title: "Approve the next step",
        approverRoles: ["pastor", "clerk", "elder"],
        allowSelfApproval: false,
      };
    case "message":
      return {
        id,
        kind,
        channel: "email",
        subject: "A note from {ChurchName}",
        body: "Dear {FirstName},\n\n",
      };
  }
}
function defaultTrigger(kind: WorkflowTrigger["kind"]): WorkflowTrigger {
  switch (kind) {
    case "visitorRecorded":
      return { kind };
    case "membershipReceived":
      return { kind, statuses: ["communicant"] };
    case "requestApproved":
      return { kind, categories: [] };
    case "importantDate":
      return { kind, source: "importantDates", dateKinds: [], daysBefore: 7 };
  }
}
// Firestore does not keep map key order, so compare drafts with sorted keys.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const toggle = <T,>(list: T[], value: T, on: boolean) =>
  on ? [...new Set([...list, value])] : list.filter((item) => item !== value);

export function Workflows() {
  const { data, error: loadError } = useWorkflowData(true);
  const congregation = usePublicChms();
  const [users, setUsers] = useState<Assignee[]>([]);
  const [tab, setTab] = useState("workflows");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<WorkflowPreview | null>(null);
  const [filter, setFilter] = useState({ workflow: "", status: "" });
  const [openRun, setOpenRun] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void chmsCall<Assignee[]>("getCareAssignees", {})
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);
  const zone = congregation.zone;
  const name = (uid: string) =>
    uid === "system"
      ? "Scheduler"
      : users.find((row) => row.id === uid)?.name || "Former account";
  const names = Object.fromEntries(users.map((row) => [row.id, row.name]));
  const person = (id: string) => {
    const row = congregation.people.find((p) => p.id === id);
    return row ? `${row.firstName} ${row.lastName}` : "No person";
  };
  const saved = data?.workflows.find((row) => row.id === draft?.id);
  const dirty =
    !!draft &&
    (!saved ||
      stable({
        n: saved.name,
        d: saved.description,
        t: saved.trigger,
        s: saved.steps,
      }) !==
        stable({
          n: draft.name,
          d: draft.description,
          t: draft.trigger,
          s: draft.steps,
        }));
  const problems = draft ? workflowProblems(draft) : [];
  async function run(action: () => Promise<unknown>, done = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (done) setNotice(done);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }
  const open = (row: Draft) => {
    setDraft(structuredClone(row));
    setSelected(0);
    setPreview(null);
    setError("");
    setNotice("");
  };
  const steps = draft?.steps || [];
  const update = (index: number, step: WorkflowStep) =>
    draft &&
    setDraft({
      ...draft,
      steps: draft.steps.map((row, i) => (i === index ? step : row)),
    });
  const move = (index: number, by: -1 | 1) => {
    if (!draft) return;
    const next = [...draft.steps];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setDraft({ ...draft, steps: next });
    setSelected(index + by);
  };
  const assignable = users
    .filter((row) =>
      row.roles.some((role) =>
        ["pastor", "clerk", "elder", "deacon"].includes(role),
      ),
    )
    .map((row) => ({ id: row.id, name: row.name }));
  const step = steps[selected];
  const runs = useMemo(
    () =>
      (data?.runs || []).filter(
        (row) =>
          (!filter.workflow || row.workflowId === filter.workflow) &&
          (!filter.status || row.status === filter.status),
      ),
    [data, filter],
  );
  const workflowName = (id: string) =>
    data?.workflows.find((row) => row.id === id)?.name || "Removed workflow";
  const stepOf = (row: WorkflowRun) => {
    const version = data?.versions.find(
      (v) => v.workflowId === row.workflowId && v.version === row.version,
    );
    return version?.steps[row.stepIndex];
  };
  const when = (iso: string) =>
    DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy h:mm a");
  const runRows = runs.map((row) => ({
    id: row.id,
    Person: person(row.subject.personId),
    Workflow: workflowName(row.workflowId),
    Version: row.version,
    Status: runStatusLabels[row.status],
    "Current step": stepOf(row) ? describeStep(stepOf(row)!, names) : "Done",
    Next:
      row.status === "active"
        ? when(row.nextAt)
        : row.status === "blocked"
          ? row.error
          : "",
  }));
  const runControl = (row: WorkflowRun, action: string) =>
    run(
      () =>
        controlWorkflowRun({
          id: row.id,
          expectedRevision: row.revision,
          action,
        }),
      "Saved",
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CARE</span>
          <Title3 as="h1">
            <LockClosedRegular /> Care workflows
          </Title3>
          <p>
            Session only. Steps run in order from a trigger. Every message
            respects consent and opt-outs.
          </p>
        </div>
      </div>
      <MessageBar
        className="session-banner"
        intent="info"
        icon={<LockClosedRegular />}
      >
        Session only. Messages greet the person by name and never include notes,
        grief or discipline details.
      </MessageBar>
      {(error || loadError) && (
        <MessageBar intent="error">{error || loadError}</MessageBar>
      )}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="workflows">Workflows</Tab>
        <Tab value="runs">
          Runs
          {data?.runs.some(
            (row) =>
              row.status === "waiting" && row.waitingFor?.kind === "approval",
          )
            ? " · approvals waiting"
            : ""}
        </Tab>
      </TabList>
      {tab === "workflows" && !draft && (
        <>
          <div className="report-filters">
            {(
              Object.keys(
                WORKFLOW_TEMPLATES,
              ) as (keyof typeof WORKFLOW_TEMPLATES)[]
            ).map((key) => (
              <Button
                key={key}
                onClick={() =>
                  open({
                    id: crypto.randomUUID(),
                    revision: 0,
                    ...structuredClone(WORKFLOW_TEMPLATES[key]),
                  })
                }
              >
                New from template: {WORKFLOW_TEMPLATES[key].name}
              </Button>
            ))}
          </div>
          <section className="surface table-card communication-panel session-panel">
            <div className="section-heading">
              <span>
                {data?.workflows.length || 0} workflow
                {data?.workflows.length === 1 ? "" : "s"}
              </span>
            </div>
            {!data?.workflows.length ? (
              <p>No workflows yet. Start from a template above.</p>
            ) : (
              <TableScroll label="Workflows">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Trigger</th>
                      <th>Status</th>
                      <th>Active version</th>
                      <th>Open runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workflows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Button
                            appearance="transparent"
                            onClick={() => open(row)}
                          >
                            {row.name}
                          </Button>
                        </td>
                        <td>{workflowTriggerLabels[row.trigger.kind]}</td>
                        <td>
                          {
                            {
                              draft: "Draft",
                              active: "Active",
                              paused: "Paused",
                              archived: "Archived",
                            }[row.status]
                          }
                        </td>
                        <td>{row.publishedVersion || "None"}</td>
                        <td>
                          {
                            data.runs.filter(
                              (r) =>
                                r.workflowId === row.id &&
                                !["completed", "cancelled"].includes(r.status),
                            ).length
                          }
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
      {tab === "workflows" && draft && (
        <section className="surface communication-panel session-panel">
          <div className="section-heading">
            <span>
              {saved
                ? `Editing · ${saved.status === "draft" ? "Draft" : `Version ${saved.publishedVersion} is ${saved.status}`}`
                : "New workflow"}
              {dirty ? " · Unsaved changes" : ""}
            </span>
            <Button onClick={() => setDraft(null)}>Back to workflows</Button>
          </div>
          <div className="report-filters">
            <Field label="Workflow name" required>
              <Input
                value={draft.name}
                onChange={(_, value) =>
                  setDraft({ ...draft, name: value.value })
                }
              />
            </Field>
            <Field label="Description">
              <Input
                value={draft.description}
                onChange={(_, value) =>
                  setDraft({ ...draft, description: value.value })
                }
              />
            </Field>
          </div>
          <fieldset className="workflow-fieldset">
            <legend>Trigger</legend>
            <Field label="Start this workflow when">
              <Select
                value={draft.trigger.kind}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    trigger: defaultTrigger(
                      event.target.value as WorkflowTrigger["kind"],
                    ),
                  })
                }
              >
                {workflowTriggerKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {workflowTriggerLabels[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.trigger.kind === "membershipReceived" &&
              (["communicant", "baptized"] as const).map((status) => (
                <Checkbox
                  key={status}
                  label={
                    status === "communicant"
                      ? "Received as a Communicant Member"
                      : "Received as a Baptized Member"
                  }
                  checked={
                    draft.trigger.kind === "membershipReceived" &&
                    draft.trigger.statuses.includes(status)
                  }
                  onChange={(_, value) =>
                    draft.trigger.kind === "membershipReceived" &&
                    setDraft({
                      ...draft,
                      trigger: {
                        ...draft.trigger,
                        statuses: toggle(
                          draft.trigger.statuses,
                          status,
                          value.checked === true,
                        ),
                      },
                    })
                  }
                />
              ))}
            {draft.trigger.kind === "requestApproved" && (
              <>
                <p className="muted">
                  Leave every kind unticked to include all practical help.
                </p>
                {mercyCategories.map((category) => (
                  <Checkbox
                    key={category}
                    label={mercyCategoryLabels[category]}
                    checked={
                      draft.trigger.kind === "requestApproved" &&
                      draft.trigger.categories.includes(category)
                    }
                    onChange={(_, value) =>
                      draft.trigger.kind === "requestApproved" &&
                      setDraft({
                        ...draft,
                        trigger: {
                          ...draft.trigger,
                          categories: toggle(
                            draft.trigger.categories,
                            category,
                            value.checked === true,
                          ),
                        },
                      })
                    }
                  />
                ))}
              </>
            )}
            {draft.trigger.kind === "importantDate" && (
              <>
                <Field label="Dates from">
                  <Select
                    value={draft.trigger.source}
                    onChange={(event) =>
                      draft.trigger.kind === "importantDate" &&
                      setDraft({
                        ...draft,
                        trigger: {
                          ...draft.trigger,
                          source: event.target.value as
                            "importantDates" | "bereavementDates",
                          dateKinds: [],
                        },
                      })
                    }
                  >
                    <option value="importantDates">Anniversaries</option>
                    <option value="bereavementDates">
                      Bereavement dates (Session only)
                    </option>
                  </Select>
                </Field>
                {(draft.trigger.source === "importantDates"
                  ? ordinaryDateKinds
                  : bereavementDateKinds
                ).map((kind) => (
                  <Checkbox
                    key={kind}
                    label={importantDateLabels[kind]}
                    checked={
                      draft.trigger.kind === "importantDate" &&
                      draft.trigger.dateKinds.includes(kind)
                    }
                    onChange={(_, value) =>
                      draft.trigger.kind === "importantDate" &&
                      setDraft({
                        ...draft,
                        trigger: {
                          ...draft.trigger,
                          dateKinds: toggle(
                            draft.trigger.dateKinds,
                            kind,
                            value.checked === true,
                          ),
                        },
                      })
                    }
                  />
                ))}
                <Field label="Start this many days before the date (0 to 30)">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={String(draft.trigger.daysBefore)}
                    onChange={(_, value) =>
                      draft.trigger.kind === "importantDate" &&
                      setDraft({
                        ...draft,
                        trigger: {
                          ...draft.trigger,
                          daysBefore: Number(value.value),
                        },
                      })
                    }
                  />
                </Field>
              </>
            )}
          </fieldset>
          <div className="workflow-builder">
            <div>
              <h2 className="workflow-heading" id="workflow-steps">
                Steps
              </h2>
              <ol className="workflow-steps" aria-labelledby="workflow-steps">
                {steps.map((row, index) => (
                  <li
                    key={row.id}
                    className={index === selected ? "selected" : undefined}
                  >
                    <Button
                      appearance="transparent"
                      aria-current={index === selected}
                      onClick={() => setSelected(index)}
                    >
                      {index + 1}. {describeStep(row, names)}
                    </Button>
                    <span>
                      <Button
                        size="small"
                        disabled={index === 0}
                        aria-label={`Move step ${index + 1} earlier`}
                        onClick={() => move(index, -1)}
                      >
                        Earlier
                      </Button>
                      <Button
                        size="small"
                        disabled={index === steps.length - 1}
                        aria-label={`Move step ${index + 1} later`}
                        onClick={() => move(index, 1)}
                      >
                        Later
                      </Button>
                      <Button
                        size="small"
                        disabled={steps.length === 1}
                        aria-label={`Remove step ${index + 1}`}
                        onClick={() => {
                          setDraft({
                            ...draft,
                            steps: steps.filter((_, i) => i !== index),
                          });
                          setSelected(Math.max(0, index - 1));
                        }}
                      >
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
              <Field label="Add a step">
                <Select
                  value=""
                  disabled={steps.length >= 20}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    const added = newStep(
                      event.target.value as WorkflowStep["kind"],
                      steps.map((row) => row.id),
                    );
                    setDraft({ ...draft, steps: [...steps, added] });
                    setSelected(steps.length);
                  }}
                >
                  <option value="">Choose a kind of step</option>
                  {Object.entries(stepKinds).map(([kind, label]) => (
                    <option key={kind} value={kind}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              {step && (
                <fieldset className="workflow-fieldset">
                  <legend>
                    Step {selected + 1} · {stepKinds[step.kind]}
                  </legend>
                  {step.kind === "wait" && (
                    <Field label="Days to wait (1 to 365)">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={String(step.days)}
                        onChange={(_, value) =>
                          update(selected, {
                            ...step,
                            days: Number(value.value),
                          })
                        }
                      />
                    </Field>
                  )}
                  {step.kind === "condition" && (
                    <>
                      <Field label="Continue only if">
                        <Select
                          value={step.test}
                          onChange={(event) =>
                            update(selected, {
                              ...step,
                              test: event.target.value as typeof step.test,
                            })
                          }
                        >
                          {conditionTests.map((test) => (
                            <option key={test} value={test}>
                              {conditionLabels[test]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Otherwise">
                        <Select
                          value={step.onFalse === "end" ? "" : step.skipTo}
                          onChange={(event) =>
                            update(selected, {
                              ...step,
                              onFalse: event.target.value ? "skipTo" : "end",
                              skipTo: event.target.value,
                            })
                          }
                        >
                          <option value="">End the run</option>
                          {steps.slice(selected + 1).map((row, offset) => (
                            <option key={row.id} value={row.id}>
                              Skip to step {selected + offset + 2}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  )}
                  {(step.kind === "task" || step.kind === "approval") && (
                    <Field label="Title (shown to the assignee; no private details)">
                      <Input
                        value={step.title}
                        onChange={(_, value) =>
                          update(selected, { ...step, title: value.value })
                        }
                      />
                    </Field>
                  )}
                  {step.kind === "task" && (
                    <>
                      <Field label="Assign to">
                        <Select
                          value={step.assignTo}
                          onChange={(event) =>
                            update(selected, {
                              ...step,
                              assignTo: event.target
                                .value as typeof step.assignTo,
                            })
                          }
                        >
                          <option value="districtElder">
                            The person's district elder
                          </option>
                          <option value="account">A chosen officer</option>
                          <option value="requestDeacons">
                            The request's deacons
                          </option>
                        </Select>
                      </Field>
                      {step.assignTo === "account" && (
                        <Picker
                          label="Officer"
                          value={step.uid}
                          choices={assignable}
                          onChange={(uid) => update(selected, { ...step, uid })}
                        />
                      )}
                      <Field label="Due in days (0 to 60)">
                        <Input
                          type="number"
                          min={0}
                          max={60}
                          value={String(step.dueInDays)}
                          onChange={(_, value) =>
                            update(selected, {
                              ...step,
                              dueInDays: Number(value.value),
                            })
                          }
                        />
                      </Field>
                      <Checkbox
                        label="Wait until the task is done before the next step"
                        checked={step.waitForCompletion}
                        onChange={(_, value) =>
                          update(selected, {
                            ...step,
                            waitForCompletion: value.checked === true,
                          })
                        }
                      />
                    </>
                  )}
                  {step.kind === "approval" && (
                    <>
                      {(["pastor", "clerk", "elder"] as const).map((role) => (
                        <Checkbox
                          key={role}
                          label={`${role[0].toUpperCase()}${role.slice(1)} may approve`}
                          checked={step.approverRoles.includes(role)}
                          onChange={(_, value) =>
                            update(selected, {
                              ...step,
                              approverRoles: toggle(
                                step.approverRoles,
                                role,
                                value.checked === true,
                              ),
                            })
                          }
                        />
                      ))}
                      <Checkbox
                        label="The person who started the run may approve it"
                        checked={step.allowSelfApproval}
                        onChange={(_, value) =>
                          update(selected, {
                            ...step,
                            allowSelfApproval: value.checked === true,
                          })
                        }
                      />
                    </>
                  )}
                  {step.kind === "message" && (
                    <>
                      <Field label="Channel">
                        <Select
                          value={step.channel}
                          onChange={(event) =>
                            update(selected, {
                              ...step,
                              channel: event.target.value as "email" | "sms",
                            })
                          }
                        >
                          <option value="email">Email</option>
                          <option value="sms">Text</option>
                        </Select>
                      </Field>
                      {step.channel === "email" && (
                        <Field label="Subject">
                          <Input
                            value={step.subject}
                            onChange={(_, value) =>
                              update(selected, {
                                ...step,
                                subject: value.value,
                              })
                            }
                          />
                        </Field>
                      )}
                      <Field
                        label="Message"
                        hint="Use only {FirstName}, {LastName} and {ChurchName}. Never include care, grief or discipline details."
                      >
                        <Textarea
                          rows={5}
                          value={step.body}
                          onChange={(_, value) =>
                            update(selected, { ...step, body: value.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                </fieldset>
              )}
            </div>
            <div>
              <h2 className="workflow-heading" id="workflow-diagram">
                Diagram
              </h2>
              <ol className="flow" aria-labelledby="workflow-diagram">
                <li className="flow-node flow-trigger">
                  {workflowTriggerLabels[draft.trigger.kind]}
                </li>
                {steps.map((row, index) => (
                  <li key={row.id} className="flow-item">
                    <span className="flow-arrow" aria-hidden="true">
                      ↓
                    </span>
                    <button
                      type="button"
                      className={`flow-node flow-${row.kind}${index === selected ? " selected" : ""}`}
                      aria-label={`Step ${index + 1}: ${describeStep(row, names)}`}
                      onClick={() => setSelected(index)}
                    >
                      <strong>{stepKinds[row.kind]}</strong>
                      <span>{describeStep(row, names)}</span>
                    </button>
                    {row.kind === "condition" && (
                      <span className="flow-branch">
                        If not:{" "}
                        {row.onFalse === "end"
                          ? "end"
                          : `skip to step ${steps.findIndex((s) => s.id === row.skipTo) + 1}`}
                      </span>
                    )}
                    {(row.kind === "approval" ||
                      (row.kind === "task" && row.waitForCompletion)) && (
                      <span className="flow-branch">
                        {row.kind === "approval"
                          ? "Waits for a decision; declining ends the run"
                          : "Waits until the task is done"}
                      </span>
                    )}
                  </li>
                ))}
                <li className="flow-item">
                  <span className="flow-arrow" aria-hidden="true">
                    ↓
                  </span>
                  <span className="flow-node flow-end">Finished</span>
                </li>
              </ol>
            </div>
          </div>
          {problems.length > 0 && (
            <MessageBar intent="warning">
              Before activating: {problems.join(" ")}
            </MessageBar>
          )}
          <div className="report-filters">
            <Button
              appearance="primary"
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  await saveWorkflowDraft({
                    id: draft.id,
                    expectedRevision: saved?.revision ?? draft.revision,
                    name: draft.name,
                    description: draft.description,
                    trigger: draft.trigger,
                    steps: draft.steps,
                  });
                  setDraft({
                    ...draft,
                    revision: (saved?.revision ?? draft.revision) + 1,
                  });
                  setPreview(null);
                }, "Draft saved")
              }
            >
              Save draft
            </Button>
            <Button
              disabled={busy || dirty || !saved}
              onClick={() =>
                run(async () => setPreview(await previewWorkflow(draft.id)))
              }
            >
              Preview
            </Button>
            {saved &&
              saved.status !== "draft" &&
              saved.status !== "archived" && (
                <Button
                  disabled={busy || dirty}
                  onClick={() =>
                    run(
                      () =>
                        controlWorkflow({
                          id: saved.id,
                          expectedRevision: saved.revision,
                          action:
                            saved.status === "paused" ? "resume" : "pause",
                        }),
                      saved.status === "paused" ? "Resumed" : "Paused",
                    )
                  }
                >
                  {saved.status === "paused"
                    ? "Resume workflow"
                    : "Pause workflow"}
                </Button>
              )}
            {saved && saved.status !== "archived" && (
              <Button
                disabled={busy || dirty}
                onClick={() =>
                  run(
                    () =>
                      controlWorkflow({
                        id: saved.id,
                        expectedRevision: saved.revision,
                        action: "archive",
                      }),
                    "Archived",
                  )
                }
              >
                Archive
              </Button>
            )}
          </div>
          {saved && saved.publishedVersion > 0 && (
            <p className="muted">
              Running people keep the version they started with. Saving a draft
              changes nothing until it is previewed and activated.
            </p>
          )}
          {preview && (
            <section
              className="surface communication-panel"
              aria-label="Workflow preview"
            >
              <h2 className="workflow-heading">Preview before activating</h2>
              <p>Trigger: {preview.trigger}.</p>
              <p>{preview.enrollment}</p>
              {preview.upcoming.length > 0 && (
                <ul>
                  {preview.upcoming.map((row) => (
                    <li key={`${row.personId}_${row.date}`}>
                      {row.name}: starts {row.startsOn} for {row.date}
                    </li>
                  ))}
                </ul>
              )}
              <ol>
                {preview.steps.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
              {preview.messages.map((message) => (
                <article key={message.stepId} className="workflow-message">
                  <strong>
                    {message.channel === "email" ? "Email" : "Text"}
                    {message.subject ? `: ${message.subject}` : ""}
                  </strong>
                  <p>{message.body}</p>
                </article>
              ))}
              {preview.problems.length > 0 ? (
                <MessageBar intent="warning">
                  {preview.problems.join(" ")}
                </MessageBar>
              ) : (
                <Button
                  appearance="primary"
                  disabled={
                    busy || dirty || preview.revision !== saved?.revision
                  }
                  onClick={() =>
                    run(async () => {
                      await publishWorkflow({
                        id: draft.id,
                        expectedRevision: preview.revision,
                        confirmPreview: true,
                      });
                      setPreview(null);
                    }, "Activated")
                  }
                >
                  Activate version {(saved?.publishedVersion || 0) + 1}
                </Button>
              )}
            </section>
          )}
        </section>
      )}
      {tab === "runs" && (
        <>
          <div className="report-filters">
            <Picker
              label="Workflow"
              value={filter.workflow}
              choices={(data?.workflows || []).map((row) => ({
                id: row.id,
                name: row.name,
              }))}
              onChange={(workflow) => setFilter({ ...filter, workflow })}
              empty="All workflows"
            />
            <Picker
              label="Run status"
              value={filter.status}
              choices={Object.entries(runStatusLabels).map(([id, label]) => ({
                id,
                name: label,
              }))}
              onChange={(status) => setFilter({ ...filter, status })}
              empty="All statuses"
            />
          </div>
          <section className="surface table-card communication-panel session-panel">
            <div className="section-heading">
              <span>
                {runs.length} run{runs.length === 1 ? "" : "s"}
              </span>
              <ExportButton rows={runRows} />
            </div>
            {!runs.length ? (
              <p>No runs match this view.</p>
            ) : (
              <TableScroll label="Workflow runs">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(runRows[0])
                        .filter((key) => key !== "id")
                        .map((key) => (
                          <th key={key}>{key}</th>
                        ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((row, index) => {
                      const latest =
                        data?.workflows.find((w) => w.id === row.workflowId)
                          ?.publishedVersion || 0;
                      const status = row.status as RunStatus;
                      const finished =
                        status === "completed" || status === "cancelled";
                      return (
                        <tr key={row.id}>
                          {Object.entries(runRows[index])
                            .filter(([key]) => key !== "id")
                            .map(([key, value]) => (
                              <td key={key}>{value}</td>
                            ))}
                          <td>
                            <Button
                              size="small"
                              onClick={() =>
                                setOpenRun(openRun === row.id ? "" : row.id)
                              }
                            >
                              {openRun === row.id ? "Hide history" : "History"}
                            </Button>
                            {status === "waiting" &&
                              row.waitingFor?.kind === "approval" && (
                                <>
                                  <Button
                                    size="small"
                                    appearance="primary"
                                    onClick={() =>
                                      run(
                                        () =>
                                          decideWorkflowApproval({
                                            id: row.id,
                                            expectedRevision: row.revision,
                                            decision: "approve",
                                          }),
                                        "Approved",
                                      )
                                    }
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() =>
                                      run(
                                        () =>
                                          decideWorkflowApproval({
                                            id: row.id,
                                            expectedRevision: row.revision,
                                            decision: "reject",
                                          }),
                                        "Declined",
                                      )
                                    }
                                  >
                                    Decline
                                  </Button>
                                </>
                              )}
                            {status === "blocked" && (
                              <Button
                                size="small"
                                onClick={() => runControl(row, "retry")}
                              >
                                Retry
                              </Button>
                            )}
                            {!finished && status !== "paused" && (
                              <Button
                                size="small"
                                onClick={() => runControl(row, "pause")}
                              >
                                Pause
                              </Button>
                            )}
                            {status === "paused" && (
                              <Button
                                size="small"
                                onClick={() => runControl(row, "resume")}
                              >
                                Resume
                              </Button>
                            )}
                            {!finished && (
                              <Button
                                size="small"
                                onClick={() => runControl(row, "cancel")}
                              >
                                Cancel run
                              </Button>
                            )}
                            {!finished && latest > row.version && (
                              <Button
                                size="small"
                                onClick={() => runControl(row, "migrate")}
                              >
                                Move to version {latest}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
          {openRun && (
            <section
              className="surface communication-panel"
              aria-label="Run history"
            >
              <h2 className="workflow-heading">What happened</h2>
              <ol>
                {(
                  data?.runs.find((row) => row.id === openRun)?.history || []
                ).map((entry, index) => (
                  <li key={index}>
                    {when(entry.at)} · {entry.detail} ({entry.outcome}, by{" "}
                    {name(entry.by)})
                  </li>
                ))}
              </ol>
              <p className="muted">
                Messages already queued before a pause are listed here. A paused
                or cancelled run sends nothing further.
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
