import { describe, expect, it } from "vitest";
import {
  addressKey,
  directionsUrl,
  householdLocationSchema,
  locationState,
  plotPoints,
  suggestRouteOrder,
} from "./index";

describe("household locations", () => {
  it("never treats a missing or changed address as a confirmed location", () => {
    expect(locationState("", undefined)).toBe("noAddress");
    expect(locationState("12 Elm St", undefined)).toBe("missing");
    expect(
      locationState("12 Elm St", { verified: false, addressChanged: false }),
    ).toBe("unverified");
    expect(
      locationState("12 Elm St", { verified: true, addressChanged: true }),
    ).toBe("changed");
    expect(
      locationState("12 Elm St", { verified: true, addressChanged: false }),
    ).toBe("verified");
  });
  it("compares addresses without punctuation or spacing differences", () => {
    expect(addressKey(" 12 Elm St.,  Springfield ")).toBe(
      addressKey("12 elm st springfield"),
    );
    expect(addressKey("12 Elm St")).not.toBe(addressKey("14 Elm St"));
  });
  it("accepts only real coordinates", () => {
    const base = { householdId: "willow" };
    expect(
      householdLocationSchema.safeParse({ ...base, lat: 39.77, lng: -86.16 })
        .success,
    ).toBe(true);
    for (const bad of [
      { lat: 91, lng: 0 },
      { lat: 0, lng: -181 },
      { lat: Number.NaN, lng: 0 },
    ])
      expect(
        householdLocationSchema.safeParse({ ...base, ...bad }).success,
      ).toBe(false);
  });
});

describe("routes", () => {
  it("builds a directions link from addresses alone, in order", () => {
    const url = new URL(
      directionsUrl(["1 First St", "2 Second St | Apt 3", "3 Third St"]),
    );
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("origin")).toBe("1 First St");
    expect(url.searchParams.get("waypoints")).toBe("2 Second St   Apt 3");
    expect(url.searchParams.get("destination")).toBe("3 Third St");
    expect([...url.searchParams.keys()].sort()).toEqual([
      "api",
      "destination",
      "origin",
      "travelmode",
      "waypoints",
    ]);
  });
  it("refuses too few, too many, blank or multi-line stops", () => {
    for (const stops of [
      ["1 First St"],
      Array.from({ length: 11 }, (_, index) => `${index} Elm St`),
      ["1 First St", " "],
      ["1 First St", "2 Second St\nNote"],
    ])
      expect(() => directionsUrl(stops)).toThrow();
  });
  it("keeps the first stop and then visits the nearest remaining stop", () => {
    expect(
      suggestRouteOrder([
        { id: "start", lat: 39.7, lng: -86.2 },
        { id: "far", lat: 39.9, lng: -86.2 },
        { id: "near", lat: 39.71, lng: -86.2 },
        { id: "middle", lat: 39.8, lng: -86.2 },
      ]),
    ).toEqual(["start", "near", "middle", "far"]);
  });
  it("keeps every plotted point inside the drawing", () => {
    const points = plotPoints(
      [
        { lat: 39.7, lng: -86.3 },
        { lat: 39.9, lng: -86.0 },
        { lat: 39.8, lng: -86.1 },
      ],
      640,
      360,
      24,
    );
    for (const { x, y } of points) {
      expect(x).toBeGreaterThanOrEqual(24);
      expect(x).toBeLessThanOrEqual(616);
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y).toBeLessThanOrEqual(336);
    }
    // North is up.
    expect(points[1].y).toBeLessThan(points[0].y);
    expect(plotPoints([], 640, 360)).toEqual([]);
  });
});
