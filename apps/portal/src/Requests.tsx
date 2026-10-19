import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Radio,
  RadioGroup,
  Select,
  Textarea,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  memberRequestAudience,
  memberRequestKindLabels,
  mercyCategories,
  mercyCategoryLabels,
  type MemberRequestKind,
  type MercyCategory,
  type MyRequest,
} from "@sycamore/shared";
import { getMyRequests, portalError, submitRequest } from "./data";

export function Requests() {
  const [rows, setRows] = useState<MyRequest[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<MemberRequestKind>("prayer");
  const [category, setCategory] = useState<MercyCategory>("meals");
  const [urgent, setUrgent] = useState(false);
  const [body, setBody] = useState("");
  const [neededBy, setNeededBy] = useState("");
  // One ID per draft, so a retried send is received once.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function load() {
    setRows(await getMyRequests());
  }
  useEffect(() => {
    let active = true;
    void getMyRequests()
      .then((value) => {
        if (active) setRows(value);
      })
      .catch((failure) => {
        if (active) setError(portalError(failure));
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await submitRequest(
        kind === "practical"
          ? { requestId, kind, body, category, urgent, neededBy }
          : { requestId, kind, body },
      );
      setBody("");
      setNeededBy("");
      setUrgent(false);
      setRequestId(crypto.randomUUID());
      setNotice(
        kind === "practical"
          ? "Your request for help was sent to the deacons."
          : "Your request was sent to the Session.",
      );
      await load();
    } catch (failure) {
      setError(portalError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-grid">
      <form className="card" onSubmit={submit}>
        <h2>Send a request</h2>
        <RadioGroup
          aria-label="Kind of request"
          value={kind}
          onChange={(_, row) => setKind(row.value as MemberRequestKind)}
        >
          {(Object.keys(memberRequestKindLabels) as MemberRequestKind[]).map(
            (value) => (
              <Radio
                key={value}
                value={value}
                label={memberRequestKindLabels[value]}
              />
            ),
          )}
        </RadioGroup>
        <MessageBar intent="info" layout="multiline">
          Who reads this: {memberRequestAudience[kind]}
        </MessageBar>
        {kind === "practical" && (
          <>
            <Field label="Kind of help" required>
              <Select
                value={category}
                onChange={(_, row) => setCategory(row.value as MercyCategory)}
              >
                {mercyCategories.map((value) => (
                  <option key={value} value={value}>
                    {mercyCategoryLabels[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Needed by, optional">
              <Input
                type="date"
                value={neededBy}
                onChange={(_, row) => setNeededBy(row.value)}
              />
            </Field>
            <Checkbox
              label="This is urgent"
              checked={urgent}
              onChange={(_, row) => setUrgent(row.checked === true)}
            />
          </>
        )}
        <Field
          label={kind === "practical" ? "What help is needed" : "Your request"}
          required
        >
          <Textarea
            required
            maxLength={4000}
            rows={6}
            value={body}
            onChange={(_, row) => setBody(row.value)}
          />
        </Field>
        <p>
          Please do not add attachments or details about other people that they
          have not agreed to share.
        </p>
        {error && <MessageBar intent="error">{error}</MessageBar>}
        {notice && <MessageBar intent="success">{notice}</MessageBar>}
        <Button
          type="submit"
          appearance="primary"
          disabled={busy || !body.trim()}
        >
          {kind === "practical" ? "Send to the deacons" : "Send to the Session"}
        </Button>
      </form>
      <section className="card">
        <h2>My requests</h2>
        <p>You see each request's progress here. Replies come in person.</p>
        {rows === null ? (
          <p>Loading your requests</p>
        ) : rows.length ? (
          <ul className="request-list">
            {rows.map((row) => (
              <li key={row.id}>
                <strong>
                  {row.kind === "practical" && row.category
                    ? `${memberRequestKindLabels.practical}: ${mercyCategoryLabels[row.category]}`
                    : memberRequestKindLabels[row.kind]}
                </strong>
                <span>
                  {DateTime.fromISO(row.submittedAt).toFormat("LLL d, yyyy")} ·{" "}
                  {row.progress}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No requests yet.</p>
        )}
      </section>
    </div>
  );
}
