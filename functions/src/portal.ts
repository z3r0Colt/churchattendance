import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import {
  Timestamp,
  FieldValue,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHmac } from "node:crypto";
import { DateTime } from "luxon";
import {
  EDITOR_ROLES,
  portalAccessSchema,
  directoryPreferencesSchema,
  eventPublicationSchema,
  memberRsvpSchema,
  onlineFormSchema,
  reviewSubmissionSchema,
  portalDirectoryEntry,
  eventFromRecord,
  eventOccurrences,
  normalizePhone,
  personInputSchema,
  membershipEventSchema,
  toRoster,
  isAdultOn,
  type Person,
  type Household,
} from "@sycamore/shared";
import { db } from "./admin.js";
import { requireRoles, parse } from "./access.js";
import { emulatorMode } from "./communications/environment.js";
import { getChurchZone } from "./communications/queue.js";
const origin = defineString("PORTAL_ORIGIN", {
  default: "https://not-configured.invalid",
});
const rateKey = defineSecret("PORTAL_RATE_LIMIT_KEY");
export const portalOptions = { enforceAppCheck: !emulatorMode() };
export function portalRequest(request: CallableRequest) {
  if (!emulatorMode() && request.rawRequest.header("origin") !== origin.value())
    throw new HttpsError(
      "permission-denied",
      "Open the church portal to use this feature.",
    );
}
const eventView = (document: DocumentSnapshot) =>
  eventFromRecord(document.id, document.data()!);
export async function member(request: CallableRequest) {
  portalRequest(request);
  if (!request.auth)
    throw new HttpsError(
      "unauthenticated",
      "Sign in with your member account.",
    );
  const [access, user] = await Promise.all([
    db.doc(`portalAccess/${request.auth.uid}`).get(),
    getAuth()
      .getUser(request.auth.uid)
      .catch(() => null),
  ]);
  if (
    !access.get("enabled") ||
    !user ||
    user.disabled ||
    !user.emailVerified ||
    request.auth.token.kiosk
  )
    throw new HttpsError(
      "permission-denied",
      "A verified account linked by the church administrator is required.",
    );
  const person = await db.doc(`people/${access.get("personId")}`).get();
  if (
    !person.exists ||
    person.get("isDeceased") ||
    !["communicant", "baptized", "nonResident", "adherent"].includes(
      person.get("membershipStatus"),
    )
  )
    throw new HttpsError(
      "permission-denied",
      "This account's portal access is unavailable.",
    );
  return {
    uid: user.uid,
    person: { ...person.data(), id: person.id } as Person,
  };
}
export const setPortalAccess = onCall(async (request) => {
  const actor = await requireRoles(request, ["admin", "pastor"]);
  const input = parse(portalAccessSchema, request.data);
  if (input.uid.startsWith("kiosk_"))
    throw new HttpsError(
      "invalid-argument",
      "Kiosk identities cannot become member accounts.",
    );
  const [user, person] = await Promise.all([
    getAuth()
      .getUser(input.uid)
      .catch(() => null),
    db.doc(`people/${input.personId}`).get(),
  ]);
  if (
    !user ||
    (input.enabled && user.disabled) ||
    !person.exists ||
    (input.enabled &&
      (person.get("isDeceased") ||
        !["communicant", "baptized", "nonResident", "adherent"].includes(
          person.get("membershipStatus"),
        )))
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose an existing enabled Auth account and person.",
    );
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`portalAccess/${input.uid}`);
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "Portal access changed. Refresh before saving.",
      );
    transaction.set(ref, {
      personId: input.personId,
      enabled: input.enabled,
      revision: input.expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});
export const publishPortalEvent = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(eventPublicationSchema, request.data);
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`eventPublications/${input.eventId}`);
    const [before, event] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`events/${input.eventId}`)),
    ]);
    if (!event.exists)
      throw new HttpsError("not-found", "Choose an existing event series.");
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "The publication setting changed. Refresh before saving.",
      );
    const { expectedRevision, ...data } = input;
    transaction.set(ref, {
      ...data,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});
async function publishedEvents(publicOnly: boolean) {
  const [publications, events, zone] = await Promise.all([
    db
      .collection("eventPublications")
      .where(publicOnly ? "publicRegistration" : "portalVisible", "==", true)
      .get(),
    db.collection("events").get(),
    getChurchZone(),
  ]);
  const now = DateTime.now().setZone(zone),
    from = now.toISODate()!,
    to = now.plus({ days: 90 }).toISODate()!;
  return publications.docs
    .flatMap((publication) => {
      const event = events.docs.find((row) => row.id === publication.id);
      if (!event) return [];
      return eventOccurrences(eventView(event), from, to, zone)
        .filter((row) => Date.parse(row.end) > Date.now())
        .map((row) => ({
          ...row,
          description: publication.get("description") || "",
          zone,
        }));
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
export const portalPublicEvents = onCall(portalOptions, async (request) => {
  portalRequest(request);
  return publishedEvents(true);
});
export const portalMemberEvents = onCall(portalOptions, async (request) => {
  await member(request);
  return publishedEvents(false);
});
export const portalMe = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const [preferences, responses, household, zone] = await Promise.all([
    db.doc(`directoryPreferences/${current.person.id}`).get(),
    db
      .collectionGroup("rsvps")
      .where("personId", "==", current.person.id)
      .get(),
    db.doc(`households/${current.person.householdId}`).get(),
    getChurchZone(),
  ]);
  return {
    person: {
      id: current.person.id,
      name: `${current.person.firstName} ${current.person.lastName}`,
      email: current.person.email,
      phone: current.person.mobilePhone,
    },
    contact: {
      preferredName: current.person.preferredName || "",
      email: current.person.email || "",
      mobilePhone: current.person.mobilePhone || "",
      smsOptIn: current.person.smsOptIn === true,
    },
    household: {
      name: String(household.get("name") || ""),
      address: String(household.get("address") || ""),
      homePhone: String(household.get("homePhone") || ""),
      canEdit: isAdultOn(
        current.person.birthDate || "",
        DateTime.now().setZone(zone).toISODate()!,
      ),
    },
    hasPhoto: !!current.person.photoPath,
    preferences: {
      ...directoryPreferencesSchema.parse({
        listed: preferences.get("listed") || false,
        shareEmail: preferences.get("shareEmail") || false,
        sharePhone: preferences.get("sharePhone") || false,
        shareAddress: preferences.get("shareAddress") || false,
        sharePhoto: preferences.get("sharePhoto") || false,
      }),
      expectedRevision: Number(preferences.get("revision") || 0),
    },
    rsvps: responses.docs
      .filter((row) => /^events\/[^/]+\/rsvps\/[^/]+$/.test(row.ref.path))
      .map((row) => ({
        eventId: row.ref.parent.parent!.id,
        date: row.get("date"),
        status: row.get("status"),
      })),
  };
});
export const portalDirectory = onCall(portalOptions, async (request) => {
  await member(request);
  const [preferences, people, households] = await Promise.all([
    db.collection("directoryPreferences").where("listed", "==", true).get(),
    db.collection("people").get(),
    db.collection("households").get(),
  ]);
  return preferences.docs
    .flatMap((preference) => {
      const person = people.docs.find((row) => row.id === preference.id);
      if (!person) return [];
      const data = { ...person.data(), id: person.id } as Person;
      const house = households.docs.find((row) => row.id === data.householdId);
      const entry = portalDirectoryEntry(
        data,
        house ? ({ ...house.data(), id: house.id } as Household) : undefined,
        directoryPreferencesSchema.parse({
          listed: true,
          shareEmail: preference.get("shareEmail") || false,
          sharePhone: preference.get("sharePhone") || false,
          shareAddress: preference.get("shareAddress") || false,
          sharePhoto: preference.get("sharePhoto") || false,
        }),
      );
      return entry ? [entry] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});
export const saveDirectoryPreferences = onCall(
  portalOptions,
  async (request) => {
    const current = await member(request);
    const input = parse(directoryPreferencesSchema, request.data);
    await db.runTransaction(async (transaction) => {
      const ref = db.doc(`directoryPreferences/${current.person.id}`);
      const [before, access] = await Promise.all([
        transaction.get(ref),
        transaction.get(db.doc(`portalAccess/${current.uid}`)),
      ]);
      if (
        !access.get("enabled") ||
        access.get("personId") !== current.person.id
      )
        throw new HttpsError(
          "permission-denied",
          "Portal access changed. Sign in again.",
        );
      if (Number(before.get("revision") || 0) !== input.expectedRevision)
        throw new HttpsError(
          "aborted",
          "Your sharing settings changed. Refresh before saving.",
        );
      const { expectedRevision, ...data } = input;
      transaction.set(ref, {
        ...data,
        revision: expectedRevision + 1,
        updatedBy: current.uid,
        updatedAt: Timestamp.now(),
      });
    });
    return { saved: true };
  },
);
export const portalRsvp = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const input = parse(memberRsvpSchema, request.data),
    ref = db.doc(`events/${input.eventId}`);
  const zone = await getChurchZone();
  await db.runTransaction(async (transaction) => {
    const [event, publication, responses, access, person] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`eventPublications/${input.eventId}`)),
      transaction.get(ref.collection("rsvps").where("date", "==", input.date)),
      transaction.get(db.doc(`portalAccess/${current.uid}`)),
      transaction.get(db.doc(`people/${current.person.id}`)),
    ]);
    const occurrence = event.exists
      ? eventOccurrences(eventView(event), input.date, input.date, zone)[0]
      : null;
    if (
      !access.get("enabled") ||
      access.get("personId") !== current.person.id ||
      !person.exists ||
      person.get("isDeceased") ||
      person.get("membershipStatus") === "former"
    )
      throw new HttpsError(
        "permission-denied",
        "Portal access is unavailable.",
      );
    if (
      !publication.get("portalVisible") ||
      !occurrence ||
      Date.parse(occurrence.start) <= Date.now()
    )
      throw new HttpsError(
        "failed-precondition",
        "That event occurrence is closed.",
      );
    const count = responses.docs.filter(
      (row) =>
        row.id !== `${input.date}_${current.person.id}` &&
        row.get("status") === "yes",
    ).length;
    if (
      input.status === "yes" &&
      occurrence.capacity &&
      count >= occurrence.capacity
    )
      throw new HttpsError(
        "resource-exhausted",
        "This occurrence has reached its registration limit.",
      );
    transaction.update(ref, { rsvpVersion: FieldValue.increment(1) });
    transaction.set(
      ref.collection("rsvps").doc(`${input.date}_${current.person.id}`),
      {
        ...input,
        personId: current.person.id,
        updatedBy: current.uid,
        updatedAt: Timestamp.now(),
      },
    );
  });
  return { saved: true };
});
export const submitOnlineForm = onCall(
  { ...portalOptions, secrets: emulatorMode() ? [] : [rateKey] },
  async (request) => {
    portalRequest(request);
    const input = parse(onlineFormSchema, request.data);
    if (input.website) return { received: true };
    let phone = "";
    try {
      phone = normalizePhone(input.mobilePhone);
    } catch {
      throw new HttpsError(
        "invalid-argument",
        "Enter a valid full phone number.",
      );
    }
    if (input.kind === "event") {
      const [event, publication, zone] = await Promise.all([
        db.doc(`events/${input.eventId}`).get(),
        db.doc(`eventPublications/${input.eventId}`).get(),
        getChurchZone(),
      ]);
      const occurrence = event.exists
        ? eventOccurrences(eventView(event), input.date, input.date, zone)[0]
        : null;
      if (
        !publication.get("publicRegistration") ||
        !occurrence ||
        Date.parse(occurrence.start) <= Date.now()
      )
        throw new HttpsError(
          "failed-precondition",
          "That registration form is closed.",
        );
    }
    const ip = request.rawRequest.ip || "unknown";
    const secret = emulatorMode()
      ? "local-portal-rate-key-used-only-by-emulator"
      : rateKey.value();
    if (secret.length < 32)
      throw new HttpsError(
        "failed-precondition",
        "Online forms need administrator setup.",
      );
    const hash = createHmac("sha256", secret).update(ip).digest("hex");
    const hour = new Date().toISOString().slice(0, 13);
    const budget = db.doc(`portalBudgets/${hash}_${hour}`);
    const ref = db.doc(`onlineSubmissions/${input.requestId}`);
    await db.runTransaction(async (transaction) => {
      const [existing, rate] = await Promise.all([
        transaction.get(ref),
        transaction.get(budget),
      ]);
      if (existing.exists) return;
      if (Number(rate.get("count") || 0) >= 8)
        throw new HttpsError(
          "resource-exhausted",
          "Too many requests have arrived from this connection. Please try again later or contact the church office.",
        );
      transaction.set(budget, {
        count: Number(rate.get("count") || 0) + 1,
        expiresAt: Timestamp.fromMillis(Date.now() + 2 * 86400000),
      });
      const { website, ...data } = input;
      void website;
      transaction.create(ref, {
        ...data,
        mobilePhone: phone,
        status: "pending",
        createdAt: Timestamp.now(),
      });
    });
    return { received: true };
  },
);
export const reviewOnlineSubmission = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(reviewSubmissionSchema, request.data);
  const zone = await getChurchZone();
  const ref = db.doc(`onlineSubmissions/${input.id}`);
  const newPerson = db.collection("people").doc(),
    newHousehold = db.collection("households").doc();
  await db.runTransaction(async (transaction) => {
    const submission = await transaction.get(ref);
    if (!submission.exists)
      throw new HttpsError("not-found", "That request is unavailable.");
    if (submission.get("status") !== "pending") return;
    const personRef = input.personId
      ? db.doc(`people/${input.personId}`)
      : newPerson;
    const person = input.personId ? await transaction.get(personRef) : null;
    if (
      input.action === "approve" &&
      input.personId &&
      (!person?.exists ||
        person.get("isDeceased") ||
        person.get("membershipStatus") === "former")
    )
      throw new HttpsError(
        "invalid-argument",
        "Choose an active person, or create a visitor.",
      );
    const eventRef =
      submission.get("kind") === "event"
        ? db.doc(`events/${submission.get("eventId")}`)
        : null;
    const event = eventRef ? await transaction.get(eventRef) : null;
    const publication = eventRef
      ? await transaction.get(db.doc(`eventPublications/${eventRef.id}`))
      : null;
    const responses = eventRef
      ? await transaction.get(
          eventRef
            .collection("rsvps")
            .where("date", "==", submission.get("date")),
        )
      : null;
    if (input.action === "approve" && eventRef) {
      const occurrence = event?.exists
        ? eventOccurrences(
            eventView(event),
            submission.get("date"),
            submission.get("date"),
            zone,
          )[0]
        : null;
      if (
        !publication?.get("publicRegistration") ||
        !occurrence ||
        Date.parse(occurrence.start) <= Date.now()
      )
        throw new HttpsError(
          "failed-precondition",
          "The event is closed. Decline this request or arrange a new registration.",
        );
      const others = responses!.docs.filter(
        (row) =>
          row.id !== `${submission.get("date")}_${personRef.id}` &&
          row.get("status") === "yes",
      ).length;
      if (occurrence.capacity && others >= occurrence.capacity)
        throw new HttpsError(
          "resource-exhausted",
          "The event is full. Keep this request pending or decline it.",
        );
    }
    if (input.action === "approve" && !input.personId) {
      const data = personInputSchema.parse({
        firstName: submission.get("firstName"),
        lastName: submission.get("lastName"),
        email: submission.get("email"),
        mobilePhone: submission.get("mobilePhone"),
        householdId: newHousehold.id,
        membershipStatus: "visitor",
      });
      transaction.create(newHousehold, {
        name: data.lastName,
        address: "",
        homePhone: "",
      });
      transaction.create(newPerson, {
        ...data,
        updatedBy: actor.uid,
        updatedAt: Timestamp.now(),
      });
      transaction.create(
        db.doc(`attendanceRoster/${newPerson.id}`),
        toRoster(newPerson.id, data, data.lastName),
      );
      transaction.create(
        newPerson.collection("membershipEvents").doc(),
        membershipEventSchema.parse({
          date: DateTime.now().setZone(zone).toISODate(),
          fromStatus: null,
          toStatus: "visitor",
          method: "initial",
          reason: "Visitor request reviewed by church staff",
        }),
      );
    }
    if (input.action === "approve" && eventRef) {
      transaction.update(eventRef, { rsvpVersion: FieldValue.increment(1) });
      transaction.set(
        eventRef
          .collection("rsvps")
          .doc(`${submission.get("date")}_${personRef.id}`),
        {
          eventId: eventRef.id,
          date: submission.get("date"),
          personId: personRef.id,
          status: "yes",
          updatedBy: actor.uid,
          updatedAt: Timestamp.now(),
        },
      );
    }
    transaction.update(ref, {
      status: input.action === "approve" ? "approved" : "declined",
      approvedPersonId: input.action === "approve" ? personRef.id : "",
      reviewedBy: actor.uid,
      reviewedAt: Timestamp.now(),
      updatedBy: actor.uid,
    });
  });
  return { reviewed: true };
});
