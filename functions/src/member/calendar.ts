import {
  onCall,
  onRequest,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import {
  CALENDAR_FEED_DAYS,
  EDITOR_ROLES,
  buildCalendar,
  createCalendarFeedSchema,
  emptySecuritySchema,
  eventFromRecord,
  eventOccurrences,
  feedTokenPattern,
  occurrenceChangeSchema,
  revokeCalendarFeedSchema,
  type CalendarEntry,
  type CalendarFeed,
  type CalendarFeedScope,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { emulatorMode } from "../communications/environment.js";
import { getChurchZone } from "../communications/queue.js";
import { member, portalOptions, portalRequest } from "../portal.js";

const portalOrigin = defineString("PORTAL_ORIGIN", {
  default: "https://not-configured.invalid",
});
const UID_DOMAIN = "sycamorerpc.org";
const MAX_FEEDS = 5;
const eligible = ["communicant", "baptized", "nonResident", "adherent"];
const organizers = [...EDITOR_ROLES, "deacon"] as const;

// Change one date of a series: cancel it, move it, or restore it.
export const changeEventOccurrence = onCall(async (request) => {
  const actor = await requireRoles(request, organizers);
  const input = parse(occurrenceChangeSchema, request.data);
  const zone = await getChurchZone();
  const change =
    input.action === "reschedule"
      ? {
          start: Timestamp.fromDate(new Date(input.start)),
          end: Timestamp.fromDate(new Date(input.end)),
          location: input.location,
        }
      : input.action === "cancel"
        ? { cancelled: true }
        : FieldValue.delete();
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`events/${input.eventId}`);
    const event = await transaction.get(ref);
    if (!event.exists)
      throw new HttpsError("not-found", "That event could not be found.");
    if (Number(event.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This event changed. Reopen it before saving.",
      );
    const series = {
      ...eventFromRecord(event.id, event.data()!),
      exceptions: {},
    };
    if (
      !eventOccurrences(series, input.date, input.date, zone, {
        includeCancelled: true,
      }).length
    )
      throw new HttpsError(
        "invalid-argument",
        "Choose a date this event series meets on.",
      );
    transaction.update(
      ref,
      new FieldPath("exceptions", input.date),
      change,
      "revision",
      input.expectedRevision + 1,
      "updatedBy",
      actor.uid,
      "updatedAt",
      Timestamp.now(),
    );
  });
  return { saved: true };
});

type Audience = "public" | CalendarFeedScope;
const window = (zone: string) => {
  const now = DateTime.now().setZone(zone);
  return {
    from: now.minus({ days: 30 }).toISODate()!,
    to: now.plus({ days: CALENDAR_FEED_DAYS }).toISODate()!,
  };
};
// Event occurrences each audience may see. Feeds list titles, times, places
// and the published description only: never RSVPs, rosters or care visits.
async function eventEntries(audience: Audience, zone: string) {
  const { from, to } = window(zone);
  const [events, publications] = await Promise.all([
    db.collection("events").get(),
    db.collection("eventPublications").get(),
  ]);
  const published = new Map(publications.docs.map((row) => [row.id, row]));
  return events.docs.flatMap((row) => {
    const publication = published.get(row.id);
    if (
      (audience === "public" && publication?.get("publicCalendar") !== true) ||
      (audience === "member" && publication?.get("portalVisible") !== true)
    )
      return [];
    return eventOccurrences(
      eventFromRecord(row.id, row.data()),
      from,
      to,
      zone,
      {
        includeCancelled: true,
      },
    ).map((occurrence): CalendarEntry => ({
      uid: `${occurrence.id}@${UID_DOMAIN}`,
      title: occurrence.title,
      start: occurrence.start,
      end: occurrence.end,
      location: occurrence.location,
      description: String(publication?.get("description") || ""),
      cancelled: occurrence.cancelled,
      sequence: occurrence.revision,
    }));
  });
}
async function servingEntries(personId: string, zone: string) {
  if (!personId) return [];
  const { from, to } = window(zone);
  const rows = await db
    .collection("serving")
    .where("personId", "==", personId)
    .get();
  return rows.docs
    .filter((row) => row.get("date") >= from && row.get("date") <= to)
    .map((row): CalendarEntry => {
      const start = DateTime.fromISO(`${row.get("date")}T${row.get("time")}`, {
        zone,
      });
      return {
        uid: `serving_${row.id}@${UID_DOMAIN}`,
        title: `Serving: ${row.get("role")}`,
        start: start.toUTC().toISO()!,
        end: start.plus({ hours: 1 }).toUTC().toISO()!,
        location: String(row.get("location") || ""),
        description: "",
        cancelled: row.get("cancelled") === true,
        sequence: Number(row.get("revision") || 0),
      };
    });
}
async function churchName() {
  const settings = await db.doc("communicationSettings/church").get();
  return String(settings.get("churchName") || "Sycamore RPC");
}

export const portalPublicCalendar = onCall(portalOptions, async (request) => {
  portalRequest(request);
  const zone = await getChurchZone();
  const today = DateTime.now().setZone(zone);
  const until = today.plus({ days: 90 }).toISO()!;
  return {
    zone,
    occurrences: (await eventEntries("public", zone))
      .filter(
        (row) =>
          !row.cancelled &&
          Date.parse(row.end) > Date.now() &&
          row.start <= until,
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(({ uid, title, start, end, location, description }) => ({
        id: uid,
        title,
        start,
        end,
        location,
        description,
      })),
  };
});

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function feedUrl(token: string) {
  return emulatorMode()
    ? `http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT}/us-central1/calendarFeed/${token}.ics`
    : `${portalOrigin.value()}/calendar/${token}.ics`;
}
const feedView = (row: FirebaseFirestore.QueryDocumentSnapshot) =>
  ({
    id: row.id,
    label: row.get("label"),
    scope: row.get("scope"),
    createdAt: row.get("createdAt").toDate().toISOString(),
    expiresAt: row.get("expiresAt").toDate().toISOString(),
    lastUsedAt: row.get("lastUsedAt")?.toDate().toISOString() || "",
  }) as CalendarFeed;
async function ownFeeds(uid: string) {
  const rows = await db
    .collection("calendarFeeds")
    .where("uid", "==", uid)
    .get();
  return rows.docs
    .filter((row) => row.get("expiresAt").toMillis() > Date.now())
    .map(feedView)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
// The token is shown once. Only its hash is stored.
async function createFeed(
  uid: string,
  scope: CalendarFeedScope,
  personId: string,
  label: string,
) {
  if ((await ownFeeds(uid)).length >= MAX_FEEDS)
    throw new HttpsError(
      "resource-exhausted",
      "Remove an old calendar subscription before adding another.",
    );
  const token = randomBytes(32).toString("base64url");
  await db.doc(`calendarFeeds/${tokenHash(token)}`).create({
    uid,
    scope,
    personId,
    label,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 365 * 86400000),
  });
  return { url: feedUrl(token) };
}
async function revokeFeed(uid: string, id: string) {
  const ref = db.doc(`calendarFeeds/${id}`);
  await db.runTransaction(async (transaction) => {
    const row = await transaction.get(ref);
    if (row.exists && row.get("uid") === uid) transaction.delete(ref);
  });
  return { revoked: true };
}

export const createMyCalendarFeed = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const { label } = parse(createCalendarFeedSchema, request.data);
  return createFeed(current.uid, "member", current.person.id, label);
});
export const myCalendarFeeds = onCall(portalOptions, async (request) => {
  const current = await member(request);
  return ownFeeds(current.uid);
});
export const revokeMyCalendarFeed = onCall(portalOptions, async (request) => {
  const current = await member(request);
  return revokeFeed(
    current.uid,
    parse(revokeCalendarFeedSchema, request.data).id,
  );
});
// The same roles that may read the church calendar in the desktop app.
const calendarReaders = [
  "admin",
  "pastor",
  "clerk",
  "elder",
  "deacon",
  "readOnly",
] as const;
const anyStaff = (request: CallableRequest) =>
  requireRoles(request, calendarReaders);
export const createStaffCalendarFeed = onCall(async (request) => {
  const actor = await anyStaff(request);
  const { label } = parse(createCalendarFeedSchema, request.data);
  const user = await db.doc(`users/${actor.uid}`).get();
  return createFeed(
    actor.uid,
    "staff",
    String(user.get("personId") || ""),
    label,
  );
});
export const staffCalendarFeeds = onCall(async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  const actor = await anyStaff(request);
  return ownFeeds(actor.uid);
});
export const revokeStaffCalendarFeed = onCall(async (request) => {
  const actor = await anyStaff(request);
  return revokeFeed(
    actor.uid,
    parse(revokeCalendarFeedSchema, request.data).id,
  );
});

// The owner's access is checked live on every fetch, so revoking portal or
// staff access stops the feed even before the token itself is removed.
async function liveOwner(feed: FirebaseFirestore.DocumentSnapshot) {
  const uid = String(feed.get("uid"));
  const user = await getAuth()
    .getUser(uid)
    .catch(() => null);
  if (!user || user.disabled) return false;
  if (feed.get("scope") === "member") {
    const [access, person] = await Promise.all([
      db.doc(`portalAccess/${uid}`).get(),
      db.doc(`people/${feed.get("personId")}`).get(),
    ]);
    return (
      access.get("enabled") === true &&
      access.get("personId") === feed.get("personId") &&
      user.emailVerified &&
      person.exists &&
      !person.get("isDeceased") &&
      eligible.includes(person.get("membershipStatus"))
    );
  }
  const access = await db.doc(`staffAccess/${uid}`).get();
  const roles = access.get("roles");
  return (
    access.get("enabled") === true &&
    access.get("locked") !== true &&
    Array.isArray(roles) &&
    roles.some((role) => (calendarReaders as readonly string[]).includes(role))
  );
}

export const calendarFeed = onRequest(async (request, response) => {
  const name = request.path.split("/").pop() || "";
  const notFound = () => {
    response.status(404).set("Cache-Control", "no-store").send("Not found");
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).set("Allow", "GET, HEAD").send("");
    return;
  }
  const zone = await getChurchZone();
  const church = await churchName();
  let audience: Audience = "public",
    personId = "";
  if (name !== "public.ics") {
    const token = name.replace(/\.ics$/, "");
    if (!feedTokenPattern.test(token)) return notFound();
    const feed = await db.doc(`calendarFeeds/${tokenHash(token)}`).get();
    if (
      !feed.exists ||
      feed.get("expiresAt").toMillis() <= Date.now() ||
      !(await liveOwner(feed))
    )
      return notFound();
    audience = feed.get("scope");
    personId = String(feed.get("personId") || "");
    // Record use at most hourly, so polling calendar apps do not write on every fetch.
    const used = feed.get("lastUsedAt") as Timestamp | undefined;
    if (!used || used.toMillis() < Date.now() - 3600000)
      await feed.ref.update({ lastUsedAt: Timestamp.now() });
  }
  const entries = [
    ...(await eventEntries(audience, zone)),
    ...(audience === "public" ? [] : await servingEntries(personId, zone)),
  ];
  const body = buildCalendar({
    name:
      audience === "public"
        ? `${church} events`
        : audience === "member"
          ? `${church} member calendar`
          : `${church} staff calendar`,
    zone,
    now: new Date(),
    entries,
  });
  response
    .status(200)
    .set("Content-Type", "text/calendar; charset=utf-8")
    .set(
      "Cache-Control",
      audience === "public" ? "public, max-age=900" : "private, no-store",
    )
    .set("X-Content-Type-Options", "nosniff")
    .set("Referrer-Policy", "no-referrer")
    .send(request.method === "HEAD" ? "" : body);
});
