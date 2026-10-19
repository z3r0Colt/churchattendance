import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import {
  SESSION_ROLES,
  absencePeople,
  contactGaps,
  digestClock,
  digestText,
  hasRole,
  roleSchema,
  visitState,
  type Channel,
  type CommunicationSettings,
  type DigestSection,
  type Person,
  type Service,
} from "@sycamore/shared";
import { db } from "../admin.js";
import {
  getChurchZone,
  getSettings,
  isSessionPerson,
  queueMessage,
} from "../communications/queue.js";
import { contactEvents, contactPolicy } from "./contact.js";
import { waitingMemberRequests } from "../member/requests.js";

type Visit = {
  id: string;
  householdId: string;
  start: string;
  durationMinutes: number;
  officerUids: string[];
  status: "planned";
};
function channels(settings: CommunicationSettings): Channel[] {
  return (
    settings.digestChannel === "both"
      ? (["email", "sms"] as const)
      : [settings.digestChannel]
  ).filter((channel) =>
    channel === "email" ? settings.emailEnabled : settings.smsEnabled,
  );
}
async function sendDigest(
  id: string,
  personId: string,
  sections: DigestSection[],
  settings: CommunicationSettings,
  dateLabel: string,
) {
  for (const channel of channels(settings)) {
    const body = digestText(sections, channel, dateLabel);
    if (!body) return;
    // Deterministic IDs make a repeated tick a no-op. Session-only messages are rechecked at dispatch.
    await queueMessage(
      {
        requestId: `${id}_${channel}`,
        channel,
        subject: channel === "email" ? "Shepherding summary" : "",
        body,
        audience: { kind: "people", ids: [personId] },
        scheduledFor: null,
        confirmLarge: true,
      },
      "automation",
      { automatic: true, sessionOnly: true, source: "shepherding-digest" },
    );
  }
}
// Live Session officers with a linked person record, one entry per person.
async function sessionOfficers() {
  const users = await db.collection("users").get();
  const officers = new Map<string, string[]>();
  for (const row of users.docs) {
    const personId = row.get("personId") as string | undefined;
    if (!personId) continue;
    const account = await getAuth()
      .getUser(row.id)
      .catch(() => null);
    if (
      !account ||
      account.disabled ||
      !hasRole(
        roleSchema.array().catch([]).parse(account.customClaims?.roles),
        SESSION_ROLES,
      )
    )
      continue;
    officers.set(personId, [...(officers.get(personId) || []), row.id]);
  }
  return officers;
}
export async function processShepherdingDigests(now: Date) {
  const settings = await getSettings();
  const zone = await getChurchZone();
  const clock = digestClock(now, zone, settings);
  if ((!clock.weekly && !clock.daily) || !channels(settings).length) return;
  const local = DateTime.fromJSDate(now, { zone });
  const dateLabel = local.toFormat("LLL d, yyyy");
  const [people, households, visitRows, officers] = await Promise.all([
    db.collection("people").get(),
    db.collection("households").get(),
    db.collection("pastoralVisits").where("status", "==", "planned").get(),
    sessionOfficers(),
  ]);
  const roll = people.docs.map(
    (row) => ({ ...row.data(), id: row.id }) as Person,
  );
  const name = (person: Person) => `${person.firstName} ${person.lastName}`;
  const household = (id: string) =>
    households.docs.find((row) => row.id === id)?.get("name") || "Household";
  const visits: Visit[] = visitRows.docs.map((row) => ({
    id: row.id,
    householdId: row.get("householdId"),
    start: (row.get("start") as Timestamp).toDate().toISOString(),
    durationMinutes: row.get("durationMinutes"),
    officerUids: row.get("officerUids"),
    status: "planned",
  }));
  const at = (visit: Visit) =>
    DateTime.fromISO(visit.start, { zone }).toFormat("h:mm a");
  const visitsFor = (uids: string[]) =>
    visits
      .filter((visit) => visit.officerUids.some((uid) => uids.includes(uid)))
      .sort((a, b) => a.start.localeCompare(b.start));
  if (clock.weekly) {
    const [districts, services, policy] = await Promise.all([
      db.collection("elderDistricts").get(),
      settings.absenceServiceTypeId
        ? db
            .collection("services")
            .where("serviceTypeId", "==", settings.absenceServiceTypeId)
            .where(
              "date",
              ">=",
              local.minus({ weeks: settings.absenceWeeks + 1 }).toISODate(),
            )
            .get()
        : null,
      contactPolicy(),
    ]);
    const absent = services
      ? absencePeople(
          roll,
          services.docs.map(
            (row) => ({ ...row.data(), id: row.id }) as Service,
          ),
          settings.absenceServiceTypeId,
          now,
          zone,
          settings.absenceWeeks,
        )
      : [];
    const contact = policy
      ? await contactEvents(policy.countPersonalMessages)
      : null;
    const gaps =
      policy && contact
        ? contactGaps(
            roll,
            contact.events,
            policy,
            clock.date,
            contact.rollEntry,
          ).filter((row) => row.state === "gap")
        : [];
    const weekEnd = local.plus({ days: 7 }).toMillis();
    for (const district of districts.docs) {
      const elder = district.get("elderPersonId") as string;
      if (
        district.get("archived") === true ||
        !elder ||
        !(await isSessionPerson(elder))
      )
        continue;
      const members = roll.filter(
        (person) => person.elderDistrictId === district.id,
      );
      const own = visitsFor(officers.get(elder) || []);
      await sendDigest(
        `digest_${clock.date}_${district.id}`,
        elder,
        [
          {
            title: `Absent the last ${settings.absenceWeeks} recorded Lord's Days`,
            names: absent
              .filter((person) => person.elderDistrictId === district.id)
              .map(name),
          },
          {
            title: "Contact gaps",
            names: gaps
              .map((row) =>
                members.find((person) => person.id === row.personId),
              )
              .filter((person): person is Person => !!person)
              .map(name),
          },
          {
            title: "Your overdue visits",
            names: own
              .filter((visit) => visitState(visit, now) === "overdue")
              .map((visit) => household(visit.householdId)),
          },
          {
            title: "Your visits in the next seven days",
            names: own
              .filter(
                (visit) =>
                  visitState(visit, now) === "upcoming" &&
                  Date.parse(visit.start) <= weekEnd,
              )
              .map(
                (visit) =>
                  `${DateTime.fromISO(visit.start, { zone }).toFormat("ccc LLL d")} ${at(visit)} · ${household(visit.householdId)}`,
              ),
          },
        ],
        settings,
        dateLabel,
      );
    }
  }
  if (clock.daily) {
    const [followUps, mercyVisits, memberRequests] = await Promise.all([
      db.collection("followUps").where("done", "==", false).get(),
      db.collection("mercyVisits").where("status", "==", "planned").get(),
      waitingMemberRequests(zone),
    ]);
    // Deacon-led visits an officer was invited to, as time and household only.
    const invited = (uids: string[]) =>
      mercyVisits.docs
        .map((row) => ({
          householdId: row.get("householdId") as string,
          start: (row.get("start") as Timestamp).toDate().toISOString(),
          officerUids: (row.get("officerUids") || []) as string[],
        }))
        .filter(
          (visit) =>
            visit.officerUids.some((uid) => uids.includes(uid)) &&
            DateTime.fromISO(visit.start, { zone }).toISODate() === clock.date,
        )
        .sort((a, b) => a.start.localeCompare(b.start));
    for (const [personId, uids] of officers) {
      const own = visitsFor(uids);
      await sendDigest(
        `daily_${clock.date}_${personId}`,
        personId,
        [
          {
            title: "Visits today",
            names: own
              .filter(
                (visit) =>
                  DateTime.fromISO(visit.start, { zone }).toISODate() ===
                  clock.date,
              )
              .map((visit) => `${at(visit)} · ${household(visit.householdId)}`),
          },
          {
            title: "Deacon visits you are invited to today",
            names: invited(uids).map(
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
          {
            // Every Session officer reads these. The summary gives the kind and
            // date only, never the member's name or words.
            title: "New prayer and pastoral requests",
            names: memberRequests,
          },
          {
            // Follow-up titles are private, so the summary names only the person.
            title: "Follow-ups due",
            names: followUps.docs
              .filter(
                (row) =>
                  uids.includes(row.get("assignedToUid")) &&
                  String(row.get("dueDate")) <= clock.date,
              )
              .map((row) => {
                const person = roll.find((p) => p.id === row.get("personId"));
                return person ? name(person) : "Person removed";
              }),
          },
        ],
        settings,
        dateLabel,
      );
    }
  }
}
