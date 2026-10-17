import { describe, expect, it } from "vitest";
import {
  attendanceCounts,
  churchDate,
  filterRoster,
  hasRole,
  isOnRoll,
  nextService,
  personInputSchema,
  personPatchSchema,
  SESSION_ROLES,
  toRoster,
  type RosterPerson,
  type ServiceType,
} from "./index";
const person = personInputSchema.parse({
  firstName: "James",
  lastName: "Calder",
  householdId: "calder",
  membershipStatus: "communicant",
  email: "james@example.test",
});
const james = toRoster("james", person, "Calder");
describe("membership and privacy", () => {
  it("does not grant Session access to an Admin or Deacon", () => {
    expect(hasRole(["admin"], SESSION_ROLES)).toBe(false);
    expect(hasRole(["deacon"], SESSION_ROLES)).toBe(false);
    expect(hasRole(["admin", "pastor"], SESSION_ROLES)).toBe(true);
  });
  it("projects names without contact details, birthday or consent fields", () => {
    expect(james).not.toHaveProperty("email");
    expect(james).not.toHaveProperty("birthDate");
    expect(james).not.toHaveProperty("emailOptIn");
    expect(james.householdName).toBe("Calder");
  });
  it("rejects sensitive fields on ordinary people records", () => {
    expect(
      personInputSchema.safeParse({ ...person, disciplineFlag: true }).success,
    ).toBe(false);
    expect(
      personInputSchema.safeParse({ ...person, birthDate: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(person.emailOptIn).toBe(false);
    expect(person.smsOptIn).toBe(false);
  });
  it("keeps omitted fields out of patches so concurrent edits and consent survive", () => {
    expect(personPatchSchema.parse({ email: "changed@example.test" })).toEqual({
      email: "changed@example.test",
    });
    expect(personPatchSchema.safeParse({}).success).toBe(false);
    expect(personPatchSchema.safeParse({ disciplineFlag: true }).success).toBe(
      false,
    );
  });
  it("excludes former and deceased people but keeps non-residents", () => {
    expect(isOnRoll({ ...james, membershipStatus: "former" })).toBe(false);
    expect(isOnRoll({ ...james, isDeceased: true })).toBe(false);
    expect(isOnRoll({ ...james, membershipStatus: "nonResident" })).toBe(true);
  });
});
describe("roll call", () => {
  const people: RosterPerson[] = [
    james,
    {
      ...james,
      id: "grace",
      firstName: "Grace",
      preferredName: "Gracie",
      membershipStatus: "baptized",
    },
    { ...james, id: "visitor", lastName: "Moss", membershipStatus: "visitor" },
  ];
  it("matches preferred names and membership filters without counting hidden rows", () => {
    expect(filterRoster(people, "gracie", "members").map((p) => p.id)).toEqual([
      "grace",
    ]);
    expect(filterRoster(people, "", "visitor").map((p) => p.id)).toEqual([
      "visitor",
    ]);
  });
  it("counts named people once, ignoring unknown IDs", () => {
    expect(
      attendanceCounts(people, {
        present: {
          james: { at: null, method: "roll", byUid: "test" },
          missing: { at: null, method: "roll", byUid: "test" },
        },
      }),
    ).toMatchObject({ total: 1, communicant: 1, baptized: 0 });
  });
});
describe("church calendar", () => {
  const types: ServiceType[] = [
    {
      id: "am",
      name: "Lord's Day Morning",
      dayOfWeek: 0,
      defaultTime: "10:30",
      isActive: true,
    },
    {
      id: "pm",
      name: "Lord's Day Evening",
      dayOfWeek: 0,
      defaultTime: "17:30",
      isActive: true,
    },
  ];
  it("uses the church date across a UTC midnight", () => {
    expect(
      churchDate(
        new Date("2026-11-02T01:00:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toBe("2026-11-01");
  });
  it("selects an ongoing service instead of jumping to evening worship", () => {
    expect(
      nextService(
        types,
        new Date("2026-11-01T16:00:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toMatchObject({ typeId: "am", date: "2026-11-01" });
  });
  it("selects the next service through daylight saving time", () => {
    expect(
      nextService(
        types,
        new Date("2026-10-31T23:00:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toMatchObject({ typeId: "am", date: "2026-11-01" });
    expect(
      nextService(
        types,
        new Date("2026-11-02T04:00:00Z"),
        "America/Indiana/Indianapolis",
      ),
    ).toMatchObject({ typeId: "am", date: "2026-11-08" });
  });
  it("handles a church with no active services", () => {
    expect(nextService([], new Date(), "UTC")).toBeNull();
  });
});
