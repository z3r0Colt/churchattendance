import { describe, expect, it } from "vitest";
import {
  absencePeople,
  audiencePeople,
  bulletinClock,
  chooseRecipients,
  communicationSettingsSchema,
  localSchedule,
  mergeFields,
  messageInputSchema,
  normalizePhone,
  personInputSchema,
  smsConsentKeyword,
  smsSegments,
  type Person,
  type Service,
} from "./index";
const settings = communicationSettingsSchema.parse({});
const person = (id: string, overrides: Partial<Person> = {}): Person => ({
  id,
  ...personInputSchema.parse({
    firstName: "Alex",
    lastName: "Ash",
    householdId: "ash",
    membershipStatus: "communicant",
    email: `${id}@example.test`,
    mobilePhone: "+12025550101",
    ...overrides,
  }),
});
describe("recipient consent and audiences", () => {
  it("excludes every channel without consent and deduplicates opted-in addresses", () => {
    const rows = chooseRecipients(
      [
        person("a", { emailOptIn: true, smsOptIn: false }),
        person("b", {
          email: "a@example.test",
          emailOptIn: true,
          smsOptIn: true,
        }),
      ],
      "both",
    );
    expect(rows.map((row) => [row.channel, row.status, row.error])).toEqual([
      ["email", "pending", ""],
      ["sms", "skipped", "Opted out"],
      ["email", "skipped", "Duplicate address"],
      ["sms", "pending", ""],
    ]);
  });
  it("does not count a blank or invalid address as a recipient", () => {
    expect(
      chooseRecipients(
        [
          person("a", {
            email: "",
            emailOptIn: true,
            mobilePhone: "letters",
            smsOptIn: true,
          }),
        ],
        "both",
      ).every((row) => row.status === "skipped"),
    ).toBe(true);
  });
  it("selects households, districts, groups and statuses without former or deceased people", () => {
    const people = [
      person("a", { elderDistrictId: "north" }),
      person("b", { membershipStatus: "adherent", householdId: "birch" }),
      person("former", { membershipStatus: "former" }),
      person("dead", { isDeceased: true }),
    ];
    expect(audiencePeople(people, { kind: "all", ids: [] })).toHaveLength(2);
    expect(
      audiencePeople(people, { kind: "district", ids: ["north"] }).map(
        (row) => row.id,
      ),
    ).toEqual(["a"]);
    expect(
      audiencePeople(people, { kind: "household", ids: ["birch"] }).map(
        (row) => row.id,
      ),
    ).toEqual(["b"]);
    expect(
      audiencePeople(people, { kind: "status", ids: ["adherent"] }).map(
        (row) => row.id,
      ),
    ).toEqual(["b"]);
    expect(
      audiencePeople(people, { kind: "group", ids: ["prayer"] }, [
        { id: "prayer", memberIds: ["a"] },
      ]).map((row) => row.id),
    ).toEqual(["a"]);
  });
  it("normalizes US numbers and preserves explicit international country codes", () => {
    expect(normalizePhone("(202) 555-0101")).toBe("+12025550101");
    expect(normalizePhone("+44 20 7946 0123")).toBe("+442079460123");
    expect(() => normalizePhone("call me")).toThrow();
  });
  it.each([
    "STOP",
    " stop ",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
    "REVOKE",
    "OPTOUT",
  ])("honors the %s opt-out command", (value) => {
    expect(smsConsentKeyword(value)).toBe("stop");
  });
  it("recognizes provider OptOutType and never treats ordinary sentences as START", () => {
    expect(smsConsentKeyword("please stop", "STOP")).toBe("stop");
    expect(smsConsentKeyword("Yes please come tomorrow")).toBeNull();
    expect(smsConsentKeyword("UNSTOP")).toBe("start");
    expect(smsConsentKeyword("HELP")).toBe("help");
  });
});
describe("message validation", () => {
  it("renders only supported fields without interpreting person data as a template", () => {
    expect(
      mergeFields("Dear {FirstName}, {ChurchName}", {
        FirstName: "{Date}",
        ChurchName: "Sycamore RPC",
      }),
    ).toBe("Dear {Date}, Sycamore RPC");
    expect(() => mergeFields("{Password}", {})).toThrow();
    expect(
      messageInputSchema.safeParse({
        requestId: "m",
        channel: "email",
        subject: "{PrivateNote}",
        body: "Hello",
        audience: { kind: "all" },
      }).success,
    ).toBe(false);
  });
  it("counts GSM escape characters, multipart text and UTF-16 emoji", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({
      encoding: "GSM-7",
      segments: 1,
    });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("€").units).toBe(2);
    expect(smsSegments("🙂".repeat(36))).toMatchObject({
      encoding: "Unicode",
      units: 72,
      segments: 2,
    });
  });
  it("defaults live delivery and public bulletin links off", () => {
    expect(settings).toMatchObject({
      emailEnabled: false,
      smsEnabled: false,
      bulletinEnabled: false,
      shareBulletinLink: false,
    });
    expect(
      communicationSettingsSchema.safeParse({ bulletinSms: true }).success,
    ).toBe(false);
  });
});
describe("church time and Saturday cutoff", () => {
  const zone = "America/Indiana/Indianapolis";
  it("selects the next Lord's Day and starts at the church's Saturday send time", () => {
    expect(
      bulletinClock(new Date("2026-10-17T21:59:59Z"), zone, settings),
    ).toMatchObject({ week: "2026-10-18", send: false });
    expect(
      bulletinClock(new Date("2026-10-17T22:00:00Z"), zone, settings).send,
    ).toBe(true);
  });
  it("stops after 11 PM and never automatically sends on Lord's Day morning", () => {
    expect(
      bulletinClock(new Date("2026-10-18T03:00:01Z"), zone, settings).send,
    ).toBe(false);
    expect(
      bulletinClock(new Date("2026-10-18T13:00:00Z"), zone, settings).send,
    ).toBe(false);
  });
  it("uses the winter offset after daylight saving time ends", () => {
    expect(
      bulletinClock(new Date("2026-11-07T23:00:00Z"), zone, settings).send,
    ).toBe(true);
    expect(localSchedule("2026-11-07T18:00", zone)).toBe(
      "2026-11-07T23:00:00.000Z",
    );
  });
  it("rejects nonexistent or ambiguous scheduled wall times", () => {
    expect(() => localSchedule("2026-03-08T02:30", zone)).toThrow();
    expect(() => localSchedule("2026-11-01T01:30", zone)).toThrow();
  });
});
describe("absence alerts", () => {
  const meeting = (date: string, present = false): Service => ({
    id: `am_${date}`,
    date,
    serviceTypeId: "am",
    notes: "",
    present: present ? { alex: { at: null, method: "roll", byUid: "u" } } : {},
    lastAttendancePersonId: "",
  });
  it("requires a recorded service on each of three consecutive Lord's Days", () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const people = [person("alex")];
    expect(
      absencePeople(
        people,
        [meeting("2026-11-08"), meeting("2026-11-01")],
        "am",
        now,
        "UTC",
      ),
    ).toEqual([]);
    expect(
      absencePeople(
        people,
        [meeting("2026-11-08"), meeting("2026-11-01"), meeting("2026-10-25")],
        "am",
        now,
        "UTC",
      ),
    ).toHaveLength(1);
    expect(
      absencePeople(
        people,
        [
          meeting("2026-11-08", true),
          meeting("2026-11-01"),
          meeting("2026-10-25"),
        ],
        "am",
        now,
        "UTC",
      ),
    ).toEqual([]);
  });
  it("does not alert on visitors or non-resident members", () => {
    const people = [
      person("visitor", { membershipStatus: "visitor" }),
      person("away", { membershipStatus: "nonResident" }),
    ];
    expect(
      absencePeople(
        people,
        [meeting("2026-11-08"), meeting("2026-11-01"), meeting("2026-10-25")],
        "am",
        new Date("2026-11-09T15:00:00Z"),
        "UTC",
      ),
    ).toEqual([]);
  });
});
