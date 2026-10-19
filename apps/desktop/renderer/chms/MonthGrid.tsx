import { Button } from "@fluentui/react-components";
import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { DateTime } from "luxon";
import {
  eventOccurrences,
  type ChurchEvent,
  type Occurrence,
} from "@sycamore/shared";

const weekdays = ["Lord's Day", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A month at a glance, weeks starting on the Lord's Day. Each occurrence is a
// button that opens its date; cancelled dates stay visible, struck through.
export function MonthGrid({
  events,
  zone,
  month,
  setMonth,
  selectedId,
  choose,
}: {
  events: ChurchEvent[];
  zone: string;
  month: string;
  setMonth: (month: string) => void;
  selectedId: string;
  choose: (occurrence: Occurrence) => void;
}) {
  const first = DateTime.fromISO(month, { zone });
  const start = first.minus({ days: first.weekday % 7 });
  const days = Array.from({ length: 42 }, (_, index) =>
    start.plus({ days: index }),
  );
  const today = DateTime.now().setZone(zone).toISODate();
  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of events
    .flatMap((event) =>
      eventOccurrences(
        event,
        start.minus({ days: 7 }).toISODate()!,
        days[41].plus({ days: 7 }).toISODate()!,
        zone,
        { includeCancelled: true },
      ),
    )
    .sort((a, b) => a.start.localeCompare(b.start))) {
    // A moved date shows on the day it now meets.
    const day = DateTime.fromISO(occurrence.start).setZone(zone).toISODate()!;
    byDay.set(day, [...(byDay.get(day) || []), occurrence]);
  }
  const step = (months: number) =>
    setMonth(first.plus({ months }).startOf("month").toISODate()!);
  return (
    <section className="surface month-panel" aria-label="Month">
      <div className="month-heading">
        <Button
          appearance="subtle"
          icon={<ChevronLeftRegular />}
          aria-label="Previous month"
          onClick={() => step(-1)}
        />
        <h2>{first.toFormat("LLLL yyyy")}</h2>
        <Button
          appearance="subtle"
          icon={<ChevronRightRegular />}
          aria-label="Next month"
          onClick={() => step(1)}
        />
        <Button
          onClick={() =>
            setMonth(DateTime.now().setZone(zone).startOf("month").toISODate()!)
          }
        >
          This month
        </Button>
      </div>
      <div className="month-grid">
        {weekdays.map((name) => (
          <span key={name} className="month-weekday" aria-hidden="true">
            {name}
          </span>
        ))}
        {days.map((day) => {
          const iso = day.toISODate()!;
          const here = byDay.get(iso) || [];
          return (
            <div
              key={iso}
              className={`month-day${day.month === first.month ? "" : " outside"}${iso === today ? " today" : ""}`}
            >
              <span className="month-date">
                <span className="visually-hidden">
                  {day.weekday === 7 ? "Lord's Day" : day.toFormat("cccc")},{" "}
                  {day.toFormat("LLLL")}{" "}
                </span>
                {day.day}
              </span>
              {here.map((occurrence) => {
                const time = DateTime.fromISO(occurrence.start)
                  .setZone(zone)
                  .toFormat("h:mm a");
                return (
                  <button
                    type="button"
                    key={occurrence.id}
                    className={`month-event${occurrence.cancelled ? " cancelled" : ""}${occurrence.id === selectedId ? " selected" : ""}`}
                    aria-label={`${occurrence.title}, ${day.toFormat("LLLL d")} at ${time}${occurrence.cancelled ? ", cancelled" : occurrence.changed ? ", changed for this date" : ""}`}
                    onClick={() => choose(occurrence)}
                  >
                    <span className="month-time">{time}</span>{" "}
                    {occurrence.title}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
