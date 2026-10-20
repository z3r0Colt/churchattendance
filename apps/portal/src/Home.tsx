import { churchDayLabel } from "@sycamore/shared";
import { Button } from "@fluentui/react-components";
import { DateTime } from "luxon";
import { rsvp, type MemberProfile, type PortalEvent } from "./data";

const choices = [
  ["yes", "Attending"],
  ["maybe", "Maybe"],
  ["no", "Not attending"],
] as const;

// The member home: this Lord's Day's services, what is coming up with
// one-tap responses, and the two most used destinations.
export function Home({
  profile,
  events,
  busy,
  perform,
  go,
}: {
  profile: MemberProfile;
  events: PortalEvent[];
  busy: boolean;
  perform: (action: () => Promise<unknown>, message: string) => void;
  go: (section: "requests" | "directory" | "events") => void;
}) {
  const next = events.slice(0, 3);
  return (
    <div className="home">
      <section className="lords-day" aria-label="This Lord's Day">
        <span className="eyebrow">THIS LORD'S DAY</span>
        {profile.worship.length ? (
          profile.worship.map((service, index) => (
            <span
              key={service.name}
              className={index === 0 ? "service first" : "service"}
            >
              {service.name}, {service.time}
            </span>
          ))
        ) : (
          <span className="service">Service times are in the bulletin.</span>
        )}
      </section>
      <section className="coming-up">
        <div className="section-title">
          <h2>Coming up</h2>
          {events.length > next.length && (
            <Button appearance="subtle" onClick={() => go("events")}>
              See all
            </Button>
          )}
        </div>
        {next.length ? (
          next.map((event) => {
            const start = DateTime.fromISO(event.start).setZone(event.zone);
            const response = profile.rsvps.find(
              (row) => row.eventId === event.eventId && row.date === event.date,
            )?.status;
            return (
              <article className="card event-card" key={event.id}>
                <div className="event-head">
                  <span className="date-badge" aria-hidden="true">
                    <small>
                      {start.weekday === 7
                        ? "Lord's Day"
                        : start.toFormat("ccc")}
                    </small>
                    <strong>{start.day}</strong>
                  </span>
                  <span>
                    <strong>{event.title}</strong>
                    <small>
                      {churchDayLabel(start, "cccc, LLLL d · h:mm a")}
                      {event.location ? ` · ${event.location}` : ""}
                    </small>
                  </span>
                </div>
                <div
                  className="rsvp-choices"
                  role="group"
                  aria-label={`My response for ${event.title} ${event.date}`}
                >
                  {choices.map(([status, label]) => (
                    <Button
                      key={status}
                      aria-pressed={response === status}
                      appearance={response === status ? "primary" : "secondary"}
                      disabled={busy}
                      onClick={() =>
                        perform(
                          () =>
                            rsvp({
                              eventId: event.eventId,
                              date: event.date,
                              status,
                            }),
                          "Your RSVP was saved.",
                        )
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </article>
            );
          })
        ) : (
          <p className="quiet">No member gatherings are listed yet.</p>
        )}
      </section>
      <div className="quick-links">
        <button type="button" onClick={() => go("requests")}>
          <strong>Send a request</strong>
          <small>Prayer, care or practical help</small>
        </button>
        <button type="button" onClick={() => go("directory")}>
          <strong>Directory</strong>
          <small>Members who share their details</small>
        </button>
      </div>
    </div>
  );
}
