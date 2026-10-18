import { useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Subtitle2,
  Tab,
  TabList,
  Textarea,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular, MailRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  localSchedule,
  membershipStatuses,
  MERGE_FIELDS,
  messageInputSchema,
  smsSegments,
  statusLabels,
  type Audience,
  type MessageInput,
  type Person,
  type Role,
} from "@sycamore/shared";
import {
  cancelMessage,
  createMessage,
  emulators,
  markSmsRead,
  previewMessage,
  recordContactConsent,
  retryFailedMessage,
  runLocalCommunicationTick,
  saveAudience,
  saveMessageTemplate,
  sendTestMessage,
  uploadMessagePdf,
  useCommunicationData,
  usePersonHistory,
  useRecipients,
  type MessageView,
  type PreviewView,
} from "../data/communications";
import { ExportButton } from "../components/ExportButton";
type Data = ReturnType<typeof useCommunicationData>;
function messageError(error: unknown) {
  return error instanceof Error && !error.message.startsWith("[")
    ? error.message
    : "The change could not be saved. Check the fields and your connection.";
}
export function Messages({
  roles,
  initialAudience,
}: {
  roles: Role[];
  initialAudience?: Audience;
}) {
  const data = useCommunicationData(roles);
  const [tab, setTab] = useState("compose");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [historicalMessage, setHistoricalMessage] =
    useState<MessageView | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONGREGATIONAL COMMUNICATION</span>
          <Title3 as="h1">Messages</Title3>
          <p>Write to people who have chosen to receive church messages.</p>
        </div>
        {emulators && roles.includes("admin") && (
          <Button
            onClick={() => {
              void runLocalCommunicationTick()
                .then(() => setNotice("The local queue was processed."))
                .catch((error) => data.setError(messageError(error)));
            }}
          >
            Process local queue
          </Button>
        )}
      </div>
      {emulators && (
        <MessageBar intent="info">
          Local simulation. No emails or texts are sent to Microsoft or Twilio.
        </MessageBar>
      )}
      {data.error && <MessageBar intent="error">{data.error}</MessageBar>}
      {data.automationError && (
        <MessageBar intent="warning">{data.automationError}</MessageBar>
      )}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, value) => {
          setTab(String(value.value));
          setNotice("");
        }}
      >
        <Tab value="compose">Compose</Tab>
        <Tab value="scheduled">Scheduled</Tab>
        <Tab value="sent">Delivery log</Tab>
        <Tab value="inbox">
          Text inbox ({data.inbox.filter((row) => !row.read).length})
        </Tab>
        <Tab value="contacts">Contacts & consent</Tab>
        <Tab value="history">Person history</Tab>
      </TabList>
      {tab === "compose" && (
        <Composer
          initialAudience={initialAudience}
          data={data}
          onQueued={() => {
            setNotice(
              "Message queued. Delivery runs on the server, including when this PC is closed.",
            );
            setTab("scheduled");
          }}
        />
      )}
      {(tab === "scheduled" || tab === "sent") && (
        <MessageTable
          messages={data.messages.filter((message) =>
            tab === "scheduled"
              ? message.status === "queued"
              : message.status !== "queued",
          )}
          zone={data.zone}
          select={setSelected}
        />
      )}
      {tab === "inbox" && (
        <section className="surface communication-panel">
          <div className="section-heading">
            <Subtitle2>Replies and consent commands</Subtitle2>
            <ExportButton
              rows={data.inbox.map((row) => ({
                From: row.fromNumber,
                Message: row.body,
                Read: row.read ? "Yes" : "No",
              }))}
            />
          </div>
          {!data.inbox.length && <p>No text replies yet.</p>}
          {data.inbox.map((row) => (
            <article className="inbox-message" key={row.id}>
              <div>
                <strong>
                  {row.personIds
                    .map(
                      (id) =>
                        data.people.find((person) => person.id === id)
                          ?.firstName,
                    )
                    .filter(Boolean)
                    .join(", ") || row.fromNumber}
                </strong>{" "}
                <span className="muted">{row.fromNumber}</span>
                {!row.read && <Badge appearance="outline">Unread</Badge>}
              </div>
              <p className="message-body">{row.body}</p>
              <small>
                {row.receivedAt
                  ?.toDate()
                  .toLocaleString("en-US", { timeZone: data.zone })}
              </small>
              {!row.read && (
                <Button
                  onClick={() => {
                    void markSmsRead(row.id).catch((error) =>
                      data.setError(messageError(error)),
                    );
                  }}
                >
                  Mark read
                </Button>
              )}
            </article>
          ))}
        </section>
      )}
      {tab === "contacts" && <Contacts data={data} />}
      {tab === "history" && (
        <PersonHistory
          data={data}
          roles={roles}
          choose={(message) => {
            setHistoricalMessage(message);
            setSelected(message.id);
          }}
        />
      )}
      {(data.messages.some((message) => message.id === selected) ||
        historicalMessage?.id === selected) && (
        <DeliveryDialog
          message={
            data.messages.find((message) => message.id === selected) ||
            historicalMessage!
          }
          data={data}
          close={() => setSelected("")}
        />
      )}
    </>
  );
}
function PersonHistory({
  data,
  roles,
  choose,
}: {
  data: Data;
  roles: Role[];
  choose: (message: MessageView) => void;
}) {
  const [personId, setPersonId] = useState("");
  const history = usePersonHistory(personId, roles);
  return (
    <section className="communication-panel">
      <Field label="Person">
        <Dropdown
          value={
            data.people.find((person) => person.id === personId)?.firstName ||
            "Choose a person"
          }
          selectedOptions={personId ? [personId] : []}
          onOptionSelect={(_, value) => setPersonId(value.optionValue || "")}
        >
          {data.people.map((person) => (
            <Option key={person.id} value={person.id}>
              {person.firstName + " " + person.lastName}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <MessageTable
        messages={history.messages}
        zone={data.zone}
        select={(id) => {
          const message = history.messages.find((row) => row.id === id);
          if (message) choose(message);
        }}
      />
      <section className="surface communication-panel">
        <div className="section-heading">
          <Subtitle2>Incoming text history</Subtitle2>
          <ExportButton
            rows={history.inbox.map((row) => ({
              From: row.fromNumber,
              Message: row.body,
            }))}
          />
        </div>
        {history.inbox.map((row) => (
          <article className="inbox-message" key={row.id}>
            <small>
              {row.receivedAt
                ?.toDate()
                .toLocaleString("en-US", { timeZone: data.zone })}
            </small>
            <p className="message-body">{row.body}</p>
          </article>
        ))}
      </section>
    </section>
  );
}
function Composer({
  data,
  onQueued,
  initialAudience,
}: {
  data: Data;
  onQueued: () => void;
  initialAudience?: Audience;
}) {
  const [channel, setChannel] = useState<"email" | "sms" | "both">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Audience["kind"]>(
    initialAudience?.kind || "all",
  );
  const [ids, setIds] = useState<string[]>(initialAudience?.ids || []);
  const [scheduled, setScheduled] = useState("");
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [requestId, setRequestId] = useState(crypto.randomUUID());
  const [listName, setListName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setPreview(null);
    setRequestId(crypto.randomUUID());
    setNotice("");
  }, [channel, subject, body, kind, ids, scheduled, files]);
  const choices =
    kind === "people"
      ? data.people.map((person) => ({
          id: person.id,
          name: `${person.firstName} ${person.lastName}`,
        }))
      : kind === "status"
        ? membershipStatuses
            .filter((status) => status !== "former")
            .map((status) => ({ id: status, name: statusLabels[status] }))
        : kind === "household"
          ? data.households
          : kind === "district"
            ? data.districts
            : kind === "group"
              ? data.groups
              : kind === "saved"
                ? data.saved
                : [];
  function payload(): MessageInput {
    return messageInputSchema.parse({
      requestId,
      channel,
      subject,
      body,
      audience: { kind, ids },
      scheduledFor: scheduled ? localSchedule(scheduled, data.zone) : null,
      attachmentPaths: files.map((file) => file.path),
      confirmLarge: confirm,
    });
  }
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(messageError(error));
    } finally {
      setBusy(false);
    }
  }
  async function send(confirmed = false) {
    await perform(async () => {
      await createMessage({
        ...payload(),
        confirmLarge: confirmed,
        confirmedRecipientCount: preview?.pending ?? null,
      });
      setConfirm(false);
      onQueued();
    });
  }
  const segments = smsSegments(
    `${body}\n${data.settings.churchName}. Reply STOP to opt out.`,
  );
  return (
    <div className="compose-layout">
      <section className="surface communication-panel">
        <div className="communication-fields">
          <Field label="Channel">
            <Dropdown
              value={
                channel === "both"
                  ? "Email and text"
                  : channel === "email"
                    ? "Email"
                    : "Text"
              }
              selectedOptions={[channel]}
              onOptionSelect={(_, value) =>
                setChannel(value.optionValue as typeof channel)
              }
            >
              <Option value="email">Email</Option>
              <Option value="sms">Text</Option>
              <Option value="both">Email and text</Option>
            </Dropdown>
          </Field>
          <Field label="Template">
            <Dropdown
              placeholder="Choose a template"
              onOptionSelect={(_, value) => {
                const template = data.templates.find(
                  (row) => row.id === value.optionValue,
                );
                if (template) {
                  setChannel(template.channel);
                  setSubject(template.subject);
                  setBody(template.body);
                }
              }}
            >
              {data.templates.map((template) => (
                <Option key={template.id} value={template.id}>
                  {template.name}
                </Option>
              ))}
            </Dropdown>
          </Field>
        </div>
        <Field label="Recipient list">
          <Dropdown
            value={
              {
                all: "Everyone",
                people: "Selected people",
                household: "Household",
                status: "Membership status",
                district: "Elder district",
                group: "Group",
                saved: "Saved list",
              }[kind]
            }
            selectedOptions={[kind]}
            onOptionSelect={(_, value) => {
              setKind(value.optionValue as typeof kind);
              setIds([]);
            }}
          >
            <Option value="all">Everyone</Option>
            <Option value="people">Selected people</Option>
            <Option value="household">Household</Option>
            <Option value="status">Membership status</Option>
            <Option value="district">Elder district</Option>
            <Option value="group">Group</Option>
            <Option value="saved">Saved list</Option>
          </Dropdown>
        </Field>
        {kind !== "all" && (
          <Field label="Choose recipients">
            <Dropdown
              multiselect={kind !== "saved"}
              value={choices
                .filter((choice) => ids.includes(choice.id))
                .map((choice) => choice.name)
                .join(", ")}
              placeholder="Choose from the list"
              selectedOptions={ids}
              onOptionSelect={(_, value) => setIds(value.selectedOptions)}
            >
              {choices.map((choice) => (
                <Option key={choice.id} value={choice.id}>
                  {choice.name}
                </Option>
              ))}
            </Dropdown>
          </Field>
        )}
        {channel !== "sms" && (
          <Field label="Subject" required>
            <Input
              value={subject}
              onChange={(_, value) => setSubject(value.value)}
              maxLength={200}
            />
          </Field>
        )}
        <Field label="Message" required>
          <Textarea
            rows={8}
            value={body}
            onChange={(_, value) => setBody(value.value)}
            maxLength={12000}
          />
        </Field>
        <div className="merge-fields">
          {MERGE_FIELDS.map((field) => (
            <Button
              key={field}
              size="small"
              appearance="subtle"
              onClick={() => setBody(body + `{${field}}`)}
            >{`{${field}}`}</Button>
          ))}
        </div>
        {channel !== "email" && (
          <p className="muted">
            {segments.units} units · {segments.segments} text segment
            {segments.segments === 1 ? "" : "s"} · {segments.encoding}. Merge
            fields may change the final length.
          </p>
        )}
        {channel !== "sms" && (
          <Field label="PDF attachments, up to 3 and 20 MB combined">
            <input
              aria-label="Message PDF attachments"
              type="file"
              accept="application/pdf"
              multiple
              disabled={busy || files.length >= 3}
              onChange={(event) => {
                const selected = [...(event.target.files || [])];
                void perform(async () => {
                  if (selected.length + files.length > 3)
                    throw new Error("Choose up to three PDFs.");
                  const added = [];
                  for (const file of selected)
                    added.push(await uploadMessagePdf(file));
                  setFiles([...files, ...added]);
                });
                event.target.value = "";
              }}
            />
            {files.map((file) => (
              <div key={file.path}>
                {file.name}{" "}
                <Button
                  size="small"
                  onClick={() =>
                    setFiles(files.filter((row) => row.path !== file.path))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </Field>
        )}
        <Field
          label={`Send later, ${data.zone}`}
          hint="Leave blank to send now. Scheduled delivery runs even when this PC is closed."
        >
          <Input
            type="datetime-local"
            value={scheduled}
            onChange={(_, value) => setScheduled(value.value)}
          />
        </Field>
        {error && <MessageBar intent="error">{error}</MessageBar>}
        {notice && <MessageBar intent="success">{notice}</MessageBar>}
        <div className="actions">
          <Button
            disabled={busy}
            onClick={() => {
              void perform(async () =>
                setPreview(await previewMessage(payload())),
              );
            }}
          >
            Preview recipients
          </Button>
          <Button
            disabled={busy || !preview?.pending}
            appearance="primary"
            icon={<MailRegular />}
            onClick={() => {
              if ((preview?.pending ?? 0) > 20) setConfirm(true);
              else void send();
            }}
          >
            {scheduled ? "Schedule message" : "Send now"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void perform(async () => {
                await sendTestMessage(payload());
                setNotice(
                  "A test message was queued to your linked person record, using its consent settings.",
                );
              });
            }}
          >
            Send a test to me
          </Button>
        </div>
        <details className="save-options">
          <summary>Save a template or recipient list</summary>
          <Field label="Template name">
            <Input
              value={templateName}
              onChange={(_, value) => setTemplateName(value.value)}
            />
          </Field>
          <Button
            disabled={busy || !templateName.trim() || !body.trim()}
            onClick={() => {
              void perform(async () => {
                await saveMessageTemplate({
                  id: crypto.randomUUID(),
                  name: templateName,
                  channel,
                  subject,
                  body,
                });
                setNotice("Template saved.");
              });
            }}
          >
            Save template
          </Button>
          <Field label="List name">
            <Input
              placeholder="Prayer chain or emergency broadcast"
              value={listName}
              onChange={(_, value) => setListName(value.value)}
            />
          </Field>
          <Button
            disabled={busy || !listName.trim() || kind === "saved"}
            onClick={() => {
              void perform(async () => {
                await saveAudience({
                  id: crypto.randomUUID(),
                  name: listName,
                  audience: { kind, ids },
                });
                setNotice("Recipient list saved.");
              });
            }}
          >
            Save recipient list
          </Button>
        </details>
      </section>
      <aside className="surface communication-panel">
        <Subtitle2>Recipient preview</Subtitle2>
        <p>
          {preview
            ? `${preview.pending} deliveries ready`
            : "Preview the list before sending."}
        </p>
        {preview && (
          <>
            <ExportButton
              rows={preview.recipients.map((row) => ({
                Name: row.name,
                Channel: row.channel,
                Address: row.address,
                Status: row.status,
                Reason: row.error,
              }))}
            />
            <ul className="recipient-preview">
              {preview.recipients.map((row) => (
                <li key={row.id}>
                  <strong>
                    {data.people.find((person) => person.id === row.personId)
                      ?.firstName || row.name}
                  </strong>
                  <span>
                    {row.channel} ·{" "}
                    {row.status === "pending" ? "Ready" : row.error}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted">
          Opt-outs are checked again before delivery. Each email goes to one
          recipient.
        </p>
      </aside>
      <Dialog
        open={confirm}
        onOpenChange={(_, value) => setConfirm(value.open)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Send this church message?</DialogTitle>
            <DialogContent>
              This will queue {preview?.pending} deliveries to the selected
              recipients.
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() => void send(true)}
              >
                Send {preview?.pending} deliveries
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
function MessageTable({
  messages,
  zone,
  select,
}: {
  messages: MessageView[];
  zone: string;
  select: (id: string) => void;
}) {
  const rows = messages.map((message) => ({
    Subject: message.subject || "Text message",
    Channel: message.channel,
    Status: message.status,
    Scheduled:
      message.scheduledFor
        ?.toDate()
        .toLocaleString("en-US", { timeZone: zone }) || "",
    Simulated: message.totals?.simulated ?? 0,
    Accepted: message.totals?.accepted ?? 0,
    Delivered: message.totals?.delivered ?? 0,
    Failed: (message.totals?.failed ?? 0) + (message.totals?.undelivered ?? 0),
    Unknown: message.totals?.unknown ?? 0,
  }));
  return (
    <section className="surface table-card communication-panel">
      <div className="section-heading">
        <Subtitle2>{messages.length} messages</Subtitle2>
        <ExportButton rows={rows} />
      </div>
      <table>
        <thead>
          <tr>
            <th>Message</th>
            <th>Channel</th>
            <th>Scheduled, church time</th>
            <th>Status</th>
            <th>Delivery summary</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((message, index) => (
            <tr key={message.id}>
              <td>
                <Button
                  appearance="transparent"
                  onClick={() => select(message.id)}
                >
                  {message.sessionOnly && <LockClosedRegular />}{" "}
                  {message.subject || "Text message"}
                </Button>
                {message.sessionOnly && (
                  <Badge appearance="outline">Session only</Badge>
                )}
              </td>
              <td>{message.channel}</td>
              <td>{rows[index].Scheduled}</td>
              <td>{message.status}</td>
              <td>
                {Object.entries(message.totals || {})
                  .map(([name, count]) => `${name} ${count}`)
                  .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!messages.length && <p>No messages in this list.</p>}
      <p className="muted">
        Microsoft acceptance means the mailbox accepted the request. It does not
        confirm delivery to the recipient.
      </p>
    </section>
  );
}
function DeliveryDialog({
  message,
  data,
  close,
}: {
  message: MessageView;
  data: Data;
  close: () => void;
}) {
  const recipients = useRecipients(message.id);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(_, value) => {
        if (!value.open) close();
      }}
    >
      <DialogSurface className="delivery-dialog">
        <DialogBody>
          <DialogTitle>{message.subject || "Text message"}</DialogTitle>
          <DialogContent>
            <p className="message-body">{message.body}</p>
            <ExportButton
              rows={recipients.map((row) => ({
                Name:
                  data.people.find((person) => person.id === row.personId)
                    ?.firstName || row.personId,
                Channel: row.channel,
                Address: row.address,
                Status: row.status,
                Error: row.error,
                Provider: row.providerId,
              }))}
            />
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((row) => (
                  <tr key={row.id}>
                    <td>{row.address}</td>
                    <td>{row.channel}</td>
                    <td>{row.status}</td>
                    <td>{row.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error && <MessageBar intent="error">{error}</MessageBar>}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Close</Button>
            {message.status === "queued" && (
              <Button
                onClick={() => {
                  void cancelMessage(message.id)
                    .then(close)
                    .catch((error) => setError(messageError(error)));
                }}
              >
                Cancel remaining
              </Button>
            )}
            <Button
              disabled={
                !recipients.some((row) =>
                  ["failed", "undelivered"].includes(row.status),
                )
              }
              onClick={() => {
                void retryFailedMessage(message.id)
                  .then(close)
                  .catch((error) => setError(messageError(error)));
              }}
            >
              Retry confirmed failures
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
function Contacts({ data }: { data: Data }) {
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const filtered = data.people.filter((person) =>
    `${person.firstName} ${person.lastName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="surface communication-panel table-card">
      <div className="section-heading">
        <Input
          placeholder="Search contacts"
          aria-label="Search contacts"
          value={search}
          onChange={(_, value) => setSearch(value.value)}
        />
        <ExportButton
          rows={filtered.map((row) => ({
            Name: `${row.firstName} ${row.lastName}`,
            Email: row.email,
            Mobile: row.mobilePhone,
            EmailConsent: row.emailOptIn ? "Yes" : "No",
            TextConsent: row.smsOptIn ? "Yes" : "No",
          }))}
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Mobile</th>
            <th>Email consent</th>
            <th>Text consent</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.id}>
              <td>
                <Button appearance="transparent" onClick={() => setPerson(row)}>
                  {row.firstName} {row.lastName}
                </Button>
              </td>
              <td>{row.email}</td>
              <td>{row.mobilePhone}</td>
              <td>{row.emailOptIn ? "Yes" : "No"}</td>
              <td>{row.smsOptIn ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {person && (
        <ConsentDialog person={person} close={() => setPerson(null)} />
      )}
    </section>
  );
}
export function ConsentDialog({
  person,
  close,
}: {
  person: Person;
  close: () => void;
}) {
  const [email, setEmail] = useState(person.email);
  const [phone, setPhone] = useState(person.mobilePhone);
  const [emailOptIn, setEmailOptIn] = useState(person.emailOptIn);
  const [smsOptIn, setSmsOptIn] = useState(person.smsOptIn);
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await recordContactConsent({
        personId: person.id,
        email,
        mobilePhone: phone,
        emailOptIn,
        smsOptIn,
        evidence,
        expected: {
          email: person.email,
          mobilePhone: person.mobilePhone,
          emailOptIn: person.emailOptIn,
          smsOptIn: person.smsOptIn,
        },
      });
      close();
    } catch (error) {
      setError(messageError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(_, value) => {
        if (!value.open && !busy) close();
      }}
    >
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>
              {person.firstName} {person.lastName}
            </DialogTitle>
            <DialogContent>
              <Field label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(_, value) => setEmail(value.value)}
                />
              </Field>
              <Field label="Mobile phone">
                <Input
                  type="tel"
                  value={phone}
                  onChange={(_, value) => setPhone(value.value)}
                />
              </Field>
              <Checkbox
                label="Has agreed to receive church email"
                checked={emailOptIn}
                onChange={(_, value) => setEmailOptIn(value.checked === true)}
              />
              <Checkbox
                label="Has agreed to receive church texts"
                checked={smsOptIn}
                onChange={(_, value) => setSmsOptIn(value.checked === true)}
              />
              <Field
                label="Consent or opt-out record"
                required
                hint="Record how permission was given, or why it is being withdrawn."
              >
                <Textarea
                  required
                  value={evidence}
                  minLength={5}
                  onChange={(_, value) => setEvidence(value.value)}
                />
              </Field>
              {error && <MessageBar intent="error">{error}</MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button appearance="primary" disabled={busy} type="submit">
                Save contact and consent
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
export function formatChurchTime(date: Date, zone: string) {
  return DateTime.fromJSDate(date, { zone }).toFormat("LLL d, yyyy h:mm a");
}
