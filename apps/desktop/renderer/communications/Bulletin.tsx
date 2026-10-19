import { DateTime } from "luxon";
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
  Subtitle2,
  Title3,
} from "@fluentui/react-components";
import { bulletinClock, messageInputSchema, type Role } from "@sycamore/shared";
import {
  bulletinAction,
  emulators,
  previewMessage,
  previewPdf,
  runLocalCommunicationTick,
  uploadBulletinPdf,
  useCommunicationData,
} from "../data/communications";
import { ExportButton } from "../components/ExportButton";
import { DeliveryBar } from "../components/DeliveryBar";
import { native } from "../platform";
export function Bulletin({ roles }: { roles: Role[] }) {
  const data = useCommunicationData(roles);
  const [week, setWeek] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const selected =
    week || bulletinClock(new Date(), data.zone, data.settings).week;
  const bulletin = data.bulletins.find((row) => row.week === selected);
  const message = data.messages.find((row) => row.id === bulletin?.messageId);
  const preview = data.messages.find(
    (row) => row.id === bulletin?.previewMessageId,
  );
  async function act(task: () => Promise<unknown>, result: string) {
    setBusy(true);
    setError("");
    try {
      await task();
      setNotice(result);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The bulletin could not be updated. Check your connection and settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE COMING LORD'S DAY</span>
          <Title3 as="h1">Weekly bulletin</Title3>
          <p>One PDF, delivered to each person with email consent.</p>
        </div>
        {emulators && roles.includes("admin") && (
          <Button
            onClick={() =>
              void act(
                runLocalCommunicationTick,
                "The local queue was processed.",
              )
            }
          >
            Process local queue
          </Button>
        )}
      </div>
      {emulators && (
        <MessageBar intent="info">
          Local simulation. Bulletin emails and texts are recorded locally.
        </MessageBar>
      )}
      {(error || data.error || data.automationError) && (
        <MessageBar intent="error">
          {error || data.error || data.automationError}
        </MessageBar>
      )}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <section className="surface communication-panel">
        <div className="section-heading">
          <Field label="Lord's Day date">
            <Input
              type="date"
              value={selected}
              onChange={(_, value) => setWeek(value.value)}
            />
          </Field>
          <span className="status-chip">
            {message?.status === "completed"
              ? "Sent"
              : bulletinStatus(bulletin?.status)}
          </span>
        </div>
        <Subtitle2>
          {bulletin?.file?.name || "No bulletin PDF uploaded"}
        </Subtitle2>
        <p>
          {bulletin?.file
            ? `Source ${bulletin.file.source === "onedrive" ? "Microsoft folder" : "App upload"} · ${Math.round(bulletin.file.size / 1024)} KB`
            : "Upload the bulletin here or save it in the configured Microsoft folder."}
        </p>
        <p>
          Automatic delivery{" "}
          {data.settings.bulletinEnabled
            ? `Saturday at ${twelveHour(data.settings.sendTime)}, ${data.zone}`
            : "is turned off"}
          . Late files can send until {twelveHour(data.settings.cutoffTime)} on
          Saturday.
        </p>
        <ol className="steps" aria-label="This week's bulletin">
          <li className={bulletin?.file ? "done" : "current"}>
            <strong>File received</strong>
            <span className="muted">
              {bulletin?.file ? bulletin.file.name : "Waiting for the PDF"}
            </span>
          </li>
          <li className={preview ? "done" : bulletin?.file ? "current" : ""}>
            <strong>Pastor preview</strong>
            {preview ? (
              <DeliveryBar totals={preview.totals || {}} />
            ) : (
              <span className="muted">Not sent yet</span>
            )}
          </li>
          <li
            className={
              message?.status === "completed"
                ? "done"
                : message
                  ? "current"
                  : ""
            }
          >
            <strong>Sent to the congregation</strong>
            {message ? (
              <DeliveryBar totals={message.totals || {}} />
            ) : (
              <span className="muted">
                {bulletin?.status === "skipped"
                  ? "Skipped this week"
                  : "Not sent yet"}
              </span>
            )}
          </li>
        </ol>
        <Field label="Upload bulletin PDF">
          <input
            aria-label="Upload bulletin PDF"
            type="file"
            accept="application/pdf"
            disabled={
              busy || !!bulletin?.messageId || bulletin?.status === "preparing"
            }
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void act(
                  () => uploadBulletinPdf(file, selected),
                  "Bulletin uploaded. A Pastor preview is queued when configured and consented.",
                );
              event.target.value = "";
            }}
          />
        </Field>
        <div className="actions">
          <Button
            disabled={busy || !bulletin?.file}
            onClick={() =>
              void act(async () => {
                const url = await previewPdf(bulletin!.file!.path);
                const bytes = new Uint8Array(
                  await (await fetch(url)).arrayBuffer(),
                );
                URL.revokeObjectURL(url);
                if (native) await native.previewPdf(Array.from(bytes));
                else {
                  const blob = URL.createObjectURL(
                    new Blob([bytes], { type: "application/pdf" }),
                  );
                  const opened = window.open(blob, "_blank", "noopener");
                  if (!opened)
                    setNotice(
                      "The PDF opened in a separate tab if pop-ups are allowed.",
                    );
                  setTimeout(() => URL.revokeObjectURL(blob), 60000);
                }
              }, "PDF preview opened.")
            }
          >
            Preview PDF
          </Button>
          <Button
            disabled={busy || !bulletin?.file}
            onClick={() =>
              void act(
                () => bulletinAction(selected, "preview"),
                "The Pastor preview was queued when the linked account has consent.",
              )
            }
          >
            Send Pastor preview
          </Button>
          <Button
            appearance="primary"
            disabled={
              busy ||
              !bulletin?.file ||
              (!!bulletin?.messageId && !message?.totals?.expired) ||
              !data.settings.emailEnabled
            }
            onClick={() =>
              void act(async () => {
                if (message?.totals?.expired) {
                  setConfirmCount(message.totals.expired);
                  return;
                }
                const preview = await previewMessage(
                  messageInputSchema.parse({
                    requestId: crypto.randomUUID(),
                    channel: "email",
                    subject: data.settings.bulletinSubject,
                    body: data.settings.bulletinBody,
                    audience: { kind: "all", ids: [] },
                  }),
                );
                setConfirmCount(preview.pending);
              }, "Review the recipient count before sending.")
            }
          >
            Send now
          </Button>
          <Button
            disabled={busy || !!bulletin?.messageId}
            onClick={() =>
              void act(
                () => bulletinAction(selected, "skip"),
                "Automatic delivery is skipped for this week.",
              )
            }
          >
            Skip this week
          </Button>
        </div>
        {bulletin?.publicUrl && (
          <p className="message-body">
            Shareable bulletin link · {bulletin.publicUrl}
          </p>
        )}
      </section>
      <section className="surface communication-panel table-card">
        <div className="section-heading">
          <Subtitle2>Bulletin history</Subtitle2>
          <ExportButton
            rows={data.bulletins.map((row) => ({
              Week: row.week,
              File: row.file?.name || "",
              Source: row.file?.source || "",
              Status: row.status,
            }))}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Lord's Day</th>
              <th>File</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.bulletins.map((row) => (
              <tr key={row.id}>
                <td>
                  <Button
                    appearance="transparent"
                    onClick={() => setWeek(row.week)}
                  >
                    {DateTime.fromISO(row.week).toFormat("LLL d, yyyy")}
                  </Button>
                </td>
                <td>{row.file?.name || "Waiting for file"}</td>
                <td>{bulletinStatus(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Dialog
        open={confirmCount !== null}
        onOpenChange={(_, value) => {
          if (!value.open) setConfirmCount(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Send this week's bulletin?</DialogTitle>
            <DialogContent>
              Queue the PDF for {confirmCount} email recipients. It will not be
              sent again automatically this week.
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmCount(null)}>Cancel</Button>
              <Button
                appearance="primary"
                disabled={busy || !confirmCount}
                onClick={() =>
                  void act(async () => {
                    await bulletinAction(selected, "send", confirmCount);
                    setConfirmCount(null);
                  }, "Bulletin queued.")
                }
              >
                Send bulletin to {confirmCount} recipients
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}

function bulletinStatus(status?: string) {
  return (
    {
      waiting: "Waiting for file",
      preparing: "Preparing",
      ready: "Ready to send",
      skipped: "Skipped this week",
    }[status || "waiting"] ?? status!.charAt(0).toUpperCase() + status!.slice(1)
  );
}
// Settings keep 24-hour times; people read "6:00 PM".
function twelveHour(time: string) {
  const parsed = DateTime.fromFormat(time || "", "HH:mm");
  return parsed.isValid ? parsed.toFormat("h:mm a") : time;
}
