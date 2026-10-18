import {
  Timestamp,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { DateTime } from "luxon";
import {
  digestClock,
  digestText,
  mercyCategoryLabels,
  mercyOpen,
  visitState,
  type Channel,
  type DigestSection,
  type MercyCategory,
  type MercyStatus,
} from "@sycamore/shared";
import { db } from "../admin.js";
import {
  getChurchZone,
  getSettings,
  queueMessage,
} from "../communications/queue.js";
import { liveDeacons, mercySettings } from "./ministry.js";

type Planned = {
  householdId: string;
  start: string;
  durationMinutes: number;
  status: "planned";
  deaconUids: string[];
};
// Households, kinds of help, dates and times only. Details, outcomes, notes and task titles never leave.
export async function processDeaconDigests(now: Date) {
  const settings = await getSettings();
  const zone = await getChurchZone();
  const clock = digestClock(now, zone, settings);
  const channels = (
    settings.deaconDigestChannel === "both"
      ? (["email", "sms"] as Channel[])
      : [settings.deaconDigestChannel]
  ).filter((channel) =>
    channel === "email" ? settings.emailEnabled : settings.smsEnabled,
  );
  if (!clock.deacon || !channels.length) return;
  const local = DateTime.fromJSDate(now, { zone });
  const dateLabel = local.toFormat("LLL d, yyyy");
  const [
    deacons,
    chairs,
    households,
    assignments,
    requests,
    tasks,
    mercy,
    joint,
  ] = await Promise.all([
    liveDeacons(),
    mercySettings(),
    db.collection("households").get(),
    db.collection("mercyAssignments").get(),
    db.collection("mercyRequests").get(),
    db.collection("mercyTasks").where("done", "==", false).get(),
    db.collection("mercyVisits").where("status", "==", "planned").get(),
    db.collection("pastoralVisits").where("status", "==", "planned").get(),
  ]);
  const household = (id: string) =>
    (households.docs.find((row) => row.id === id)?.get("name") as string) ||
    "Household";
  const homes = new Map(
    assignments.docs.map((row) => [
      row.id,
      (row.get("deaconUids") || []) as string[],
    ]),
  );
  const help = (row: QueryDocumentSnapshot) =>
    `${household(row.get("householdId"))} · ${mercyCategoryLabels[row.get("category") as MercyCategory]}${row.get("neededBy") ? ` · by ${row.get("neededBy")}` : ""}${row.get("urgent") ? " · Urgent" : ""}`;
  const planned = (rows: typeof mercy): Planned[] =>
    rows.docs.map((row) => ({
      householdId: row.get("householdId"),
      start: (row.get("start") as Timestamp).toDate().toISOString(),
      durationMinutes: row.get("durationMinutes"),
      status: "planned",
      deaconUids: row.get("deaconUids") || [],
    }));
  const visits = [...planned(mercy), ...planned(joint)].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  // One entry per person, so a deacon with two accounts receives one notice.
  const people = new Map<string, string[]>();
  for (const deacon of deacons)
    if (deacon.personId)
      people.set(deacon.personId, [
        ...(people.get(deacon.personId) || []),
        deacon.uid,
      ]);
  for (const [personId, uids] of people) {
    const serves = (row: QueryDocumentSnapshot) =>
      ((row.get("deaconUids") || []) as string[]).some((uid) =>
        uids.includes(uid),
      ) ||
      (homes.get(row.get("householdId")) || []).some((uid) =>
        uids.includes(uid),
      );
    const own = visits.filter((visit) =>
      visit.deaconUids.some((uid) => uids.includes(uid)),
    );
    const sections: DigestSection[] = [
      {
        title: "Requests waiting for triage",
        names: uids.some((uid) => chairs.chairUids.includes(uid))
          ? requests.docs.filter((row) => row.get("status") === "new").map(help)
          : [],
      },
      {
        title: "Your open requests",
        names: requests.docs
          .filter(
            (row) => mercyOpen(row.get("status") as MercyStatus) && serves(row),
          )
          .map(help),
      },
      {
        // Task titles are private, so the summary names only the household and date.
        title: "Your tasks due",
        names: tasks.docs
          .filter(
            (row) =>
              uids.includes(row.get("assignedToUid")) &&
              String(row.get("dueDate")) <= clock.date,
          )
          .map(
            (row) =>
              `${household(row.get("householdId"))} · ${row.get("dueDate")}`,
          ),
      },
      {
        title: "Visits today",
        names: own
          .filter(
            (visit) =>
              DateTime.fromISO(visit.start, { zone }).toISODate() ===
              clock.date,
          )
          .map(
            (visit) =>
              `${DateTime.fromISO(visit.start, { zone }).toFormat("h:mm a")} · ${household(visit.householdId)}`,
          ),
      },
      {
        title: "Overdue visits",
        names: own
          .filter((visit) => visitState(visit, now) === "overdue")
          .map((visit) => household(visit.householdId)),
      },
    ];
    for (const channel of channels) {
      const body = digestText(
        sections,
        channel,
        dateLabel,
        "Mercy ministry summary",
      );
      if (!body) break;
      // Session-only in the message log; dispatch rechecks a live deacon role instead of Session.
      await queueMessage(
        {
          requestId: `deacon_${clock.date}_${personId}_${channel}`,
          channel,
          subject: channel === "email" ? "Mercy ministry summary" : "",
          body,
          audience: { kind: "people", ids: [personId] },
          scheduledFor: null,
          confirmLarge: true,
        },
        "automation",
        {
          automatic: true,
          sessionOnly: true,
          recipientRole: "deacon",
          source: "deacon-digest",
        },
      );
    }
  }
}
