import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  Checkbox,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  Select,
  Spinner,
  Tab,
  TabList,
  Textarea,
  Title3,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import { lightTheme } from "../../desktop/renderer/theme/brand";
import {
  memberReturnTab,
  type DirectoryEntry,
  type DirectoryPreferences,
} from "@sycamore/shared";
import {
  auth,
  getDirectory,
  getMe,
  getMemberEvents,
  getPhoto,
  getPublicEvents,
  local,
  portalConfigured,
  portalError,
  rsvp,
  pendingSignInLink,
  saveSharing,
  signOutPortal,
  submitForm,
  usePortalAuth,
  verifyEmail,
  type MemberProfile,
  type PortalEvent,
} from "./data";
import "./style.css";
import { StaffSecurity } from "./StaffSecurity";
import { AccountSettings, FinishSignIn, SignIn } from "./Account";
import { MyDetails } from "./Profile";
// Read once at load: the link is removed from the address bar before React renders.
const initialLink =
  location.pathname === "/staff-security" ? null : pendingSignInLink();
const initialTab =
  memberReturnTab(initialLink?.target ?? `/${location.search}`) || "directory";
function App() {
  const session = usePortalAuth();
  const [link, setLink] = useState(initialLink);
  const [tab, setTab] = useState(link ? "signin" : "events");
  useEffect(() => {
    if (session.user) setLink(null);
  }, [session.user]);
  return (
    <FluentProvider theme={lightTheme} className="portal">
      <header>
        <a className="wordmark" href="/">
          SYCAMORE RPC
        </a>
        <span>Church portal</span>
        {session.user && (
          <Button onClick={() => void signOutPortal()}>Sign out</Button>
        )}
      </header>
      <main>
        {local && (
          <MessageBar intent="info">
            Local demonstration with fictional people. No live church forms or
            accounts are connected.
          </MessageBar>
        )}
        {!portalConfigured && (
          <MessageBar intent="warning">
            The church portal needs administrator setup before forms can be
            submitted.
          </MessageBar>
        )}
        {session.loading ? (
          <Spinner label="Opening portal" />
        ) : session.user ? (
          <Member key={session.user.uid} />
        ) : link ? (
          <FinishSignIn
            pending={link}
            done={() => {
              setLink(null);
              setTab("signin");
            }}
          />
        ) : (
          <>
            <div className="intro">
              <span className="eyebrow">WELCOME TO SYCAMORE</span>
              <Title3 as="h1">Life together, throughout the week</Title3>
              <p>
                Find a church gathering, let us know you are visiting, or sign
                in to the member directory.
              </p>
            </div>
            <TabList
              selectedValue={tab}
              onTabSelect={(_, row) => setTab(String(row.value))}
            >
              <Tab value="events">Church events</Tab>
              <Tab value="visit">Plan a visit</Tab>
              <Tab value="signin">Member sign in</Tab>
            </TabList>
            {tab === "signin" ? (
              <SignIn returnTo={`/?tab=${initialTab}`} />
            ) : tab === "visit" ? (
              <OnlineForm kind="visitor" />
            ) : (
              <PublicEvents />
            )}
          </>
        )}
      </main>
      <footer>
        Sycamore Reformed Presbyterian Church · Keep member contact details
        within the congregation.
      </footer>
    </FluentProvider>
  );
}
function PublicEvents() {
  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [selected, setSelected] = useState<PortalEvent | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void getPublicEvents()
      .then((rows) => {
        if (active) {
          setEvents(rows);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (active) setError(portalError(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {!loaded && !error ? (
        <Spinner label="Loading published gatherings" />
      ) : (
        <>
          <div className="event-grid">
            {events.map((event) => (
              <article key={event.id} className="card">
                <span className="eyebrow">
                  {DateTime.fromISO(event.start)
                    .setZone(event.zone)
                    .toFormat("LLL d, yyyy · h:mm a")}
                </span>
                <h2>{event.title}</h2>
                <p>{event.description}</p>
                <p>{event.location}</p>
                <Button appearance="primary" onClick={() => setSelected(event)}>
                  Request registration for {event.title}
                </Button>
              </article>
            ))}
          </div>
          {!events.length && (
            <div className="card">
              <h2>No registration forms are open</h2>
              <p>Please check again later or contact the church office.</p>
            </div>
          )}
          {selected && (
            <OnlineForm kind="event" event={selected} key={selected.id} />
          )}
        </>
      )}
    </>
  );
}
function OnlineForm({
  kind,
  event,
}: {
  kind: "visitor" | "event";
  event?: PortalEvent;
}) {
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(crypto.randomUUID());
  async function submit(input: FormEvent<HTMLFormElement>) {
    input.preventDefault();
    const form = new FormData(input.currentTarget);
    setBusy(true);
    setError("");
    try {
      await submitForm({
        requestId,
        kind,
        eventId: event?.eventId || "",
        date: event?.date || "",
        firstName: String(form.get("firstName")),
        lastName: String(form.get("lastName")),
        email: String(form.get("email")),
        mobilePhone: String(form.get("phone") || ""),
        message: String(form.get("message") || ""),
        website: String(form.get("website") || ""),
      });
      setReceived(true);
    } catch (error) {
      setError(portalError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card narrow"
      aria-label={
        kind === "visitor" ? "Visitor form" : "Event registration form"
      }
    >
      <h2>
        {kind === "visitor"
          ? "Plan a visit"
          : `Registration request · ${event?.title}`}
      </h2>
      {received ? (
        <MessageBar intent="success">
          Your request has been received for church staff to review. Event
          places are confirmed after review. This does not subscribe you to
          church messages.
        </MessageBar>
      ) : (
        <form onSubmit={submit}>
          <p>
            We will use these contact details to review your request. Please
            keep private pastoral matters out of this form.
          </p>
          <div className="two-columns">
            <Field label="First name" required>
              <Input
                name="firstName"
                required
                maxLength={100}
                autoComplete="given-name"
              />
            </Field>
            <Field label="Last name" required>
              <Input
                name="lastName"
                required
                maxLength={100}
                autoComplete="family-name"
              />
            </Field>
          </div>
          <Field label="Email" required>
            <Input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </Field>
          <Field label="Mobile phone, optional">
            <Input name="phone" type="tel" maxLength={40} autoComplete="tel" />
          </Field>
          <Field label="Message, optional">
            <Textarea name="message" maxLength={1000} rows={4} />
          </Field>
          <div className="honeypot" aria-hidden="true">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          {error && <MessageBar intent="error">{error}</MessageBar>}
          <Button
            appearance="primary"
            type="submit"
            disabled={busy || !portalConfigured}
          >
            {busy ? "Submitting" : "Submit request"}
          </Button>
        </form>
      )}
    </section>
  );
}
function Member() {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [tab, setTab] = useState<string>(initialTab);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const uid = auth.currentUser?.uid;
  async function refresh() {
    const result = await Promise.all([
      getMe(),
      getDirectory(),
      getMemberEvents(),
    ]);
    if (auth.currentUser?.uid === uid) {
      setProfile(result[0]);
      setDirectory(result[1]);
      setEvents(result[2]);
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.all([getMe(), getDirectory(), getMemberEvents()])
      .then(([me, rows, gatherings]) => {
        if (active) {
          setProfile(me);
          setDirectory(rows);
          setEvents(gatherings);
        }
      })
      .catch((error) => {
        if (active) setError(portalError(error));
      });
    const timer = setInterval(() => {
      void refresh().catch(() => {
        if (active) {
          setProfile(null);
          setDirectory([]);
          setEvents([]);
          setError("Your member access needs a fresh sign-in.");
        }
      });
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [uid]);
  async function perform(
    action: () => Promise<unknown>,
    message: string | ((result: unknown) => string),
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      await refresh();
      setNotice(typeof message === "string" ? message : message(result));
    } catch (error) {
      setError(portalError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="intro">
        <span className="eyebrow">WITHIN THE CONGREGATION</span>
        <Title3 as="h1">
          {profile ? `Welcome, ${profile.person.name}` : "Member area"}
        </Title3>
        <p>
          The directory includes only people who have chosen to share their
          details.
        </p>
      </div>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      {!profile ? (
        <div className="card">
          <p>
            Member access requires a verified email and a person link set by the
            church administrator.
          </p>
          {!auth.currentUser?.emailVerified && (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void verifyEmail()
                  .then(() =>
                    setNotice(
                      "A verification email was requested. Follow its link, then sign out and sign in again.",
                    ),
                  )
                  .catch((error) => setError(portalError(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Send verification email
            </Button>
          )}
          <Button
            onClick={() =>
              void perform(async () => {}, "Member records refreshed.")
            }
          >
            Refresh member access
          </Button>
        </div>
      ) : (
        <>
          <TabList
            selectedValue={tab}
            onTabSelect={(_, row) => setTab(String(row.value))}
          >
            <Tab value="directory">Directory</Tab>
            <Tab value="events">Events & my RSVPs</Tab>
            <Tab value="profile">My details</Tab>
            <Tab value="privacy">My sharing choices</Tab>
            <Tab value="account">Account</Tab>
          </TabList>
          {tab === "directory" ? (
            <>
              <div className="toolbar">
                <Field label="Search the member directory">
                  <Input
                    value={search}
                    onChange={(_, row) => setSearch(row.value)}
                  />
                </Field>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {}, "Directory refreshed.")
                  }
                >
                  Refresh directory
                </Button>
              </div>
              <div className="directory-grid">
                {directory
                  .filter((row) =>
                    row.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((row) => (
                    <article className="card" key={row.id}>
                      {row.hasPhoto && <DirectoryPhoto entry={row} />}
                      <h2>{row.name}</h2>
                      {row.email && (
                        <p>
                          <a href={`mailto:${row.email}`}>{row.email}</a>
                        </p>
                      )}
                      {row.phone && (
                        <p>
                          <a href={`tel:${row.phone}`}>{row.phone}</a>
                        </p>
                      )}
                      {row.address && (
                        <p className="preserve-lines">{row.address}</p>
                      )}
                    </article>
                  ))}
              </div>
              {!directory.length && (
                <p>No directory entries are being shared yet.</p>
              )}
            </>
          ) : tab === "account" ? (
            <AccountSettings />
          ) : tab === "profile" ? (
            <MyDetails
              key={JSON.stringify([
                profile.contact,
                profile.household,
                profile.hasPhoto,
              ])}
              profile={profile}
              personId={profile.person.id}
              busy={busy}
              perform={perform}
            />
          ) : tab === "privacy" ? (
            <Sharing
              key={profile.preferences.expectedRevision}
              value={profile.preferences}
              busy={busy}
              save={(next) =>
                perform(
                  () => saveSharing(next),
                  "Your directory sharing choices were saved.",
                )
              }
            />
          ) : (
            <>
              <div className="event-grid">
                {events.map((event) => {
                  const response = profile.rsvps.find(
                    (row) =>
                      row.eventId === event.eventId && row.date === event.date,
                  );
                  return (
                    <article className="card" key={event.id}>
                      <h2>{event.title}</h2>
                      <p>
                        {DateTime.fromISO(event.start)
                          .setZone(event.zone)
                          .toFormat("LLL d, yyyy · h:mm a")}
                      </p>
                      <p>{event.location}</p>
                      <p>{event.description}</p>
                      <Field
                        label={`My response for ${event.title} ${event.date}`}
                      >
                        <Select
                          disabled={busy}
                          value={response?.status || ""}
                          onChange={(input) => {
                            if (input.target.value)
                              void perform(
                                () =>
                                  rsvp({
                                    eventId: event.eventId,
                                    date: event.date,
                                    status: input.target.value,
                                  }),
                                "Your RSVP was saved.",
                              );
                          }}
                        >
                          <option value="">Choose a response</option>
                          <option value="yes">Attending</option>
                          <option value="maybe">Maybe</option>
                          <option value="no">Not attending</option>
                        </Select>
                      </Field>
                    </article>
                  );
                })}
              </div>
              <section className="card">
                <h2>My recorded responses</h2>
                {profile.rsvps.map((row) => (
                  <p key={`${row.eventId}_${row.date}`}>
                    {events.find((event) => event.eventId === row.eventId)
                      ?.title || "Church event"}{" "}
                    · {row.date} · {row.status}
                  </p>
                ))}
                {!profile.rsvps.length && <p>No responses recorded yet.</p>}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
function DirectoryPhoto({ entry }: { entry: DirectoryEntry }) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getPhoto(entry.id)
      .then((value) => {
        if (active) setPhoto(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [entry.id]);
  return photo ? (
    <img className="member-photo" src={photo} alt={`Photo of ${entry.name}`} />
  ) : null;
}
function Sharing({
  value,
  busy,
  save,
}: {
  value: DirectoryPreferences;
  busy: boolean;
  save: (next: DirectoryPreferences) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <section className="card narrow">
      <h2>My directory sharing choices</h2>
      <p>
        Sharing starts off. These choices affect the member directory only. They
        do not change email or text consent.
      </p>
      {(
        [
          ["listed", "Include my name in the member directory"],
          ["shareEmail", "Share my email with members"],
          ["sharePhone", "Share my mobile phone with members"],
          ["shareAddress", "Share my household address with members"],
          ["sharePhoto", "Share my photo with members"],
        ] as const
      ).map(([key, label]) => (
        <Checkbox
          key={key}
          label={label}
          checked={draft[key]}
          onChange={(_, row) =>
            setDraft((before) => ({ ...before, [key]: row.checked === true }))
          }
        />
      ))}
      <Button
        appearance="primary"
        disabled={busy}
        onClick={() => void save(draft)}
      >
        Save sharing choices
      </Button>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname === "/staff-security" ? <StaffSecurity /> : <App />}
  </StrictMode>,
);
