import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { Timestamp, FieldPath, FieldValue } from "firebase-admin/firestore";
import {
  kioskSetupSchema,
  kioskStartSchema,
  kioskSearchSchema,
  kioskCheckSchema,
  kioskExitSchema,
  normalizePhone,
} from "@sycamore/shared";
import { db } from "./admin.js";
import { parse, requireRoles } from "./access.js";
export const configureKiosk = onCall(async (request) => {
  await requireRoles(request, ["admin", "pastor"]);
  const input = parse(kioskSetupSchema, request.data);
  const salt = randomBytes(16).toString("hex");
  await db.doc("kioskConfiguration/church").set({
    enabled: input.enabled,
    salt,
    hash: scryptSync(input.pin, salt, 32).toString("hex"),
  });
  return { saved: true };
});
export const startKiosk = onCall(async (request) => {
  const actor = await requireRoles(request, ["admin", "pastor"]);
  const input = parse(kioskStartSchema, request.data);
  const [settings, service] = await Promise.all([
    db.doc("kioskConfiguration/church").get(),
    db.doc(`services/${input.serviceId}`).get(),
  ]);
  if (!settings.get("enabled") || !service.exists)
    throw new HttpsError(
      "failed-precondition",
      "Enable the kiosk and open a service first.",
    );
  const uid = `kiosk_${randomBytes(16).toString("hex")}`;
  await db.doc(`kioskDevices/${uid}`).set({
    serviceId: input.serviceId,
    createdBy: actor.uid,
    expiresAt: Timestamp.fromMillis(Date.now() + 4 * 3600000),
    requests: 0,
    minute: "",
    exitFailures: 0,
  });
  return {
    token: await getAuth().createCustomToken(uid, { kiosk: true }),
    serviceDate: service.get("date"),
  };
});
async function device(request: CallableRequest, count = true) {
  if (!request.auth?.token.kiosk)
    throw new HttpsError(
      "permission-denied",
      "This screen needs a kiosk login.",
    );
  const ref = db.doc(`kioskDevices/${request.auth.uid}`);
  let result: Record<string, unknown> = {};
  await db.runTransaction(async (transaction) => {
    const [row, settings] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc("kioskConfiguration/church")),
    ]);
    if (
      !row.exists ||
      !settings.get("enabled") ||
      row.get("ended") ||
      row.get("expiresAt").toMillis() < Date.now()
    )
      throw new HttpsError(
        "permission-denied",
        "The kiosk has ended. Ask a church volunteer to open it again.",
      );
    const minute = new Date().toISOString().slice(0, 16);
    const requests =
      row.get("minute") === minute ? Number(row.get("requests") || 0) : 0;
    if (count && requests >= 15)
      throw new HttpsError(
        "resource-exhausted",
        "Please wait a moment before searching again.",
      );
    if (count) transaction.update(ref, { minute, requests: requests + 1 });
    result = { ...row.data(), uid: ref.id };
  });
  return result as { uid: string; serviceId: string };
}
export const kioskInfo = onCall(async (request) => {
  const active = await device(request, false);
  const service = await db.doc(`services/${active.serviceId}`).get();
  return { date: service.get("date") };
});
export const searchKioskHouseholds = onCall(async (request) => {
  const active = await device(request);
  const input = parse(kioskSearchSchema, request.data);
  const term = input.search.toLocaleLowerCase();
  const [people, service] = await Promise.all([
    db.collection("people").get(),
    db.doc(`services/${active.serviceId}`).get(),
  ]);
  const rows = people.docs.filter(
    (row) => !row.get("isDeceased") && row.get("membershipStatus") !== "former",
  );
  const byPhone = /^[+\d().\s-]+$/.test(term);
  if (byPhone && term.replace(/\D/g, "").length < 10)
    throw new HttpsError("invalid-argument", "Enter the full phone number.");
  let phone = "";
  if (byPhone) {
    try {
      phone = normalizePhone(term);
    } catch {
      throw new HttpsError("invalid-argument", "Enter the full phone number.");
    }
  }
  const matches = rows.filter((row) => {
    if (!byPhone)
      return String(row.get("lastName")).toLocaleLowerCase() === term;
    try {
      return normalizePhone(row.get("mobilePhone") || "") === phone;
    } catch {
      return false;
    }
  });
  const householdIds = [
    ...new Set(matches.map((row) => String(row.get("householdId")))),
  ].slice(0, 5);
  const allowed = rows
    .filter((row) => householdIds.includes(row.get("householdId")))
    .slice(0, 60);
  const token = randomBytes(24).toString("hex");
  await db.doc(`kioskSearches/${token}`).set({
    uid: active.uid,
    serviceId: active.serviceId,
    personIds: allowed.map((row) => row.id),
    expiresAt: Timestamp.fromMillis(Date.now() + 120000),
  });
  return {
    searchToken: token,
    households: householdIds.map((id) => ({
      id,
      name: String(
        allowed.find((row) => row.get("householdId") === id)?.get("lastName") ||
          "Household",
      ),
      people: allowed
        .filter((row) => row.get("householdId") === id)
        .map((row) => ({
          id: row.id,
          name: `${row.get("preferredName") || row.get("firstName")} ${row.get("lastName")}`,
          present: !!service.get("present")?.[row.id],
        })),
    })),
  };
});
export const checkInKiosk = onCall(async (request) => {
  const active = await device(request);
  const input = parse(kioskCheckSchema, request.data);
  await db.runTransaction(async (transaction) => {
    const search = await transaction.get(
      db.doc(`kioskSearches/${input.searchToken}`),
    );
    const ref = db.doc(`services/${active.serviceId}`);
    const [service, ...people] = await Promise.all([
      transaction.get(ref),
      ...input.personIds.map((id) => transaction.get(db.doc(`people/${id}`))),
    ]);
    if (
      !search.exists ||
      search.get("uid") !== active.uid ||
      search.get("expiresAt").toMillis() < Date.now() ||
      !input.personIds.every((id) => search.get("personIds").includes(id)) ||
      !service.exists ||
      people.some(
        (row) =>
          !row.exists ||
          row.get("isDeceased") ||
          row.get("membershipStatus") === "former",
      )
    )
      throw new HttpsError(
        "permission-denied",
        "Search for this household again before checking in.",
      );
    for (const id of new Set(input.personIds))
      if (!service.get("present")?.[id])
        transaction.update(
          ref,
          new FieldPath("present", id),
          {
            at: Timestamp.now(),
            method: "kiosk",
            byUid: active.uid,
            mode: "inPerson",
          },
          "lastAttendancePersonId",
          id,
        );
    transaction.update(search.ref, { expiresAt: Timestamp.now() });
  });
  return { checkedIn: true };
});
export const exitKiosk = onCall(async (request) => {
  const active = await device(request, false);
  const input = parse(kioskExitSchema, request.data);
  let accepted = false;
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`kioskDevices/${active.uid}`);
    const [row, settings] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc("kioskConfiguration/church")),
    ]);
    if (Number(row.get("exitFailures") || 0) >= 5)
      throw new HttpsError(
        "resource-exhausted",
        "Ask an administrator to close this kiosk from another signed-in PC.",
      );
    accepted = timingSafeEqual(
      scryptSync(input.pin, settings.get("salt"), 32),
      Buffer.from(settings.get("hash"), "hex"),
    );
    transaction.update(
      ref,
      accepted ? { ended: true } : { exitFailures: FieldValue.increment(1) },
    );
  });
  if (!accepted)
    throw new HttpsError("permission-denied", "The exit PIN does not match.");
  return { ended: true };
});
