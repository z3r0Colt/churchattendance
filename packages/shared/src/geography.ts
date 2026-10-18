import { z } from "zod";
import { idSchema } from "./domain.js";

export const geographySettingsSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().default(0),
    geocoder: z.enum(["none", "census"]).default("none"),
  })
  .strict();
export const householdLocationSchema = z
  .object({
    householdId: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export const householdLocationActionSchema = z
  .object({
    householdId: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
  })
  .strict();
export type HouseholdLocation = {
  householdId: string;
  lat: number;
  lng: number;
  provenance: "census" | "manual";
  matchedAddress: string;
  verified: boolean;
  addressChanged: boolean;
  revision: number;
  updatedAt: string;
};
// Coordinates are compared with the address they were found or confirmed for.
export function addressKey(address: string) {
  return address
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s,.]+/g, " ");
}
export type LocationState =
  "noAddress" | "missing" | "unverified" | "changed" | "verified";
export const locationStateLabels: Record<LocationState, string> = {
  noAddress: "No address on file",
  missing: "No coordinates",
  unverified: "Found, not yet confirmed",
  changed: "Address changed since confirmed",
  verified: "Confirmed",
};
export function locationState(
  address: string,
  location: Pick<HouseholdLocation, "verified" | "addressChanged"> | undefined,
): LocationState {
  if (!address.trim()) return "noAddress";
  if (!location) return "missing";
  if (location.addressChanged) return "changed";
  return location.verified ? "verified" : "unverified";
}
type Point = { lat: number; lng: number };
export function distanceKm(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// A simple suggested order: keep the first stop, then always go to the nearest remaining one.
export function suggestRouteOrder<T extends Point & { id: string }>(
  stops: T[],
): string[] {
  if (stops.length < 3) return stops.map((stop) => stop.id);
  const remaining = stops.slice(1);
  const order = [stops[0]];
  while (remaining.length) {
    const last = order.at(-1)!;
    let best = 0;
    for (let index = 1; index < remaining.length; index++)
      if (
        distanceKm(last, remaining[index]) < distanceKm(last, remaining[best])
      )
        best = index;
    order.push(remaining.splice(best, 1)[0]);
  }
  return order.map((stop) => stop.id);
}
export const MAX_ROUTE_STOPS = 10;
// Directions carry addresses only. No names, notes or purposes are ever part of the link.
export function directionsUrl(addresses: string[]) {
  if (
    addresses.length < 2 ||
    addresses.length > MAX_ROUTE_STOPS ||
    addresses.some(
      (address) =>
        !address.trim() || address.length > 300 || /[\r\n]/.test(address),
    )
  )
    throw new Error("Choose between two and ten stops with addresses");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", addresses[0].trim());
  url.searchParams.set("destination", addresses.at(-1)!.trim());
  if (addresses.length > 2)
    url.searchParams.set(
      "waypoints",
      addresses
        .slice(1, -1)
        .map((address) => address.trim().replace(/\|/g, " "))
        .join("|"),
    );
  url.searchParams.set("travelmode", "driving");
  return url.href;
}
// Projects coordinates onto a plain plot. It is a sketch for orientation, not a street map.
export function plotPoints<T extends Point>(
  points: T[],
  width: number,
  height: number,
  padding = 24,
) {
  if (!points.length) return [];
  const middle =
    (points.reduce((sum, point) => sum + point.lat, 0) / points.length) *
    (Math.PI / 180);
  const xs = points.map((point) => point.lng * Math.cos(middle));
  const ys = points.map((point) => point.lat);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX || 1),
    (height - padding * 2) / (maxY - minY || 1),
  );
  return points.map((point, index) => ({
    point,
    x: padding + (xs[index] - minX) * scale,
    y: height - padding - (ys[index] - minY) * scale,
  }));
}
