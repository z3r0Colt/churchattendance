import { useEffect, useState } from "react";
import {
  Button,
  MessageBar,
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import { LockClosedRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  attendanceStrip,
  statusLabels,
  type HistoryEvent,
  type Person,
  type Service,
  type ServiceType,
} from "@sycamore/shared";
import { directoryPhoto } from "../data/chms";
import { Records } from "./Common";
import { Family } from "./Family";

const longDate = (date: string) =>
  date ? DateTime.fromISO(date).toFormat("LLLL d, yyyy") : "";

// A person's page: header, then Overview, Attendance and Membership history.
export function PersonProfile({
  person,
  people,
  household,
  address,
  district,
  services,
  types,
  history,
  today,
  editor,
  session,
  back,
  edit,
  contact,
  openCare,
}: {
  person: Person;
  people: Person[];
  household: string;
  address: string;
  district: string;
  services: Service[];
  types: ServiceType[];
  history: (HistoryEvent & { id: string })[];
  today: string;
  editor: boolean;
  session: boolean;
  back: () => void;
  edit: () => void;
  contact: () => void;
  openCare: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [photo, setPhoto] = useState("");
  useEffect(() => {
    let active = true;
    setPhoto("");
    if (person.photoPath)
      void directoryPhoto(person.photoPath)
        .then((value) => {
          if (active) setPhoto(value);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [person.photoPath]);
  const name = `${person.preferredName || person.firstName} ${person.lastName}`;
  const initials = `${person.firstName[0] || ""}${person.lastName[0] || ""}`;
  const strip = attendanceStrip(services, person.id, today);
  const recorded = strip.filter((week) => week.state !== "unrecorded");
  const present = strip.filter((week) => week.state === "present");
  const attended = services
    .filter((row) => row.present[person.id])
    .sort((a, b) => b.date.localeCompare(a.date));
  const timeline = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const typeName = (id: string) =>
    types.find((type) => type.id === id)?.name || "Service";
  const birthday = person.birthDate
    ? DateTime.fromISO(person.birthDate).toFormat("LLLL d")
    : "";
  return (
    <>
      <Button appearance="subtle" className="back-link" onClick={back}>
        ‹ People &amp; households
      </Button>
      <header className="profile-header">
        {photo ? (
          <img className="profile-photo" src={photo} alt={`Photo of ${name}`} />
        ) : (
          <span className="profile-photo initials" aria-hidden="true">
            {initials}
          </span>
        )}
        <div className="profile-title">
          <Title3 as="h1">{name}</Title3>
          <div className="profile-tags">
            <span className="tag strong">
              {statusLabels[person.membershipStatus]}
            </span>
            <span className="tag">{household} household</span>
            {district && <span className="tag">{district}</span>}
            {person.isDeceased && <span className="tag">Deceased</span>}
          </div>
        </div>
        {editor && (
          <div className="actions">
            <Button onClick={contact}>Edit contact and consent</Button>
            <Button appearance="primary" onClick={edit}>
              Edit profile or status
            </Button>
          </div>
        )}
      </header>
      <TabList
        className="profile-tabs"
        selectedValue={tab}
        onTabSelect={(_, value) => setTab(String(value.value))}
      >
        <Tab value="overview">Overview</Tab>
        <Tab value="attendance">Attendance</Tab>
        <Tab value="membership">Membership history</Tab>
        <Tab value="family">Family</Tab>
      </TabList>
      {tab === "family" && (
        <Family person={person} people={people} editor={editor} />
      )}
      {tab === "overview" && (
        <div className="profile-grid">
          <div className="profile-main">
            <section className="surface communication-panel">
              <div className="section-heading">
                <h2>Lord's Days</h2>
                <span className="muted">
                  {recorded.length ? (
                    <>
                      <strong className="present-text">
                        {present.length} of {recorded.length}
                      </strong>{" "}
                      recorded in the last six months
                    </>
                  ) : (
                    "No Lord's Day services recorded in the last six months"
                  )}
                </span>
              </div>
              <div
                className="attendance-strip"
                role="img"
                aria-label={`Present on ${present.length} of ${recorded.length} recorded Lord's Days in the last six months.${
                  strip.some((week) => week.state === "absent")
                    ? ` Not marked on ${strip
                        .filter((week) => week.state === "absent")
                        .map((week) =>
                          DateTime.fromISO(week.date).toFormat("LLLL d"),
                        )
                        .join(", ")}.`
                    : ""
                }`}
              >
                {strip.map((week) => (
                  <span key={week.date} className={`week ${week.state}`} />
                ))}
              </div>
              <div className="strip-axis muted">
                <span>{DateTime.fromISO(strip[0].date).toFormat("LLL d")}</span>
                <span>
                  {DateTime.fromISO(strip.at(-1)!.date).toFormat("LLL d")}
                </span>
              </div>
              <div className="strip-legend">
                <span>
                  <span className="week present" aria-hidden="true" /> Present
                </span>
                <span>
                  <span className="week absent" aria-hidden="true" /> Not marked
                </span>
                <span>
                  <span className="week unrecorded" aria-hidden="true" /> No
                  service recorded
                </span>
              </div>
            </section>
            <section className="surface communication-panel">
              <h2>Membership</h2>
              {timeline.length ? (
                <ul className="timeline">
                  {timeline.slice(0, 4).map((event) => (
                    <li key={event.id}>
                      <span className="muted">{longDate(event.date)}</span>
                      <span>
                        <strong>
                          {event.fromStatus
                            ? `${statusLabels[event.fromStatus]} to ${statusLabels[event.toStatus]}`
                            : `Entered as ${statusLabels[event.toStatus]}`}
                        </strong>
                        {event.reason && (
                          <span className="muted">{event.reason}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <MessageBar intent="warning">
                  No membership history has been recorded. Annual counts will
                  flag this record for review.
                </MessageBar>
              )}
              {timeline.length > 4 && (
                <Button
                  appearance="subtle"
                  onClick={() => setTab("membership")}
                >
                  See all {timeline.length} changes
                </Button>
              )}
            </section>
          </div>
          <aside className="profile-side">
            <section className="surface communication-panel">
              <h2>Contact</h2>
              <dl className="facts">
                <div>
                  <dt>Email</dt>
                  <dd>{person.email || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Mobile</dt>
                  <dd>{person.mobilePhone || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd className="message-body">{address || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Church email</dt>
                  <dd>{person.emailOptIn ? "On" : "Off"}</dd>
                </div>
                <div>
                  <dt>Text messages</dt>
                  <dd>{person.smsOptIn ? "On" : "Off"}</dd>
                </div>
              </dl>
            </section>
            <section className="surface communication-panel">
              <h2>At a glance</h2>
              <dl className="facts">
                <div>
                  <dt>Birthday</dt>
                  <dd>{birthday || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Last attended</dt>
                  <dd>
                    {attended[0]
                      ? DateTime.fromISO(attended[0].date).toFormat(
                          "LLL d, yyyy",
                        )
                      : "No attendance recorded"}
                  </dd>
                </div>
              </dl>
            </section>
            {session && (
              <section className="surface communication-panel session-panel">
                <span className="session-badge">
                  <LockClosedRegular aria-hidden /> Session only
                </span>
                <p>
                  Notes, visits and follow-ups for {name} are kept in Pastoral
                  care.
                </p>
                <Button onClick={openCare}>Open pastoral care</Button>
              </section>
            )}
          </aside>
        </div>
      )}
      {tab === "attendance" && (
        <Records
          empty="No attendance has been recorded for this person."
          rows={attended.map((row) => ({
            id: row.id,
            Date: row.date,
            Service: typeName(row.serviceTypeId),
            Method:
              row.present[person.id].method === "kiosk" ? "Kiosk" : "Roll call",
            Worship:
              row.present[person.id].mode === "online" ? "Online" : "In person",
          }))}
        />
      )}
      {tab === "membership" && (
        <Records
          empty="No membership history has been recorded."
          rows={timeline.map((row) => ({
            id: row.id,
            Date: row.date,
            From: row.fromStatus
              ? statusLabels[row.fromStatus]
              : "Initial entry",
            To: statusLabels[row.toStatus],
            Method: row.method,
            "Other church": row.otherChurch,
            Reason: row.reason,
          }))}
        />
      )}
    </>
  );
}
