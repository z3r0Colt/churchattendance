import { describe, expect, it } from "vitest";
import {
  contactGaps,
  contactPolicySchema,
  personalMessageContact,
  type ContactEvent,
} from "./index";

const policy = contactPolicySchema.parse({
  historyStart: "2026-10-01",
  defaultContactDays: 60,
  districtContactDays: { north: 30 },
});
const person = (
  id: string,
  membershipStatus = "communicant",
  elderDistrictId = "",
) => ({
  id,
  membershipStatus: membershipStatus as "communicant",
  isDeceased: false,
  elderDistrictId,
});
const event = (personId: string, date: string): ContactEvent => ({
  personId,
  date,
  source: "call",
  refId: `${personId}-${date}`,
});

describe("personal contact from messages", () => {
  const personal = {
    source: "compose",
    audienceKind: "people",
    selectedPersonIds: ["mara"],
    senderIsSession: true,
  };
  it("counts only confirmed text delivery or Microsoft email acceptance", () => {
    expect(
      personalMessageContact(personal, { channel: "sms", status: "delivered" }),
    ).toBe("personalText");
    expect(
      personalMessageContact(personal, {
        channel: "email",
        status: "accepted",
      }),
    ).toBe("personalEmail");
    for (const status of [
      "pending",
      "sending",
      "accepted",
      "sent",
      "failed",
      "undelivered",
      "skipped",
      "unknown",
    ])
      expect(
        personalMessageContact(personal, { channel: "sms", status }),
      ).toBeNull();
    for (const status of ["pending", "failed", "skipped", "simulated"])
      expect(
        personalMessageContact(personal, { channel: "email", status }),
      ).toBeNull();
  });
  it("excludes bulletins, automation, broadcasts and messages from non-Session senders", () => {
    const delivered = { channel: "sms", status: "delivered" };
    for (const message of [
      { ...personal, source: "bulletin" },
      { ...personal, source: "absence-alert" },
      { ...personal, audienceKind: "all" },
      { ...personal, audienceKind: "district" },
      { ...personal, selectedPersonIds: ["a", "b", "c", "d"] },
      { ...personal, senderIsSession: false },
    ])
      expect(personalMessageContact(message, delivered)).toBeNull();
  });
});

describe("contact gaps", () => {
  it("separates unknown history from a known gap", () => {
    const people = [person("early"), person("later")];
    expect(
      contactGaps(people, [], policy, "2026-11-15").map((row) => row.state),
    ).toEqual(["unknown", "unknown"]);
    const flags = contactGaps(people, [], policy, "2026-12-15");
    expect(flags[0]).toMatchObject({
      state: "gap",
      measuredFrom: "2026-10-01",
      dueDate: "2026-11-30",
      daysPastDue: 15,
      lastContact: null,
      rule: "church",
    });
  });
  it("uses the latest contact on or before today and the district rule", () => {
    const [flag] = contactGaps(
      [person("mara", "communicant", "north")],
      [
        event("mara", "2026-10-05"),
        event("mara", "2026-11-01"),
        event("mara", "2027-01-01"),
        event("other", "2026-12-01"),
      ],
      policy,
      "2026-12-10",
    );
    expect(flag).toMatchObject({
      state: "gap",
      rule: "district",
      thresholdDays: 30,
      dueDate: "2026-12-01",
      daysPastDue: 9,
      lastContact: { date: "2026-11-01" },
    });
    expect(
      contactGaps(
        [person("mara", "communicant", "north")],
        [event("mara", "2026-11-20")],
        policy,
        "2026-12-10",
      )[0].state,
    ).toBe("current");
  });
  it("measures a newcomer from their roll entry and leaves untracked people out", () => {
    const flags = contactGaps(
      [
        person("new"),
        person("child", "baptized"),
        person("guest", "visitor"),
        { ...person("gone"), isDeceased: true },
      ],
      [],
      policy,
      "2027-01-10",
      { new: "2026-12-01" },
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      personId: "new",
      state: "notDue",
      measuredFrom: "2026-12-01",
    });
  });
  it("orders gaps first by how far past due they are", () => {
    expect(
      contactGaps(
        [person("a"), person("b"), person("c")],
        [event("a", "2026-12-01"), event("b", "2026-10-05")],
        policy,
        "2027-01-20",
      ).map((row) => [row.personId, row.state]),
    ).toEqual([
      ["c", "gap"],
      ["b", "gap"],
      ["a", "current"],
    ]);
  });
  it("keeps visitors and former members out of the tracked statuses", () => {
    expect(
      contactPolicySchema.safeParse({
        historyStart: "2026-10-01",
        trackedStatuses: ["visitor"],
      }).success,
    ).toBe(false);
  });
});
