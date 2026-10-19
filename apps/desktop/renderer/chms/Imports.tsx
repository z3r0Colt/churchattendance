import { useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Select,
  Title3,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  IMPORT_FILE_BYTES,
  IMPORT_ROW_LIMIT,
  guessMapping,
  importChanges,
  importFieldLabels,
  importFields,
  importUpdateFields,
  membershipStatuses,
  statusLabels,
  type ImportDecision,
  type ImportField,
  type PreviewRow,
} from "@sycamore/shared";
import {
  previewPeopleImport,
  readImportFile,
  runPeopleImport,
  useImportBatches,
  useImportRows,
  type ImportPreview,
} from "../data/imports";
import { ActionTable, Records, friendlyError } from "./Common";

type Choice = "" | "skip" | "create" | `update:${string}`;
const outcomeLabels: Record<string, string> = {
  pending: "Waiting",
  created: "Added",
  updated: "Updated",
  skipped: "Skipped",
  conflict: "Changed since preview",
  failed: "Failed",
};

export function Imports({ zone }: { zone: string }) {
  const today = DateTime.now().setZone(zone).toISODate()!;
  const batches = useImportBatches();
  const [file, setFile] = useState<{
    name: string;
    headers: string[];
    rows: string[][];
  } | null>(null);
  const [mapping, setMapping] = useState<(ImportField | "")[]>([]);
  const [status, setStatus] = useState<string>("");
  const [statusDate, setStatusDate] = useState(today);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [consent, setConsent] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openBatch, setOpenBatch] = useState("");
  const batchRows = useImportRows(openBatch);
  const reset = () => {
    setPreview(null);
    setChoices({});
    setNotice("");
  };
  async function choose(chosen: File | undefined) {
    setError("");
    reset();
    setFile(null);
    if (!chosen) return;
    if (chosen.size > IMPORT_FILE_BYTES)
      return setError("Choose a file smaller than 2 MB.");
    try {
      const sheet = await readImportFile(chosen);
      if (!sheet.rows.length)
        return setError("The file has a header row but no people.");
      if (sheet.rows.length > IMPORT_ROW_LIMIT)
        return setError(
          `The file has ${sheet.rows.length} rows. Split it into files of ${IMPORT_ROW_LIMIT} rows or fewer.`,
        );
      setFile({ name: chosen.name, ...sheet });
      setMapping(guessMapping(sheet.headers));
    } catch (cause) {
      setError(friendlyError(cause));
    }
  }
  const mapped = (row: string[]) =>
    Object.fromEntries(
      mapping
        .map((field, index) => [field, row[index] ?? ""] as const)
        .filter(([field]) => field),
    ) as Partial<Record<ImportField, string>>;
  const duplicateMapping = mapping.filter(
    (field, index) => field && mapping.indexOf(field) !== index,
  );
  const decision = (row: PreviewRow): ImportDecision | null => {
    const choice =
      choices[row.row] ??
      (row.errors.length ? "skip" : row.candidates.length ? "" : "create");
    if (!choice) return null;
    if (choice === "skip") return { action: "skip" };
    if (choice === "create")
      return { action: "create", confirmed: row.candidates.length > 0 };
    const personId = choice.slice("update:".length);
    const existing = preview!.people[personId];
    const changes = importChanges(row.value!, existing);
    return {
      action: "update",
      personId,
      expected: Object.fromEntries(
        importUpdateFields
          .filter((key) => key in changes)
          .map((key) => [key, existing[key]]),
      ),
    };
  };
  const undecided = preview?.rows.filter((row) => !decision(row)) ?? [];
  const counts = preview
    ? {
        create: preview.rows.filter((row) => decision(row)?.action === "create")
          .length,
        update: preview.rows.filter((row) => decision(row)?.action === "update")
          .length,
        skip: preview.rows.filter((row) => decision(row)?.action === "skip")
          .length,
      }
    : null;
  const name = (row: PreviewRow) =>
    row.value
      ? `${row.value.firstName} ${row.value.lastName}`
      : `${mapped(file!.rows[row.row - 1]).firstName ?? ""} ${mapped(file!.rows[row.row - 1]).lastName ?? ""}`.trim() ||
        "No name";
  const opened = batches.rows.find((row) => row.id === openBatch);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CHURCH RECORDS</span>
          <Title3 as="h1">Import people</Title3>
          <p>
            Bring people in from a CSV or Excel file. Nothing is saved until you
            have reviewed every row. Imports never set roles, care notes or
            communion approval.
          </p>
        </div>
      </div>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <section className="surface communication-panel">
        <h2>1. Choose a file</h2>
        <Field
          label="CSV or Excel file"
          hint={`The first row names the columns. Up to ${IMPORT_ROW_LIMIT} people and 2 MB. Formulas are never run.`}
        >
          <input
            type="file"
            accept=".csv,.xlsx"
            aria-label="CSV or Excel file"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </Field>
      </section>
      {file && (
        <section className="surface communication-panel">
          <h2>2. Match the columns</h2>
          <p className="muted">
            {file.rows.length} rows in {file.name}. Choose what each column
            holds, or leave it out.
          </p>
          <div className="import-mapping">
            {file.headers.map((header, index) => (
              <Field
                key={`${header}-${index}`}
                label={header || `Column ${index + 1}`}
              >
                <Select
                  value={mapping[index] ?? ""}
                  onChange={(event) => {
                    reset();
                    setMapping((before) =>
                      before.map((value, i) =>
                        i === index
                          ? (event.target.value as ImportField | "")
                          : value,
                      ),
                    );
                  }}
                >
                  <option value="">Leave out</option>
                  {importFields.map((field) => (
                    <option key={field} value={field}>
                      {importFieldLabels[field]}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="service-bar">
            <Field label="Status for rows without one">
              <Select
                value={status}
                onChange={(event) => {
                  reset();
                  setStatus(event.target.value);
                }}
              >
                <option value="">None, report the row</option>
                {membershipStatuses.map((id) => (
                  <option key={id} value={id}>
                    {statusLabels[id]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date for rows without a date received">
              <Input
                type="date"
                value={statusDate}
                onChange={(_, value) => {
                  reset();
                  setStatusDate(value.value || today);
                }}
              />
            </Field>
          </div>
          {!!duplicateMapping.length && (
            <MessageBar intent="warning">
              Each field can come from one column only.
            </MessageBar>
          )}
          <Button
            appearance="primary"
            disabled={
              !!busy ||
              !!duplicateMapping.length ||
              !mapping.includes("firstName") ||
              !mapping.includes("lastName")
            }
            onClick={() => {
              setBusy("preview");
              setError("");
              void previewPeopleImport({
                rows: file.rows.map(mapped),
                defaults: { status, statusDate },
              })
                .then((result) => {
                  setPreview(result);
                  setChoices({});
                })
                .catch((cause) => setError(friendlyError(cause)))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "preview" ? "Checking" : "Check rows"}
          </Button>
        </section>
      )}
      {file && preview && counts && (
        <>
          <section className="surface communication-panel">
            <h2>3. Review each row</h2>
            <p>
              {counts.create} to add, {counts.update} to update, {counts.skip}{" "}
              to skip
              {undecided.length
                ? `, ${undecided.length} waiting for your decision`
                : ""}
              . Nothing has been saved.
            </p>
          </section>
          <ActionTable
            empty="No rows."
            rows={preview.rows.map((row) => ({
              id: String(row.row),
              Row: row.row,
              Name: name(row),
              State: row.errors.length
                ? "Problem"
                : row.candidates.length
                  ? "Possible match"
                  : "Ready",
              Details: row.errors.length
                ? row.errors.join("; ")
                : row.candidates
                    .map(
                      (c) =>
                        `${c.reason}: ${preview.people[c.personId]?.name ?? c.personId}`,
                    )
                    .join("; "),
            }))}
            actions={(index) => {
              const row = preview.rows[index];
              const current =
                choices[row.row] ??
                (row.errors.length
                  ? "skip"
                  : row.candidates.length
                    ? ""
                    : "create");
              return (
                <Select
                  aria-label={`Decision for row ${row.row}`}
                  value={current}
                  disabled={!!row.errors.length}
                  onChange={(event) =>
                    setChoices((before) => ({
                      ...before,
                      [row.row]: event.target.value as Choice,
                    }))
                  }
                >
                  {!row.errors.length && row.candidates.length > 0 && (
                    <option value="">Choose</option>
                  )}
                  <option value="skip">
                    {row.errors.length ? "Skip, fix in the file" : "Skip"}
                  </option>
                  {!row.errors.length && (
                    <option value="create">
                      {row.candidates.length ? "Add as a new person" : "Add"}
                    </option>
                  )}
                  {row.candidates.map((c) => (
                    <option key={c.personId} value={`update:${c.personId}`}>
                      Update {preview.people[c.personId]?.name ?? c.personId}
                    </option>
                  ))}
                </Select>
              );
            }}
          />
          <section className="surface communication-panel">
            <h2>4. Messaging consent</h2>
            <p className="muted">
              Imported people receive no email or texts unless you reviewed
              evidence that they agreed. Updates never change anyone's consent,
              and a new mobile number turns texts off.
            </p>
            <Checkbox
              label="I reviewed consent evidence for the email and text consent columns"
              checked={consent}
              onChange={(_, value) => setConsent(value.checked === true)}
            />
            {consent && (
              <Field label="Where the consent came from" required>
                <Input
                  value={consentSource}
                  onChange={(_, value) => setConsentSource(value.value)}
                />
              </Field>
            )}
            <Button
              appearance="primary"
              disabled={
                !!busy ||
                !!undecided.length ||
                counts.create + counts.update === 0 ||
                (consent && !consentSource.trim())
              }
              onClick={() => {
                setBusy("import");
                setError("");
                setNotice("");
                void runPeopleImport(
                  {
                    batchId: crypto.randomUUID(),
                    fileName: file.name,
                    consentReviewed: consent,
                    consentSource: consent ? consentSource : "",
                    rows: preview.rows.map((row) => ({
                      row: row.row,
                      value: row.value ?? null,
                      problems: row.errors,
                      decision: decision(row)!,
                    })),
                  },
                  (left) => setNotice(`Saving. ${left} rows left.`),
                )
                  .then((batchId) => {
                    setNotice("Import finished. The results are below.");
                    setOpenBatch(batchId);
                    setFile(null);
                    reset();
                    setNotice("Import finished. The results are below.");
                  })
                  .catch((cause) => setError(friendlyError(cause)))
                  .finally(() => setBusy(""));
              }}
            >
              {busy === "import" ? "Importing" : "Import reviewed rows"}
            </Button>
          </section>
        </>
      )}
      <h2>Earlier imports</h2>
      <ActionTable
        empty="No imports yet."
        rows={[...batches.rows]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((row) => ({
            id: row.id,
            File: row.fileName,
            Date: row.createdAt.slice(0, 10),
            Added: row.created,
            Updated: row.updated,
            Skipped: row.skipped,
            "Needs review": row.conflict + row.failed,
            Waiting: row.pending,
          }))}
        actions={(index) => {
          const row = [...batches.rows].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          )[index];
          return (
            <>
              <Button size="small" onClick={() => setOpenBatch(row.id)}>
                Show rows
              </Button>
              {row.pending > 0 && (
                <Button
                  size="small"
                  disabled={!!busy}
                  onClick={() => {
                    setBusy("resume");
                    void runPeopleImport(row.id, (left) =>
                      setNotice(`Saving. ${left} rows left.`),
                    )
                      .then(() => setNotice("Import finished."))
                      .catch((cause) => setError(friendlyError(cause)))
                      .finally(() => setBusy(""));
                  }}
                >
                  Resume
                </Button>
              )}
            </>
          );
        }}
      />
      {opened && (
        <>
          <h2>Rows in {opened.fileName}</h2>
          <Records
            empty="No rows."
            rows={[...batchRows]
              .sort((a, b) => a.row - b.row)
              .map((row) => ({
                id: String(row.row),
                Row: row.row,
                Name: row.value
                  ? `${row.value.firstName} ${row.value.lastName}`
                  : "Could not be read",
                State: outcomeLabels[row.outcome] ?? row.outcome,
                "Person ID": row.personId,
                Message: row.message,
              }))}
          />
        </>
      )}
    </>
  );
}
