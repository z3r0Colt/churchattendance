import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import type { CalendarFeed } from "@sycamore/shared";
import {
  createFeed,
  getPublicCalendar,
  listFeeds,
  portalError,
  publicFeedUrl,
  revokeFeed,
  type PublicCalendar,
} from "./data";

// Sunday reads as the Lord's Day throughout the app.
const when = (value: DateTime) =>
  `${value.weekday === 7 ? "Lord's Day" : value.toFormat("ccc")}, ${value.toFormat("LLL d · h:mm a")}`;
const webcal = (url: string) => url.replace(/^https?:/, "webcal:");

export function PublicCalendarView() {
  const [calendar, setCalendar] = useState<PublicCalendar | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getPublicCalendar()
      .then((value) => {
        if (active) setCalendar(value);
      })
      .catch((failure) => {
        if (active) setError(portalError(failure));
      });
    return () => {
      active = false;
    };
  }, []);
  if (error) return <MessageBar intent="error">{error}</MessageBar>;
  if (!calendar) return <Spinner label="Loading the church calendar" />;
  return (
    <>
      <section className="card">
        <h2>Add the church calendar to your own</h2>
        <p>
          Subscribe once and your calendar app keeps these dates up to date,
          including changes and cancellations.
        </p>
        <div className="toolbar wrap">
          <a className="link-button" href={webcal(publicFeedUrl)}>
            Subscribe to the church calendar
          </a>
          <a href={publicFeedUrl}>Download the calendar file</a>
        </div>
      </section>
      <div className="event-grid">
        {calendar.occurrences.map((row) => (
          <article key={row.id} className="card">
            <span className="eyebrow">
              {when(DateTime.fromISO(row.start).setZone(calendar.zone))}
            </span>
            <h2>{row.title}</h2>
            {row.location && <p>{row.location}</p>}
            {row.description && <p>{row.description}</p>}
          </article>
        ))}
      </div>
      {!calendar.occurrences.length && (
        <div className="card">
          <h2>No public gatherings are listed yet</h2>
          <p>Please check again later or contact the church office.</p>
        </div>
      )}
    </>
  );
}

export function Subscriptions() {
  const [feeds, setFeeds] = useState<CalendarFeed[] | null>(null);
  const [created, setCreated] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setFeeds(await listFeeds());
  }
  useEffect(() => {
    let active = true;
    void listFeeds()
      .then((value) => {
        if (active) setFeeds(value);
      })
      .catch((failure) => {
        if (active) setError(portalError(failure));
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(portalError(failure));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = String(new FormData(event.currentTarget).get("label"));
    void run(async () => setCreated((await createFeed(label)).url));
  }
  return (
    <div className="profile-grid">
      <form className="card" onSubmit={submit}>
        <h2>Subscribe in my calendar app</h2>
        <p>
          Your private calendar lists the gatherings shown to members and your
          serving dates. It never includes other people's responses or care
          visits.
        </p>
        <Field label="Name this subscription" required>
          <Input name="label" required maxLength={60} placeholder="My phone" />
        </Field>
        <Button type="submit" appearance="primary" disabled={busy}>
          Create private calendar link
        </Button>
        {created && (
          <MessageBar intent="success" layout="multiline">
            <div className="feed-link">
              <span>
                Add this link to your calendar app now. It is shown only once
                and works for one year. Anyone with the link can see these
                dates, so keep it private.
              </span>
              <code>{created}</code>
              <div className="toolbar wrap">
                <a className="link-button" href={webcal(created)}>
                  Open in my calendar app
                </a>
                <Button
                  onClick={() => void navigator.clipboard?.writeText(created)}
                >
                  Copy link
                </Button>
              </div>
            </div>
          </MessageBar>
        )}
      </form>
      <section className="card">
        <h2>My calendar links</h2>
        {error && <MessageBar intent="error">{error}</MessageBar>}
        {feeds === null ? (
          <p>Loading your calendar links</p>
        ) : feeds.length ? (
          <ul className="request-list">
            {feeds.map((feed) => (
              <li key={feed.id}>
                <strong>{feed.label}</strong>
                <span>
                  Created{" "}
                  {DateTime.fromISO(feed.createdAt).toFormat("LLL d, yyyy")} ·
                  Works until{" "}
                  {DateTime.fromISO(feed.expiresAt).toFormat("LLL d, yyyy")}
                  {feed.lastUsedAt
                    ? ` · Last used ${DateTime.fromISO(feed.lastUsedAt).toFormat("LLL d")}`
                    : " · Not used yet"}
                </span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await revokeFeed(feed.id);
                      setCreated("");
                    })
                  }
                >
                  Stop {feed.label}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No calendar links yet.</p>
        )}
      </section>
    </div>
  );
}
