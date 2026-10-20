import { useState } from "react";
import { BrandingSettings } from "../communications/BrandingSettings";
import {
  Badge,
  Button,
  MessageBar,
  Subtitle2,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import {
  hasRole,
  saveChurchSettingsSchema,
  saveDistrictSchema,
  saveServiceTypeSchema,
  SESSION_ROLES,
  type ElderDistrict,
  type Person,
  type Role,
  type ServiceType,
} from "@sycamore/shared";
import { chmsCall, useCollection } from "../data/chms";
import {
  exportAdministration,
  useChurchSettings,
} from "../data/administration";
import {
  friendlyError,
  RecordEditor,
  Records,
  type EditorField,
} from "./Common";
export function Administration({ roles }: { roles: Role[] }) {
  const church = useChurchSettings(),
    types = useCollection<ServiceType & { revision?: number }>("serviceTypes"),
    districts = useCollection<ElderDistrict>("elderDistricts"),
    people = useCollection<Person>("people");
  const [editing, setEditing] = useState<{
      kind: "church" | "service" | "district";
      value: Record<string, unknown>;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const setup = hasRole(roles, ["admin", "pastor"]),
    admin = roles.includes("admin");
  if (!setup) return null;
  const fields: EditorField[] =
    editing?.kind === "church"
      ? [
          { key: "name", label: "Church name", required: true },
          { key: "address", label: "Church address", kind: "textarea" },
          { key: "timeZone", label: "IANA time zone", required: true },
        ]
      : editing?.kind === "service"
        ? [
            { key: "name", label: "Service name", required: true },
            {
              key: "dayOfWeek",
              label: "Day of week",
              kind: "select",
              options: [
                "Lord's Day",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((name, index) => ({ id: String(index), name })),
              required: true,
            },
            {
              key: "defaultTime",
              label: "Service time",
              kind: "time",
              required: true,
            },
            { key: "isActive", label: "Active", kind: "checkbox" },
          ]
        : [
            { key: "name", label: "District name", required: true },
            {
              key: "elderPersonId",
              label: "Shepherding elder",
              kind: "select",
              required: true,
              options: people.rows
                .filter(
                  (row) =>
                    !row.isDeceased &&
                    ["communicant", "nonResident"].includes(
                      row.membershipStatus,
                    ),
                )
                .map((row) => ({
                  id: row.id,
                  name: `${row.firstName} ${row.lastName}`,
                })),
            },
            { key: "archived", label: "Archived", kind: "checkbox" },
          ];
  return (
    <>
      {(error || church.error || types.error || districts.error) && (
        <MessageBar intent="error">
          {error || church.error || types.error || districts.error}
        </MessageBar>
      )}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <section className="surface communication-panel">
        <div className="section-heading">
          <Subtitle2>Church</Subtitle2>
          <Button
            disabled={!church.value}
            onClick={() =>
              church.value &&
              setEditing({
                kind: "church",
                value: {
                  ...church.value,
                  expectedRevision: church.value.revision,
                },
              })
            }
          >
            Edit church settings
          </Button>
        </div>
        <p>
          {church.value?.name} · {church.value?.timeZone}
        </p>
        <p>{church.value?.address || "Address not recorded"}</p>
        <p>
          Times for events, bulletin sends and reminders use this time zone.
          Existing event times remain fixed.
        </p>
      </section>
      {church.value && <BrandingSettings legacyName={church.value.name} />}
      <section className="surface communication-panel">
        <div className="section-heading">
          <Subtitle2>Service types</Subtitle2>
          <Button
            onClick={() =>
              setEditing({
                kind: "service",
                value: {
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  name: "",
                  dayOfWeek: 0,
                  defaultTime: "10:30",
                  isActive: true,
                },
              })
            }
          >
            Add service type
          </Button>
        </div>
        <p>
          Archive a service type by clearing Active. Existing attendance stays
          available.
        </p>
        <Records
          label="Service types"
          rows={types.rows.map((row) => ({
            id: row.id,
            Service: row.name,
            Day: [
              "Lord's Day",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ][row.dayOfWeek],
            Time: row.defaultTime,
            Active: row.isActive ? "Yes" : "No",
          }))}
          choose={(index) => {
            const row = types.rows[index];
            setEditing({
              kind: "service",
              value: { ...row, expectedRevision: row.revision || 0 },
            });
          }}
        />
      </section>
      <section className="surface communication-panel">
        <div className="section-heading">
          <Subtitle2>Elder districts</Subtitle2>
          <Button
            onClick={() =>
              setEditing({
                kind: "district",
                value: {
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  name: "",
                  elderPersonId: "",
                  archived: false,
                },
              })
            }
          >
            Add elder district
          </Button>
        </div>
        <p>
          Choose the elder's person record. Private absence alerts also require
          a linked account with a Session role.
        </p>
        <Records
          label="Elder districts"
          rows={districts.rows.map((row) => {
            const elder = people.rows.find(
              (person) => person.id === row.elderPersonId,
            );
            return {
              id: row.id,
              District: row.name,
              Elder: elder
                ? `${elder.firstName} ${elder.lastName}`
                : "Person unavailable",
              Archived: row.archived ? "Yes" : "No",
            };
          })}
          choose={(index) => {
            const row = districts.rows[index];
            setEditing({
              kind: "district",
              value: { ...row, expectedRevision: row.revision || 0 },
            });
          }}
        />
      </section>
      {admin && (
        <section className="surface communication-panel">
          <Subtitle2>Data archive</Subtitle2>
          {hasRole(roles, SESSION_ROLES) && (
            <Badge
              icon={<LockClosedRegular />}
              appearance="outline"
              color="important"
            >
              Session only records included
            </Badge>
          )}
          <p>
            {hasRole(roles, SESSION_ROLES)
              ? "Includes administrative and private Session records."
              : "Includes administrative records. Session records are excluded."}{" "}
            Save the workbook in a restricted location.
          </p>
          <p>
            This is a live, paged archive of document data. It excludes uploaded
            files, delivery queues, bulletin records and server operational
            data. Use managed Firestore backups for recovery.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              setNotice("");
              void exportAdministration(roles, setProgress)
                .then((saved) => {
                  if (saved)
                    setNotice(
                      "Archive saved. Its Summary sheet lists the exported collections and exclusions.",
                    );
                })
                .catch((error) => setError(friendlyError(error)))
                .finally(() => {
                  setBusy(false);
                  setProgress("");
                });
            }}
          >
            Export permitted records
          </Button>
          {busy && <p role="status">{progress}</p>}
        </section>
      )}
      {editing && (
        <RecordEditor
          title={
            editing.kind === "church"
              ? "Church settings"
              : editing.kind === "service"
                ? "Service type"
                : "Elder district"
          }
          initial={editing.value}
          fields={fields}
          close={() => setEditing(null)}
          save={async (value) => {
            if (editing.kind === "church")
              await chmsCall(
                "saveChurchSettings",
                saveChurchSettingsSchema.parse(value),
              );
            else if (editing.kind === "service")
              await chmsCall(
                "saveServiceType",
                saveServiceTypeSchema.parse({
                  ...value,
                  dayOfWeek:
                    value.dayOfWeek === ""
                      ? undefined
                      : Number(value.dayOfWeek),
                }),
              );
            else
              await chmsCall(
                "saveElderDistrict",
                saveDistrictSchema.parse(value),
              );
            setNotice("Saved");
          }}
        />
      )}
    </>
  );
}
