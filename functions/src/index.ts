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
import { parse, requireRoles } from "./access.js";
export * from "./communications/api.js";

export const createHousehold = onCall(async (request) => {
  const actor = requireRoles(request, EDITOR_ROLES);
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
  const actor = requireRoles(request, EDITOR_ROLES);
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
    const previous = Object.fromEntries(
      Object.keys(personInputSchema.shape).map((key) => [key, before.get(key)]),
    );
    const person = personInputSchema.parse({ ...previous, ...input.changes });
    const household = await transaction.get(
      db.collection("households").doc(person.householdId),
    );
    if (!household.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    const changedStatus =
      before.get("membershipStatus") !== person.membershipStatus;
    if (changedStatus) {
      if (
        !input.membershipEvent ||
        input.membershipEvent.fromStatus !== before.get("membershipStatus") ||
        input.membershipEvent.toStatus !== person.membershipStatus
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Record the membership change date and reason.",
        );
      }
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
  const actor = requireRoles(request, [
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

export const setUserRoles = onCall(async (request) => {
  const actor = requireRoles(request, ["admin"]);
  const input = parse(rolesInputSchema, request.data);
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
  await db.collection("auditLog").add({
    uid: actor.uid,
    collection: "users",
    docId: input.uid,
    action: "roles",
    before: current,
    after: input.roles,
    at: FieldValue.serverTimestamp(),
  });
  return { updated: true };
});

// Event IDs make redelivery idempotent. Sensitive before/after data stays in a Session-only audit collection.
export const auditChanges = onDocumentWrittenWithAuthContext(
  "{collection}/{docId}",
  async (event) => {
    if (
      ![
        "people",
        "sessionPrivate",
        "careNotes",
        "followUps",
        "diaconalTasks",
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
      .set({
        uid,
        collection: event.params.collection,
        docId: event.params.docId,
        action: !before ? "create" : !after ? "delete" : "update",
        before,
        after,
        at: Timestamp.fromDate(new Date(event.time)),
      });
  },
);
