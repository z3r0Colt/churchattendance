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
  familyOf,
  familyTree,
  type FamilyMember,
  type Person,
  type Relationship,
} from "@sycamore/shared";
import {
  removeRelationship,
  saveRelationship,
  useRelationships,
} from "../data/records";
import { RecordEditor, friendlyError } from "./Common";

// Roles read from this person's side. Each maps to a stored, directed link.
const roles = {
  spouse: "Spouse",
  parent: "Parent of this person",
  child: "Child of this person",
  guardian: "Guardian of this person",
  ward: "In this person's care",
  sibling: "Sibling",
  other: "Other family",
} as const;
type RoleKey = keyof typeof roles;
function toLink(role: RoleKey, self: string, other: string) {
  switch (role) {
    case "parent":
      return { kind: "parent", personId: other, relatedPersonId: self };
    case "child":
      return { kind: "parent", personId: self, relatedPersonId: other };
    case "guardian":
      return { kind: "guardian", personId: other, relatedPersonId: self };
    case "ward":
      return { kind: "guardian", personId: self, relatedPersonId: other };
    default:
      return { kind: role, personId: self, relatedPersonId: other };
  }
}
function roleOf(row: Relationship, self: string): RoleKey {
  if (row.kind === "parent") return row.personId === self ? "child" : "parent";
  if (row.kind === "guardian")
    return row.personId === self ? "ward" : "guardian";
  return row.kind;
}
const longDate = (date: string) =>
  date ? DateTime.fromISO(date).toFormat("LLLL d, yyyy") : "";

export function Family({
  person,
  people,
  editor,
}: {
  person: Person;
  people: Person[];
  editor: boolean;
}) {
  const links = useRelationships();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [removing, setRemoving] = useState<Relationship | null>(null);
  const [error, setError] = useState("");
  const name = (id: string) => {
    const row = people.find((p) => p.id === id);
    return row
      ? `${row.preferredName || row.firstName} ${row.lastName}`
      : "Person removed";
  };
  const family = familyOf(person.id, links.rows, people);
  const tree = familyTree(person.id, links.rows);
  const groups: [string, FamilyMember[]][] = [
    ["Spouse", family.spouses],
    ["Parents", family.parents],
    ["Children", family.children],
    ["Brothers and sisters", family.siblings],
    ["Guardians", family.guardians],
    ["In their care", family.wards],
    ["Other family", family.other],
  ];
  const open = (row: Relationship | null) =>
    setEditing(
      row
        ? {
            id: row.id,
            expectedRevision: row.revision,
            role: roleOf(row, person.id),
            other:
              row.personId === person.id ? row.relatedPersonId : row.personId,
            label: row.label,
            startDate: row.startDate,
            endDate: row.endDate,
            addAnniversary: false,
          }
        : {
            id: crypto.randomUUID(),
            expectedRevision: 0,
            role: "spouse",
            other: "",
            label: "",
            startDate: "",
            endDate: "",
            addAnniversary: false,
          },
    );
  const chip = (id: string) => (
    <li key={id} className={id === person.id ? "tree-chip self" : "tree-chip"}>
      {name(id)}
      {people.find((p) => p.id === id)?.isDeceased ? " (deceased)" : ""}
    </li>
  );
  const generation = (label: string, ids: string[]) =>
    ids.length ? (
      <div className="tree-row">
        <span className="muted">{label}</span>
        <ul aria-label={label}>{ids.map(chip)}</ul>
      </div>
    ) : null;
  return (
    <div className="profile-grid">
      <div className="profile-main">
        <section className="surface communication-panel">
          <div className="section-heading">
            <h2>Family</h2>
            {editor && (
              <Button onClick={() => open(null)}>Add family link</Button>
            )}
          </div>
          <p className="muted">
            Family links are separate from households and give no one access to
            the directory or to care records.
          </p>
          {(error || links.error) && (
            <MessageBar intent="error">{error || links.error}</MessageBar>
          )}
          {groups.every(([, rows]) => !rows.length) ? (
            <p>No family links recorded yet.</p>
          ) : (
            <dl className="facts family-list">
              {groups
                .filter(([, rows]) => rows.length)
                .map(([label, rows]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <ul>
                        {rows.map((row) => {
                          const link = links.rows.find(
                            (l) => l.id === row.linkId,
                          );
                          return (
                            <li key={`${row.linkId}-${row.personId}`}>
                              <strong>{name(row.personId)}</strong>
                              {row.late ? " (deceased)" : ""}
                              {row.role === "Spouse" && row.since
                                ? ` · married ${longDate(row.since)}`
                                : row.since
                                  ? ` · since ${longDate(row.since)}`
                                  : ""}
                              {row.ended
                                ? ` · until ${longDate(row.ended)}`
                                : ""}
                              {row.role !== "Spouse" &&
                              ![
                                "Parent",
                                "Child",
                                "Sibling",
                                "Guardian",
                                "In their care",
                              ].includes(row.role)
                                ? ` · ${row.role}`
                                : ""}
                              {!row.linkId && (
                                <span className="muted">
                                  {" "}
                                  · shares a parent
                                </span>
                              )}
                              {editor && link && (
                                <>
                                  {" "}
                                  <Button
                                    size="small"
                                    onClick={() => open(link)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() => setRemoving(link)}
                                  >
                                    Remove
                                  </Button>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </dd>
                  </div>
                ))}
            </dl>
          )}
        </section>
      </div>
      <aside className="profile-side">
        <section className="surface communication-panel family-tree">
          <h2>Family tree</h2>
          {generation("Grandparents", tree.grandparents)}
          {generation("Parents", tree.parents)}
          <div className="tree-row">
            <span className="muted">This person</span>
            <ul aria-label="This person and spouse">
              {[person.id, ...tree.spouses].map(chip)}
            </ul>
          </div>
          {generation("Children", tree.children)}
          {generation("Grandchildren", tree.grandchildren)}
        </section>
      </aside>
      {editing && (
        <RecordEditor
          title={`Family link · ${name(person.id)}`}
          fields={[
            {
              key: "role",
              label: "Relationship",
              kind: "select",
              required: true,
              options: Object.entries(roles).map(([id, label]) => ({
                id,
                name: label,
              })),
            },
            {
              key: "other",
              label: "Family member",
              kind: "select",
              required: true,
              options: [...people]
                .filter((row) => row.id !== person.id)
                .sort((a, b) => a.lastName.localeCompare(b.lastName))
                .map((row) => ({
                  id: row.id,
                  name: `${row.lastName}, ${row.preferredName || row.firstName}${row.isDeceased ? " (deceased)" : ""}`,
                })),
            },
            { key: "label", label: "Name the relationship (for Other family)" },
            {
              key: "startDate",
              label: "Wedding date or start date (optional)",
              kind: "date",
            },
            { key: "endDate", label: "Ended on (optional)", kind: "date" },
            {
              key: "addAnniversary",
              label: "Keep a yearly wedding anniversary record",
              kind: "checkbox",
            },
          ]}
          initial={editing}
          save={(value) =>
            saveRelationship({
              id: value.id,
              expectedRevision: value.expectedRevision,
              ...toLink(value.role as RoleKey, person.id, String(value.other)),
              label: value.label,
              startDate: value.startDate,
              endDate: value.endDate,
              addAnniversary: value.addAnniversary,
            })
          }
          close={() => setEditing(null)}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(_, value) => !value.open && setRemoving(null)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove this family link</DialogTitle>
              <DialogContent>
                Remove only a link entered by mistake. To show that a marriage
                or guardianship ended, edit it and add the end date.
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setRemoving(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    const row = removing;
                    setRemoving(null);
                    void removeRelationship({
                      id: row.id,
                      expectedRevision: row.revision,
                    }).catch((cause) => setError(friendlyError(cause)));
                  }}
                >
                  Remove link
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </div>
  );
}
