import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Query,
} from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  EDITOR_ROLES,
  roleSchema,
  SESSION_ROLES,
  addPersonSchema,
  churchSettingsSchema,
  exportPageSchema,
  exportPathAllowed,
  hasRole,
  membershipEventSchema,
  privateExportCollections,
  saveChurchSettingsSchema,
  saveDistrictSchema,
  saveHouseholdSchema,
  saveServiceTypeSchema,
  toRoster,
} from "@sycamore/shared";
import { db } from "./admin.js";
import { parse, requireRoles } from "./access.js";
import { privateOptions, openRecord } from "./security/encryption.js";
import { securityEvent } from "./security/audit.js";
import { getAuth } from "firebase-admin/auth";

const SETUP_ROLES = ["admin", "pastor"] as const;
function checkRevision(actual: unknown, expected: number) {
  if ((actual ?? 0) !== expected)
    throw new HttpsError(
      "aborted",
      "This record changed. Reopen it before saving.",
    );
}
const metadata = (uid: string, revision: number) => ({
  revision: revision + 1,
  updatedBy: uid,
  updatedAt: FieldValue.serverTimestamp(),
});

export const saveChurchSettings = onCall(async (request) => {
  const actor = await requireRoles(request, SETUP_ROLES);
  const input = parse(saveChurchSettingsSchema, request.data);
  await db.runTransaction(async (tx) => {
    const ref = db.doc("settings/church"),
      before = await tx.get(ref);
    checkRevision(before.get("revision"), input.expectedRevision);
    tx.set(
      ref,
      {
        ...parse(churchSettingsSchema, {
          name: input.name,
          address: input.address,
          timeZone: input.timeZone,
        }),
        ...metadata(actor.uid, input.expectedRevision),
      },
      { merge: true },
    );
  });
  return { saved: true };
});
export const saveServiceType = onCall(async (request) => {
  const actor = await requireRoles(request, SETUP_ROLES);
  const { id, expectedRevision, ...data } = parse(
    saveServiceTypeSchema,
    request.data,
  );
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`serviceTypes/${id}`),
      before = await tx.get(ref);
    checkRevision(before.get("revision"), expectedRevision);
    tx.set(
      ref,
      { ...data, ...metadata(actor.uid, expectedRevision) },
      { merge: true },
    );
  });
  return { id };
});
export const saveElderDistrict = onCall(async (request) => {
  const actor = await requireRoles(request, SETUP_ROLES);
  const { id, expectedRevision, ...data } = parse(
    saveDistrictSchema,
    request.data,
  );
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`elderDistricts/${id}`);
    const [before, elder] = await Promise.all([
      tx.get(ref),
      tx.get(db.doc(`people/${data.elderPersonId}`)),
    ]);
    checkRevision(before.get("revision"), expectedRevision);
    if (
      !elder.exists ||
      elder.get("isDeceased") ||
      !["communicant", "nonResident"].includes(elder.get("membershipStatus"))
    )
      throw new HttpsError(
        "failed-precondition",
        "Choose a living member as the shepherding elder.",
      );
    // The person is a directory identity. Care delivery separately checks the linked account's Session role.
    tx.set(
      ref,
      { ...data, ...metadata(actor.uid, expectedRevision) },
      { merge: true },
    );
  });
  return { id };
});
export const saveHousehold = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const { id, expectedRevision, ...data } = parse(
    saveHouseholdSchema,
    request.data,
  );
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`households/${id}`);
    const [before, people] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection("people").where("householdId", "==", id).limit(101)),
    ]);
    if (!before.exists)
      throw new HttpsError("not-found", "That household could not be found.");
    checkRevision(before.get("revision"), expectedRevision);
    if (people.size > 100)
      throw new HttpsError(
        "resource-exhausted",
        "This household needs administrator review before renaming.",
      );
    tx.update(ref, { ...data, ...metadata(actor.uid, expectedRevision) });
    if (before.get("name") !== data.name)
      for (const person of people.docs)
        tx.update(db.doc(`attendanceRoster/${person.id}`), {
          householdName: data.name,
        });
  });
  return { id };
});
export const addPerson = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(addPersonSchema, request.data),
    person = db.collection("people").doc();
  if (input.person.emailOptIn || input.person.smsOptIn)
    throw new HttpsError(
      "invalid-argument",
      "Record communication consent after adding the person.",
    );
  await db.runTransaction(async (tx) => {
    const family = await tx.get(
      db.doc(`households/${input.person.householdId}`),
    );
    if (!family.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    if (input.person.elderDistrictId) {
      const district = await tx.get(
        db.doc(`elderDistricts/${input.person.elderDistrictId}`),
      );
      if (!district.exists || district.get("archived"))
        throw new HttpsError(
          "failed-precondition",
          "Choose an active elder district.",
        );
    }
    tx.create(person, {
      ...input.person,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(
      db.doc(`attendanceRoster/${person.id}`),
      toRoster(person.id, input.person, family.get("name")),
    );
    tx.create(
      person.collection("membershipEvents").doc(),
      membershipEventSchema.parse({
        date: input.date,
        fromStatus: null,
        toStatus: input.person.membershipStatus,
        method: "initial",
        reason: "Initial roll entry",
      }),
    );
  });
  return { id: person.id };
});

// Timestamps retain nanoseconds in an inspectable, versioned archive; this is not a restore protocol.
function serializable(value: unknown): unknown {
  if (value instanceof Timestamp)
    return {
      _type: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  if (Buffer.isBuffer(value))
    return { _type: "bytes", base64: value.toString("base64") };
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializable(entry)]),
    );
  return value;
}
export const exportDataPage = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, ["admin"]);
  const user = await getAuth().getUser(actor.uid);
  const liveRoles = roleSchema
    .array()
    .catch([])
    .parse(user.customClaims?.roles);
  if (user.disabled || !liveRoles.includes("admin"))
    throw new HttpsError(
      "permission-denied",
      "Your administrator access changed. Sign in again.",
    );
  const input = parse(exportPageSchema, request.data);
  if (
    (privateExportCollections as readonly string[]).includes(
      input.collection,
    ) &&
    (!hasRole(actor.roles, SESSION_ROLES) || !hasRole(liveRoles, SESSION_ROLES))
  )
    throw new HttpsError(
      "permission-denied",
      "Session records require a Session administrator.",
    );
  const cursorParts = input.after.split("/");
  if (
    input.after &&
    (cursorParts.length % 2 !== 0 ||
      cursorParts.at(-2) !== input.collection ||
      cursorParts.some((part) => !part || part === "." || part === ".."))
  )
    throw new HttpsError(
      "invalid-argument",
      "The export cursor does not match this collection.",
    );
  const nested = [
    "membershipEvents",
    "sacraments",
    "offices",
    "meetings",
    "rsvps",
  ].includes(input.collection);
  if (input.after && !nested && cursorParts.length !== 2)
    throw new HttpsError(
      "invalid-argument",
      "Choose a cursor from this collection.",
    );
  let query: Query = (
    nested
      ? db.collectionGroup(input.collection)
      : db.collection(input.collection)
  )
    .orderBy(FieldPath.documentId())
    .limit(25);
  if (input.after) query = query.startAfter(db.doc(input.after));
  const page = await query.get();
  const rows: { path: string; data: unknown }[] = [];
  let bytes = 0,
    consumed = 0,
    lastPath = "";
  for (const row of page.docs) {
    if (exportPathAllowed(input.collection, row.ref.path)) {
      const isPrivate = (
        privateExportCollections as readonly string[]
      ).includes(input.collection);
      if (isPrivate)
        await securityEvent(
          actor.uid,
          "private.export",
          "success",
          "session",
          row.ref.path,
        );
      const data = serializable(
        isPrivate ? openRecord(row.ref.path, row.data()) : row.data(),
      );
      const size = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (size > 4_000_000)
        throw new HttpsError(
          "resource-exhausted",
          "A document is too large for a workbook archive. Use a managed export.",
        );
      if (rows.length && bytes + size > 4_000_000) break;
      rows.push({ path: row.ref.path, data });
      bytes += size;
    }
    consumed++;
    lastPath = row.ref.path;
  }
  return {
    rows,
    next: consumed < page.size || page.size === 25 ? lastPath : "",
    readAt: page.readTime.toDate().toISOString(),
  };
});
