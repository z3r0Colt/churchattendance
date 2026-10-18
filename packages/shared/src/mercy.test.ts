import { describe, expect, it } from "vitest";
import {
  canReadMercy,
  canReadMercyNote,
  canTriageMercy,
  mercyOpen,
  mercyProgressSchema,
  mercyRequestSchema,
  mercyTransition,
  mercyTriageSchema,
  mercyVisitSchema,
  type MercyViewer,
} from "./index";

const viewer = (patch: Partial<MercyViewer>): MercyViewer => ({
  uid: "fenn",
  pastor: false,
  session: false,
  deacon: false,
  chair: false,
  ...patch,
});
const deacon = viewer({ deacon: true });
const elder = viewer({ uid: "hollis", session: true });
const pastor = viewer({ uid: "calder", session: true, pastor: true });

describe("mercy access", () => {
  it("lets only currently assigned deacons and the Pastor read private content", () => {
    expect(canReadMercy(deacon, ["fenn"])).toBe(true);
    expect(canReadMercy(deacon, [], ["fenn"])).toBe(true);
    expect(canReadMercy(deacon, ["marsh"], ["marsh"])).toBe(false);
    expect(canReadMercy(pastor, [])).toBe(true);
    expect(canReadMercy(elder, ["hollis"])).toBe(false);
    // A removed deacon role ends access even when the assignment remains.
    expect(canReadMercy(viewer({ deacon: false }), ["fenn"])).toBe(false);
  });
  it("shows the Session a note only after it was deliberately shared", () => {
    expect(canReadMercyNote(elder, { sharedWithSession: false }, [])).toBe(
      false,
    );
    expect(canReadMercyNote(elder, { sharedWithSession: true }, [])).toBe(true);
    expect(canReadMercyNote(deacon, { sharedWithSession: true }, [])).toBe(
      false,
    );
  });
  it("lets the Session and live deacon chairs triage", () => {
    expect(canTriageMercy(elder)).toBe(true);
    expect(canTriageMercy(viewer({ deacon: true, chair: true }))).toBe(true);
    expect(canTriageMercy(deacon)).toBe(false);
    expect(canTriageMercy(viewer({ chair: true }))).toBe(false);
  });
});

describe("mercy requests", () => {
  it("moves status forward only and closes resolved and declined requests", () => {
    expect(mercyTransition("new", "approved")).toBe(true);
    expect(mercyTransition("new", "declined")).toBe(true);
    expect(mercyTransition("new", "resolved")).toBe(false);
    expect(mercyTransition("approved", "inProgress")).toBe(true);
    expect(mercyTransition("inProgress", "approved")).toBe(false);
    expect(mercyTransition("resolved", "inProgress")).toBe(false);
    expect(mercyTransition("declined", "approved")).toBe(false);
    expect(mercyOpen("inProgress")).toBe(true);
    expect(mercyOpen("new")).toBe(false);
  });
  it("validates practical requests, triage decisions and resolutions", () => {
    expect(
      mercyRequestSchema.safeParse({
        id: "r1",
        householdId: "calder",
        category: "meals",
        details: "Meals for a week",
      }).success,
    ).toBe(true);
    expect(
      mercyRequestSchema.safeParse({
        id: "r1",
        householdId: "calder",
        category: "money",
        details: "x",
      }).success,
    ).toBe(false);
    expect(
      mercyTriageSchema.safeParse({
        id: "r1",
        expectedRevision: 1,
        action: "approve",
        deaconUids: [],
      }).success,
    ).toBe(false);
    expect(
      mercyTriageSchema.safeParse({
        id: "r1",
        expectedRevision: 1,
        action: "approve",
        deaconUids: ["fenn", "fenn"],
      }).success,
    ).toBe(false);
    expect(
      mercyTriageSchema.safeParse({
        id: "r1",
        expectedRevision: 1,
        action: "decline",
        reason: "Handled by family",
      }).success,
    ).toBe(true);
    expect(
      mercyProgressSchema.safeParse({
        id: "r1",
        expectedRevision: 2,
        status: "resolved",
      }).success,
    ).toBe(false);
  });
});

describe("mercy visits", () => {
  const visit = {
    id: "v1",
    householdId: "calder",
    start: "2026-11-02T15:00:00-05:00",
    deaconUids: ["fenn"],
  };
  it("needs a deacon, keeps officers and deacons distinct and requires a cancel reason", () => {
    expect(mercyVisitSchema.safeParse(visit).success).toBe(true);
    expect(
      mercyVisitSchema.safeParse({ ...visit, deaconUids: [] }).success,
    ).toBe(false);
    expect(
      mercyVisitSchema.safeParse({ ...visit, officerUids: ["fenn"] }).success,
    ).toBe(false);
    expect(
      mercyVisitSchema.safeParse({ ...visit, status: "cancelled" }).success,
    ).toBe(false);
    expect(
      mercyVisitSchema.safeParse({ ...visit, status: "completed" }).success,
    ).toBe(false);
  });
});
