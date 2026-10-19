import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  MEMBER_PHOTO_BYTES,
  isAdultOn,
  memberContactSchema,
  memberHouseholdSchema,
  memberPhotoRemovalSchema,
  memberPhotoSchema,
  memberPhotoTypes,
  normalizeEmail,
  normalizePhone,
  photoMatchesType,
  portalPhotoSchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse } from "../access.js";
import { getChurchZone } from "../communications/queue.js";
import { member, portalOptions } from "../portal.js";

type Transaction = FirebaseFirestore.Transaction;
const eligible = ["communicant", "baptized", "nonResident", "adherent"];

// Recheck the mapping and person inside the transaction, so a revoked
// account or a status change between the first check and the write is honored.
async function linkedPerson(
  transaction: Transaction,
  uid: string,
  personId: string,
) {
  const [access, person] = await Promise.all([
    transaction.get(db.doc(`portalAccess/${uid}`)),
    transaction.get(db.doc(`people/${personId}`)),
  ]);
  if (
    !access.get("enabled") ||
    access.get("personId") !== personId ||
    !person.exists ||
    person.get("isDeceased") ||
    !eligible.includes(person.get("membershipStatus"))
  )
    throw new HttpsError(
      "permission-denied",
      "Portal access changed. Sign in again.",
    );
  return person;
}
function rejectStale(
  current: FirebaseFirestore.DocumentSnapshot,
  expected: Record<string, unknown>,
) {
  if (
    Object.entries(expected).some(
      ([field, value]) => (current.get(field) ?? "") !== value,
    )
  )
    throw new HttpsError(
      "aborted",
      "These details changed since you opened them. Refresh before saving.",
    );
}

export const saveMyContact = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const input = parse(memberContactSchema, request.data);
  const changes: Record<string, string> = {};
  if (input.changes.preferredName !== undefined)
    changes.preferredName = input.changes.preferredName.trim();
  if (input.changes.email !== undefined)
    changes.email = normalizeEmail(input.changes.email);
  if (input.changes.mobilePhone !== undefined)
    try {
      changes.mobilePhone = normalizePhone(input.changes.mobilePhone);
    } catch {
      throw new HttpsError(
        "invalid-argument",
        "Enter a US mobile number or one beginning with its country code.",
      );
    }
  const ref = db.doc(`people/${current.person.id}`);
  let textsStopped = false;
  await db.runTransaction(async (transaction) => {
    const person = await linkedPerson(
      transaction,
      current.uid,
      current.person.id,
    );
    rejectStale(person, input.expected);
    const update: Record<string, unknown> = Object.fromEntries(
      Object.entries(changes).filter(
        ([field, value]) => (person.get(field) ?? "") !== value,
      ),
    );
    if (!Object.keys(update).length) return;
    // Text consent belongs to a number. A new number starts with texts off,
    // and editing a number never turns them on.
    if ("mobilePhone" in update && person.get("smsOptIn") === true) {
      update.smsOptIn = false;
      textsStopped = true;
      transaction.create(db.collection("consentEvents").doc(), {
        personId: current.person.id,
        channel: "sms",
        optedIn: false,
        source: "Mobile number changed in the member portal",
        actor: current.uid,
        at: Timestamp.now(),
      });
    }
    transaction.update(ref, {
      ...update,
      updatedBy: current.uid,
      updatedAt: Timestamp.now(),
    });
    if ("preferredName" in update)
      transaction.update(db.doc(`attendanceRoster/${current.person.id}`), {
        preferredName: update.preferredName,
      });
  });
  return { saved: true, textsStopped };
});

export const saveMyHousehold = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const input = parse(memberHouseholdSchema, request.data);
  const zone = await getChurchZone();
  const today = DateTime.now().setZone(zone).toISODate()!;
  const changes: Record<string, string> = {};
  if (input.changes.address !== undefined)
    changes.address = input.changes.address.trim();
  if (input.changes.homePhone !== undefined)
    try {
      changes.homePhone = normalizePhone(input.changes.homePhone);
    } catch {
      throw new HttpsError(
        "invalid-argument",
        "Enter a US phone number or one beginning with its country code.",
      );
    }
  await db.runTransaction(async (transaction) => {
    const person = await linkedPerson(
      transaction,
      current.uid,
      current.person.id,
    );
    if (!isAdultOn(person.get("birthDate") || "", today))
      throw new HttpsError(
        "permission-denied",
        "Household details are changed by an adult in the household whose birth date is on record. Contact the church office.",
      );
    const ref = db.doc(`households/${person.get("householdId")}`);
    const household = await transaction.get(ref);
    if (!household.exists)
      throw new HttpsError(
        "not-found",
        "Your household record is unavailable. Contact the church office.",
      );
    rejectStale(household, input.expected);
    const update = Object.fromEntries(
      Object.entries(changes).filter(
        ([field, value]) => (household.get(field) ?? "") !== value,
      ),
    );
    if (!Object.keys(update).length) return;
    // A changed address marks any confirmed map location for Session review.
    transaction.update(ref, {
      ...update,
      updatedBy: current.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

const extension = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ownPhoto = (personId: string, path: unknown) =>
  typeof path === "string" && path.startsWith(`photos/${personId}/`);

async function replacePhoto(
  uid: string,
  personId: string,
  expectedPhoto: boolean,
  next: string | null,
) {
  let previous: unknown = null;
  await db.runTransaction(async (transaction) => {
    const person = await linkedPerson(transaction, uid, personId);
    if (!!person.get("photoPath") !== expectedPhoto)
      throw new HttpsError(
        "aborted",
        "Your photo changed since you opened this page. Refresh before saving.",
      );
    previous = person.get("photoPath");
    transaction.update(db.doc(`people/${personId}`), {
      photoPath: next ?? FieldValue.delete(),
      updatedBy: uid,
      updatedAt: Timestamp.now(),
    });
  });
  if (ownPhoto(personId, previous))
    await getStorage()
      .bucket()
      .file(previous as string)
      .delete({ ignoreNotFound: true });
}

export const saveMyPhoto = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const input = parse(memberPhotoSchema, request.data);
  const bytes = Buffer.from(input.data, "base64");
  if (
    bytes.length > MEMBER_PHOTO_BYTES ||
    !photoMatchesType(bytes, input.contentType)
  )
    throw new HttpsError(
      "invalid-argument",
      "Choose a JPEG, PNG or WebP photo under 1 MB.",
    );
  const path = `photos/${current.person.id}/${randomUUID()}.${extension[input.contentType]}`;
  const file = getStorage().bucket().file(path);
  await file.save(bytes, {
    contentType: input.contentType,
    resumable: false,
  });
  try {
    await replacePhoto(
      current.uid,
      current.person.id,
      input.expectedPhoto,
      path,
    );
  } catch (error) {
    await file.delete({ ignoreNotFound: true });
    throw error;
  }
  return { saved: true };
});

export const removeMyPhoto = onCall(portalOptions, async (request) => {
  const current = await member(request);
  parse(memberPhotoRemovalSchema, request.data);
  await replacePhoto(current.uid, current.person.id, true, null);
  return { removed: true };
});

// Photos are read through this call, never from Storage directly, so a
// member sees another person's photo only while that person shares it.
export const portalPhoto = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const { personId } = parse(portalPhotoSchema, request.data);
  const [person, preferences] = await Promise.all([
    db.doc(`people/${personId}`).get(),
    db.doc(`directoryPreferences/${personId}`).get(),
  ]);
  const shared =
    personId === current.person.id ||
    (preferences.get("listed") === true &&
      preferences.get("sharePhoto") === true &&
      person.exists &&
      !person.get("isDeceased") &&
      eligible.includes(person.get("membershipStatus")));
  const path = person.get("photoPath");
  if (!shared || !ownPhoto(personId, path)) return { photo: null };
  const file = getStorage().bucket().file(path);
  const [[metadata], [bytes]] = await Promise.all([
    file.getMetadata(),
    file.download(),
  ]).catch(() => [[null], [null]] as const);
  const type = metadata?.contentType;
  if (
    !bytes ||
    !(memberPhotoTypes as readonly unknown[]).includes(type) ||
    !photoMatchesType(bytes, type as (typeof memberPhotoTypes)[number])
  )
    return { photo: null };
  return {
    photo: `data:${type};base64,${bytes.toString("base64")}`,
  };
});
