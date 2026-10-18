import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import {
  SESSION_ROLES,
  addressKey,
  emptySecuritySchema,
  geographySettingsSchema,
  householdLocationActionSchema,
  householdLocationSchema,
  type HouseholdLocation,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { emulatorMode } from "../communications/environment.js";
import { securityEvent } from "../security/audit.js";

export type GeocodeResult = {
  lat: number;
  lng: number;
  matchedAddress: string;
};
export type Geocoder = (address: string) => Promise<GeocodeResult | null>;
// Only the household address is sent. No names, roles or care details are part of the request.
const census: Geocoder = async (address) => {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error("The address lookup service is unavailable");
  const body = (await response.json()) as {
    result?: {
      addressMatches?: {
        matchedAddress?: string;
        coordinates?: { x?: number; y?: number };
      }[];
    };
  };
  const match = body.result?.addressMatches?.[0];
  if (
    typeof match?.coordinates?.x !== "number" ||
    typeof match.coordinates.y !== "number"
  )
    return null;
  return {
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    matchedAddress: String(match.matchedAddress || ""),
  };
};
// Emulator stand-in: deterministic fictional coordinates and never a network call.
const fake: Geocoder = async (address) => {
  if (/no match/i.test(address)) return null;
  const hash = createHash("sha256").update(addressKey(address)).digest();
  return {
    lat: 39.7 + hash[0] / 2550,
    lng: -86.2 + hash[1] / 2550,
    matchedAddress: address.toUpperCase(),
  };
};
export const geocoder = (): Geocoder => (emulatorMode() ? fake : census);
const addressHash = (address: string) =>
  createHash("sha256").update(addressKey(address)).digest("hex");
async function geographySettings() {
  const row = await db.doc("shepherdingSettings/geography").get();
  return {
    geocoder: (row.get("geocoder") as "none" | "census") || "none",
    revision: Number(row.get("revision") || 0),
  };
}
export const saveGeographySettings = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { expectedRevision, geocoder: choice } = parse(
    geographySettingsSchema,
    request.data,
  );
  const ref = db.doc("shepherdingSettings/geography");
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "These settings changed. Reopen them before saving.",
      );
    transaction.set(ref, {
      geocoder: choice,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});
async function writeLocation(
  householdId: string,
  expectedRevision: number,
  uid: string,
  build: (address: string) => Promise<Record<string, unknown>>,
) {
  const household = await db.doc(`households/${householdId}`).get();
  if (!household.exists)
    throw new HttpsError("not-found", "Choose an existing household.");
  const address = String(household.get("address") || "");
  if (!address.trim())
    throw new HttpsError(
      "failed-precondition",
      "Add an address to this household first.",
    );
  const location = await build(address);
  const ref = db.doc(`householdLocations/${householdId}`);
  await db.runTransaction(async (transaction) => {
    const [before, current] = await Promise.all([
      transaction.get(ref),
      transaction.get(household.ref),
    ]);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This location changed. Reopen it before saving.",
      );
    if (current.get("address") !== address)
      throw new HttpsError(
        "aborted",
        "The household address changed. Try again.",
      );
    transaction.set(ref, {
      ...location,
      addressHash: addressHash(address),
      revision: expectedRevision + 1,
      updatedBy: uid,
      updatedAt: Timestamp.now(),
    });
  });
}
export const lookupHouseholdLocation = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(householdLocationActionSchema, request.data);
  if ((await geographySettings()).geocoder !== "census")
    throw new HttpsError(
      "failed-precondition",
      "Address lookups are turned off. A Session officer can turn them on in Locations.",
    );
  const target = `households/${input.householdId}`;
  try {
    await writeLocation(
      input.householdId,
      input.expectedRevision,
      actor.uid,
      async (address) => {
        const result = await geocoder()(address).catch(() => {
          throw new HttpsError(
            "unavailable",
            "The address lookup service did not respond. Try again later or enter the location by hand.",
          );
        });
        if (!result)
          throw new HttpsError(
            "not-found",
            "No match was found for this address. Check it or enter the location by hand.",
          );
        // A looked-up location waits for a person to confirm it.
        return { ...result, provenance: "census", verified: false };
      },
    );
  } catch (error) {
    await securityEvent(
      actor.uid,
      "location.lookup",
      "failure",
      "session",
      target,
    );
    throw error;
  }
  await securityEvent(
    actor.uid,
    "location.lookup",
    "success",
    "session",
    target,
  );
  return { found: true };
});
export const saveHouseholdLocation = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(householdLocationSchema, request.data);
  await writeLocation(
    input.householdId,
    input.expectedRevision,
    actor.uid,
    async () => ({
      lat: input.lat,
      lng: input.lng,
      matchedAddress: "",
      provenance: "manual",
      verified: true,
      verifiedBy: actor.uid,
      verifiedAt: Timestamp.now(),
    }),
  );
  return { saved: true };
});
export const confirmHouseholdLocation = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(householdLocationActionSchema, request.data);
  const ref = db.doc(`householdLocations/${input.householdId}`);
  await db.runTransaction(async (transaction) => {
    const [before, household] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`households/${input.householdId}`)),
    ]);
    if (
      !before.exists ||
      Number(before.get("revision") || 0) !== input.expectedRevision
    )
      throw new HttpsError(
        "aborted",
        "This location changed. Reopen it before confirming.",
      );
    if (
      before.get("addressHash") !==
      addressHash(String(household.get("address") || ""))
    )
      throw new HttpsError(
        "failed-precondition",
        "The address changed after this lookup. Look it up again.",
      );
    transaction.update(ref, {
      verified: true,
      verifiedBy: actor.uid,
      verifiedAt: Timestamp.now(),
      revision: input.expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { confirmed: true };
});
export const getHouseholdLocations = onCall(async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  const actor = await requireRoles(request, SESSION_ROLES);
  const [rows, households, settings] = await Promise.all([
    db.collection("householdLocations").get(),
    db.collection("households").get(),
    geographySettings(),
  ]);
  const addresses = new Map(
    households.docs.map((row) => [row.id, String(row.get("address") || "")]),
  );
  await securityEvent(actor.uid, "location.read", "success", "session");
  return {
    settings,
    locations: rows.docs
      .filter((row) => addresses.has(row.id))
      .map((row): HouseholdLocation => ({
        householdId: row.id,
        lat: row.get("lat"),
        lng: row.get("lng"),
        provenance: row.get("provenance"),
        matchedAddress: row.get("matchedAddress") || "",
        verified: row.get("verified") === true,
        addressChanged:
          row.get("addressHash") !== addressHash(addresses.get(row.id)!),
        revision: Number(row.get("revision") || 0),
        updatedAt: (row.get("updatedAt") as Timestamp).toDate().toISOString(),
      })),
  };
});
