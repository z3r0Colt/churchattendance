import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { z } from "zod";
import {
  EDITOR_ROLES,
  SESSION_ROLES,
  createHouseholdSchema,
  hasRole,
  membershipEventSchema,
  personInputSchema,
  roleSchema,
  rolesInputSchema,
  savePersonSchema,
  toRoster,
  visitorInputSchema,
} from "@sycamore/shared";

import { db } from "./admin.js";
import { parse, requireRoles, requireRecent } from "./access.js";
import {
  protectRecord,
  privateKeys,
  privateOptions,
} from "./security/encryption.js";
import { securityEvent } from "./security/audit.js";
import {
  lockStaffAccount,
  finishStaffAccountChange,
} from "./security/account-lock.js";
export * from "./communications/api.js";
export * from "./chms.js";
export * from "./kiosk.js";
export * from "./chms-audit.js";
export * from "./portal.js";
export * from "./administration.js";
export * from "./security/api.js";
export * from "./security/passkeys.js";
export * from "./shepherding/visits.js";
export * from "./shepherding/contact.js";
export * from "./shepherding/geography.js";
export * from "./shepherding/health.js";
export * from "./mercy/ministry.js";
export * from "./mercy/visits.js";
export * from "./care/dates.js";
export * from "./workflows/api.js";
export * from "./workflows/triggers.js";
export * from "./member/accounts.js";
export * from "./member/profile.js";
export * from "./member/requests.js";
export * from "./member/calendar.js";

export const createHousehold = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(createHouseholdSchema, request.data);
  const household = db.collection("households").doc();
  const batch = db.batch();
  batch.create(household, input.household);
  for (const row of input.people) {
    const person = personInputSchema.parse({
      ...row,
      householdId: household.id,
    });
    const ref = db.collection("people").doc();
    batch.create(ref, {
      ...person,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.create(
      db.collection("attendanceRoster").doc(ref.id),
      toRoster(ref.id, person, input.household.name),
    );
    batch.create(
      ref.collection("membershipEvents").doc(),
      membershipEventSchema.parse({
        date: input.date,
        fromStatus: null,
        toStatus: person.membershipStatus,
        method: "initial",
        reason: "Initial roll entry",
      }),
    );
  }
  await batch.commit();
  return { id: household.id };
});

export const savePerson = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(savePersonSchema, request.data);
  if (
    ["email", "mobilePhone", "emailOptIn", "smsOptIn"].some(
      (field) => field in input.changes,
    )
  )
    throw new HttpsError(
      "invalid-argument",
      "Use the contact and consent form to change delivery details.",
    );
  const ref = db.collection("people").doc(input.id);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists)
      throw new HttpsError("not-found", "That person could not be found.");
    if (
      input.expected &&
      (Object.keys(input.changes).some((key) => !(key in input.expected!)) ||
        Object.entries(input.expected).some(
          ([key, value]) => (before.get(key) ?? "") !== value,
        ))
    )
      throw new HttpsError(
        "aborted",
        "This person changed. Reopen the profile before saving.",
      );
    const previous = Object.fromEntries(
      Object.keys(personInputSchema.shape).map((key) => [key, before.get(key)]),
    );
    const person = personInputSchema.parse({ ...previous, ...input.changes });
    const household = await transaction.get(
      db.collection("households").doc(person.householdId),
    );
    if (!household.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    if (
      person.elderDistrictId &&
      person.elderDistrictId !== before.get("elderDistrictId")
    ) {
      const district = await transaction.get(
        db.doc(`elderDistricts/${person.elderDistrictId}`),
      );
      if (!district.exists || district.get("archived"))
        throw new HttpsError(
          "failed-precondition",
          "Choose an active elder district.",
        );
    }
    const changedStatus =
      before.get("membershipStatus") !== person.membershipStatus;
    const changedDeceased =
      (before.get("isDeceased") ?? false) !== person.isDeceased;
    if (changedStatus || changedDeceased) {
      if (
        !input.membershipEvent ||
        input.membershipEvent.fromStatus !== before.get("membershipStatus") ||
        input.membershipEvent.toStatus !== person.membershipStatus ||
        input.membershipEvent.method === "initial" ||
        (input.membershipEvent.method === "death" && !person.isDeceased) ||
        (person.isDeceased &&
          (person.membershipStatus !== "former" ||
            input.membershipEvent.method !== "death"))
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Record the membership change date and reason.",
        );
      }
      const latest = await transaction.get(
        ref.collection("membershipEvents").orderBy("date", "desc").limit(1),
      );
      if (
        latest.docs[0] &&
        input.membershipEvent.date < latest.docs[0].get("date")
      )
        throw new HttpsError(
          "failed-precondition",
          "The change predates recorded history. Ask the Clerk to review the dates.",
        );
      transaction.create(
        ref.collection("membershipEvents").doc(),
        input.membershipEvent,
      );
    }
    const metadata = {
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.update(ref, { ...input.changes, ...metadata });
    transaction.set(
      db.collection("attendanceRoster").doc(ref.id),
      toRoster(ref.id, person, household.get("name")),
    );
  });
  return { id: ref.id };
});

export const addVisitor = onCall(async (request) => {
  const actor = await requireRoles(request, [
    ...EDITOR_ROLES,
    "deacon",
    "attendanceVolunteer",
  ]);
  const input = parse(visitorInputSchema, request.data);
  const person = db.collection("people").doc();
  const household = db
    .collection("households")
    .doc(input.householdId || db.collection("households").doc().id);
  const service = db.collection("services").doc(input.serviceId);
  await db.runTransaction(async (transaction) => {
    const [meeting, family] = await Promise.all([
      transaction.get(service),
      transaction.get(household),
    ]);
    if (!meeting.exists)
      throw new HttpsError(
        "not-found",
        "Open a service before adding a visitor.",
      );
    if (input.householdId && !family.exists)
      throw new HttpsError("not-found", "That household could not be found.");
    const householdName = family.exists
      ? (family.get("name") as string)
      : input.lastName;
    if (!family.exists)
      transaction.create(household, {
        name: householdName,
        address: "",
        homePhone: "",
      });
    const data = personInputSchema.parse({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      mobilePhone: input.mobilePhone,
      householdId: household.id,
      membershipStatus: "visitor",
    });
    transaction.create(person, {
      ...data,
      firstVisitDate: input.firstTime ? meeting.get("date") : null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });
    transaction.create(
      db.collection("attendanceRoster").doc(person.id),
      toRoster(person.id, data, householdName),
    );
    transaction.create(
      person.collection("membershipEvents").doc(),
      membershipEventSchema.parse({
        date: meeting.get("date"),
        fromStatus: null,
        toStatus: "visitor",
        method: "initial",
        reason: "Visitor added at roll call",
      }),
    );
    transaction.update(
      service,
      new FieldPath("present", person.id),
      { at: FieldValue.serverTimestamp(), method: "roll", byUid: actor.uid },
      "lastAttendancePersonId",
      person.id,
    );
  });
  return { id: person.id };
});

export const setUserRoles = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, ["admin"]);
  requireRecent(request);
  const input = parse(rolesInputSchema, request.data);
  if (input.uid.startsWith("kiosk_"))
    throw new HttpsError(
      "invalid-argument",
      "Kiosk devices cannot receive staff roles.",
    );
  const user = await getAuth().getUser(input.uid);
  const current = z.array(roleSchema).catch([]).parse(user.customClaims?.roles);
  const changedSession = SESSION_ROLES.some(
    (role) => current.includes(role) !== input.roles.includes(role),
  );
  if (changedSession && !hasRole(actor.roles, SESSION_ROLES))
    throw new HttpsError(
      "permission-denied",
      "A Session administrator must approve Session access.",
    );
  if (input.uid === actor.uid)
    throw new HttpsError(
      "failed-precondition",
      "Another administrator must change your roles.",
    );
  await lockStaffAccount(input.uid, current, input.roles);
  await getAuth().revokeRefreshTokens(input.uid);
  await getAuth().setCustomUserClaims(input.uid, {
    ...user.customClaims,
    roles: input.roles,
  });
  await db
    .collection("users")
    .doc(input.uid)
    .set(
      { displayName: user.displayName ?? "", roles: input.roles },
      { merge: true },
    );
  const roleAudit = db.collection("auditLog").doc();
  await roleAudit.set(
    protectRecord("auditLog", roleAudit.path, {
      uid: actor.uid,
      collection: "users",
      docId: input.uid,
      action: "roles",
      before: current,
      after: input.roles,
      at: FieldValue.serverTimestamp(),
    }),
  );
  await securityEvent(
    actor.uid,
    "account.roles",
    "success",
    "security",
    input.uid,
  );
  await finishStaffAccountChange(input.uid);
  return { updated: true };
});

// Event IDs make redelivery idempotent. Sensitive before/after data stays in a Session-only audit collection.
export const auditChanges = onDocumentWrittenWithAuthContext(
  { document: "{collection}/{docId}", secrets: [privateKeys] },
  async (event) => {
    if (
      ![
        "people",
        "households",
        "settings",
        "serviceTypes",
        "elderDistricts",
        "sessionPrivate",
        "careNotes",
        "followUps",
        "diaconalTasks",
        "groups",
        "events",
        "serving",
        "portalAccess",
        "eventPublications",
        "directoryPreferences",
        "onlineSubmissions",
        "pastoralVisits",
        "visitRounds",
        "shepherdingSettings",
        "householdLocations",
        "flockAssessments",
        "mercySettings",
        "mercyAssignments",
        "mercyRequests",
        "mercyNotes",
        "mercyTasks",
        "mercyVisits",
        "memberRequests",
        "importantDates",
        "bereavementDates",
        "workflows",
        "workflowVersions",
        "workflowRuns",
      ].includes(event.params.collection) ||
      !event.data
    )
      return;
    const before = event.data.before.data() ?? null;
    const after = event.data.after.data() ?? null;
    const uid =
      event.authType === "service_account"
        ? (after?.updatedBy ?? event.authId ?? null)
        : (event.authId ?? after?.updatedBy ?? null);
    await db
      .collection("auditLog")
      .doc(event.id)
      .set(
        protectRecord("auditLog", `auditLog/${event.id}`, {
          uid,
          collection: event.params.collection,
          docId: event.params.docId,
          action: !before ? "create" : !after ? "delete" : "update",
          before,
          after,
          at: Timestamp.fromDate(new Date(event.time)),
        }),
      );
    await securityEvent(
      uid || "system",
      "record.change",
      "success",
      [
        "sessionPrivate",
        "careNotes",
        "followUps",
        "diaconalTasks",
        "pastoralVisits",
        "visitRounds",
        "householdLocations",
        "flockAssessments",
        "bereavementDates",
        "memberRequests",
        "workflows",
        "workflowVersions",
        "workflowRuns",
      ].includes(event.params.collection)
        ? "session"
        : event.params.collection.startsWith("mercy")
          ? "mercy"
          : "security",
      `${event.params.collection}/${event.params.docId}`,
    );
  },
);
