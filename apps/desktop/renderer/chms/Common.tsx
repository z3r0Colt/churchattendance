import { useState, type FormEvent, type ReactNode } from "react";
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
  Textarea,
} from "@fluentui/react-components";
import { ExportButton } from "../components/ExportButton";
import { ReauthHost } from "../security/Reauth";
import { columnLabel, displayValue, statusTone } from "@sycamore/shared";
import type { ReportRow } from "@sycamore/shared";
export type Choice = { id: string; name: string };
export type EditorField = {
  key: string;
  label: string;
  kind?:
    | "date"
    | "time"
    | "datetime-local"
    | "number"
    | "textarea"
    | "checkbox"
    | "multi"
    | "select";
  options?: Choice[];
  required?: boolean;
};
export function friendlyError(error: unknown) {
  return error instanceof Error && !error.message.startsWith("[")
    ? error.message
    : "The record could not be saved. Check the fields and your connection.";
}
export function Picker({
  label,
  value,
  choices,
  onChange,
  empty = "Choose",
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  empty?: string;
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{empty}</option>
        {choices.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
export function Records({
  rows,
  choose,
  empty = "Nothing to show here yet.",
}: {
  rows: ReportRow[];
  choose?: (index: number) => void;
  empty?: string;
}) {
  const keys = Object.keys(rows[0] || {}).filter((key) => key !== "id");
  return (
    <section className="surface table-card communication-panel">
      <div className="section-heading">
        {rows.length ? (
          <span className="muted">
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="records-empty">{empty}</span>
        )}
        {/* Stays mounted so focus handling is not disturbed when rows arrive. */}
        <span hidden={!rows.length}>
          <ExportButton rows={rows} />
        </span>
      </div>
      {!!rows.length && (
        <div className="table-scroll">
          <table className="card-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                {keys.map((key) => (
                  <th key={key} role="columnheader">
                    {columnLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)} role="row">
                  {keys.map((key, column) => (
                    <td key={key} role="cell" data-label={columnLabel(key)}>
                      {column === 0 && choose ? (
                        <Button
                          appearance="transparent"
                          onClick={() => choose(index)}
                        >
                          {displayValue(row[key])}
                        </Button>
                      ) : ["Status", "State"].includes(columnLabel(key)) &&
                        typeof row[key] === "string" &&
                        row[key] ? (
                        <StatusPill text={String(row[key])} />
                      ) : (
                        displayValue(row[key])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export function RecordEditor({
  title,
  fields,
  initial,
  save,
  close,
  preview,
}: {
  title: string;
  fields: EditorField[];
  initial: Record<string, unknown>;
  save: (value: Record<string, unknown>) => Promise<unknown>;
  close: () => void;
  // Live consequences of the edit, shown before saving.
  preview?: (value: Record<string, unknown>) => ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key: string, next: unknown) =>
    setValue((before) => ({ ...before, [key]: next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(
        Object.fromEntries([
          ...["id", "expectedRevision"]
            .filter((key) => key in initial)
            .map((key) => [key, initial[key]]),
          ...fields.map((field) => [
            field.key,
            value[field.key] ??
              (field.kind === "checkbox"
                ? false
                : field.kind === "multi"
                  ? []
                  : ""),
          ]),
        ]),
      );
      close();
    } catch (error) {
      setError(friendlyError(error));
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
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
              {fields.map((field) => (
                <div key={field.key}>
                  {field.kind === "checkbox" ? (
                    <Checkbox
                      label={field.label}
                      checked={!!value[field.key]}
                      onChange={(_, data) =>
                        update(field.key, data.checked === true)
                      }
                    />
                  ) : field.kind === "multi" ? (
                    <fieldset className="member-picker">
                      <legend>{field.label}</legend>
                      {field.options?.map((option) => (
                        <Checkbox
                          key={option.id}
                          label={option.name}
                          checked={
                            Array.isArray(value[field.key]) &&
                            (value[field.key] as string[]).includes(option.id)
                          }
                          onChange={(_, data) =>
                            update(
                              field.key,
                              data.checked
                                ? [
                                    ...new Set([
                                      ...((value[field.key] as string[]) || []),
                                      option.id,
                                    ]),
                                  ]
                                : ((value[field.key] as string[]) || []).filter(
                                    (id) => id !== option.id,
                                  ),
                            )
                          }
                        />
                      ))}
                    </fieldset>
                  ) : (
                    <Field label={field.label} required={field.required}>
                      {field.kind === "select" ? (
                        <Select
                          value={String(value[field.key] ?? "")}
                          onChange={(event) =>
                            update(field.key, event.target.value)
                          }
                        >
                          <option value="">Choose</option>
                          {field.options?.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </Select>
                      ) : field.kind === "textarea" ? (
                        <Textarea
                          rows={5}
                          required={field.required}
                          value={String(value[field.key] ?? "")}
                          onChange={(_, data) => update(field.key, data.value)}
                        />
                      ) : (
                        <Input
                          required={field.required}
                          type={field.kind || "text"}
                          value={String(value[field.key] ?? "")}
                          onChange={(_, data) =>
                            update(
                              field.key,
                              field.kind === "number"
                                ? Number(data.value)
                                : data.value,
                            )
                          }
                        />
                      )}
                    </Field>
                  )}
                </div>
              ))}
              {preview && (
                <MessageBar intent="info" aria-live="polite">
                  {preview(value)}
                </MessageBar>
              )}
              {error && <MessageBar intent="error">{error}</MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={busy}>
                {busy ? "Saving" : "Save"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
        {/* A sensitive save asks to confirm the sign-in in a dialog nested here. */}
        <ReauthHost />
      </DialogSurface>
    </Dialog>
  );
}

// A status word as a small label. The word is always shown; colour only adds to it.
export function StatusPill({ text }: { text: string }) {
  return <span className={`pill ${statusTone(text)}`}>{text}</span>;
}
// A grid with the shared Export button and an Actions column for each row.
export function ActionTable({
  rows,
  actions,
  empty,
  session = false,
}: {
  rows: ReportRow[];
  actions?: (index: number) => ReactNode;
  empty: string;
  session?: boolean;
}) {
  const keys = Object.keys(rows[0] || {}).filter((key) => key !== "id");
  return (
    <section
      className={`surface table-card communication-panel${session ? " session-panel" : ""}`}
    >
      <div className="section-heading">
        {rows.length ? (
          <span className="muted">
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="records-empty">{empty}</span>
        )}
        <span hidden={!rows.length}>
          <ExportButton rows={rows} />
        </span>
      </div>
      {!!rows.length && (
        <div className="table-scroll">
          <table className="card-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                {keys.map((key) => (
                  <th key={key} role="columnheader">
                    {columnLabel(key)}
                  </th>
                ))}
                {actions && <th role="columnheader">Actions</th>}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)} role="row">
                  {keys.map((key) => (
                    <td key={key} role="cell" data-label={columnLabel(key)}>
                      {["Status", "State"].includes(columnLabel(key)) &&
                      typeof row[key] === "string" &&
                      row[key] ? (
                        <StatusPill text={String(row[key])} />
                      ) : (
                        displayValue(row[key])
                      )}
                    </td>
                  ))}
                  {actions && (
                    <td
                      className="row-actions"
                      role="cell"
                      data-label="Actions"
                    >
                      {actions(index)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
