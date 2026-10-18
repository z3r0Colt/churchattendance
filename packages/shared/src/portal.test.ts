import { describe, expect, it } from "vitest";
import {
  directoryPreferencesSchema,
  eventPublicationSchema,
  memberRsvpSchema,
  onlineFormSchema,
  personInputSchema,
  portalDirectoryEntry,
} from "./index";
const person = {
  ...personInputSchema.parse({
    firstName: "Mara",
    lastName: "Willow",
    householdId: "willow",
    membershipStatus: "communicant",
    email: "mara@example.test",
    mobilePhone: "+12025550101",
    birthDate: "1990-01-01",
  }),
  id: "mara",
};
const house = {
  id: "willow",
  name: "Willow",
  address: "12 Fictional Lane",
  homePhone: "555",
};
describe("member portal privacy", () => {
  it("starts with every sharing option off", () => {
    expect(directoryPreferencesSchema.parse({})).toEqual({
      listed: false,
      shareEmail: false,
      sharePhone: false,
      shareAddress: false,
      expectedRevision: 0,
    });
    expect(
      portalDirectoryEntry(person, house, directoryPreferencesSchema.parse({})),
    ).toBeNull();
  });
  it("projects only explicitly shared fields and never birthdays or membership status", () => {
    expect(
      portalDirectoryEntry(person, house, {
        listed: true,
        shareEmail: true,
        sharePhone: false,
        shareAddress: false,
      }),
    ).toEqual({
      id: "mara",
      name: "Mara Willow",
      email: "mara@example.test",
      phone: "",
      address: "",
    });
  });
  it("omits deceased, former and visitor people despite old sharing preferences", () => {
    const preferences = {
      listed: true,
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
    };
    expect(
      portalDirectoryEntry({ ...person, isDeceased: true }, house, preferences),
    ).toBeNull();
    expect(
      portalDirectoryEntry(
        { ...person, membershipStatus: "former" },
        house,
        preferences,
      ),
    ).toBeNull();
    expect(
      portalDirectoryEntry(
        { ...person, membershipStatus: "visitor" },
        house,
        preferences,
      ),
    ).toBeNull();
  });
  it("never accepts a member-selected person ID for an RSVP or privacy change", () => {
    expect(
      memberRsvpSchema.safeParse({
        eventId: "meal",
        date: "2027-01-03",
        status: "yes",
        personId: "someoneelse",
      }).success,
    ).toBe(false);
    expect(
      directoryPreferencesSchema.safeParse({
        listed: true,
        personId: "someoneelse",
      }).success,
    ).toBe(false);
  });
  it("requires explicit member visibility before public registration", () => {
    expect(
      eventPublicationSchema.safeParse({
        eventId: "meal",
        portalVisible: false,
        publicRegistration: true,
        description: "",
      }).success,
    ).toBe(false);
  });
  it("requires an occurrence for public event requests and forbids messaging consent injection", () => {
    const input = {
      requestId: "e19ca65e-408a-46ab-9934-138a30b0b9b5",
      kind: "visitor",
      firstName: "Mara",
      lastName: "Willow",
      email: "mara@example.test",
    };
    expect(onlineFormSchema.safeParse(input).success).toBe(true);
    expect(
      onlineFormSchema.safeParse({ ...input, kind: "event" }).success,
    ).toBe(false);
    expect(
      onlineFormSchema.safeParse({ ...input, emailOptIn: true }).success,
    ).toBe(false);
  });
});
