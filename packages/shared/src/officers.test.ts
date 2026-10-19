import { describe, expect, it } from "vitest";
import {
  ageOn,
  membershipAt,
  officeConflicts,
  officeSchema,
  officeState,
  officerEligibility,
  statusSince,
  termReviews,
  wouldOverlap,
  disciplineOn,
  policyOn,
  quorumPolicySchema,
  quorumReport,
  type HistoryEvent,
  type Office,
  type OfficerPolicy,
  type Person,
  type QuorumPolicy,
} from "./index.js";

const person = (id: string, extra: Partial<Person> = {}): Person => ({
  id,
  firstName: id,
  lastName: "Fenwick",
  preferredName: "",
  householdId: "h",
  membershipStatus: "communicant",
  email: "",
  mobilePhone: "",
  birthDate: "1970-01-01",
  emailOptIn: false,
  smsOptIn: false,
  isDeceased: false,
  elderDistrictId: "",
  ...extra,
});
const office = (id: string, extra: Partial<Office> = {}): Office => ({
  id,
  personId: "amos",
  role: "elder",
  ordainedOn: "2010-05-01",
  installedOn: "2010-05-01",
  termEndsOn: "",
  endedOn: "",
  endReason: "",
  emeritusOn: "",
  revision: 1,
  ...extra,
});
const event = (
  personId: string,
  date: string,
  fromStatus: HistoryEvent["fromStatus"],
  toStatus: HistoryEvent["toStatus"],
  method: HistoryEvent["method"] = "profession",
): HistoryEvent => ({
  id: `${personId}-${date}`,
  personId,
  date,
  fromStatus,
  toStatus,
  method,
  otherChurch: "",
  reason: "Recorded",
});

describe("office records", () => {
  it("validates dates and needs an end reason with an end date", () => {
    const base = {
      id: "o1",
      personId: "amos",
      role: "elder",
      ordainedOn: "2010-05-01",
      installedOn: "2010-05-01",
    };
    expect(officeSchema.safeParse(base).success).toBe(true);
    expect(
      officeSchema.safeParse({ ...base, installedOn: "2009-01-01" }).success,
    ).toBe(false);
    expect(
      officeSchema.safeParse({ ...base, endedOn: "2015-01-01" }).success,
    ).toBe(false);
    expect(
      officeSchema.safeParse({
        ...base,
        endedOn: "2015-01-01",
        endReason: "rotated",
      }).success,
    ).toBe(true);
    expect(
      officeSchema.safeParse({ ...base, emeritusOn: "2016-01-01" }).success,
    ).toBe(false);
    expect(
      officeSchema.safeParse({ ...base, ordainedOn: "", installedOn: "" })
        .success,
    ).toBe(false);
  });
  it("reads the state on a date, with the end date not counted as service", () => {
    const row = office("o1", {
      endedOn: "2020-06-01",
      endReason: "retired",
      emeritusOn: "2021-01-01",
    });
    expect(officeState(row, "2010-04-30")).toBe("notYet");
    expect(officeState(row, "2020-05-31")).toBe("serving");
    expect(officeState(row, "2020-06-01")).toBe("ended");
    expect(officeState(row, "2021-01-01")).toBe("emeritus");
    expect(officeState(office("o2", { installedOn: "" }), "2026-01-01")).toBe(
      "unknown",
    );
  });
  it("flags overlapping periods, missing installation and service after death", () => {
    const rows = [
      office("a", { endedOn: "2016-01-01", endReason: "rotated" }),
      office("b", { installedOn: "2015-06-01", ordainedOn: "2010-05-01" }),
      office("c", { personId: "beth", installedOn: "" }),
    ];
    const problems = officeConflicts(rows, [
      person("amos", { isDeceased: true }),
      person("beth"),
    ]);
    expect(
      problems.filter((p) => p.message.startsWith("Overlaps")),
    ).toHaveLength(2);
    expect(problems).toContainEqual({
      officeId: "b",
      message: "The person has died but this service has no end date",
    });
    expect(problems).toContainEqual({
      officeId: "c",
      message: "Installation date not recorded",
    });
    // A later period that begins on the day the earlier one ended does not overlap.
    expect(
      wouldOverlap(
        { ...office("d", { installedOn: "2016-01-01" }), expectedRevision: 0 },
        [rows[0]],
      ),
    ).toBe(false);
    expect(
      wouldOverlap(
        { ...office("d", { installedOn: "2015-12-31" }), expectedRevision: 0 },
        [rows[0]],
      ),
    ).toBe(true);
  });
  it("lists terms ending within 60 days and passed terms still open", () => {
    const rows = [
      office("soon", { termEndsOn: "2026-12-01" }),
      office("late", { personId: "beth", termEndsOn: "2026-09-01" }),
      office("far", { personId: "cal", termEndsOn: "2027-06-01" }),
      office("done", {
        personId: "dan",
        termEndsOn: "2026-11-01",
        endedOn: "2026-10-01",
        endReason: "termEnded",
      }),
    ];
    expect(
      termReviews(rows, "2026-10-19").map((row) => [row.id, row.review]),
    ).toEqual([
      ["late", "overdue"],
      ["soon", "due"],
    ]);
  });
});

describe("officer eligibility", () => {
  const policy: OfficerPolicy = {
    role: "elder",
    statuses: ["communicant"],
    minimumAge: 25,
    minimumMemberYears: 3,
    excludeUnderDiscipline: true,
    source: "Session minute",
    revision: 1,
  };
  const people = [
    person("amos"),
    person("beth", { birthDate: "" }),
    person("cal", { birthDate: "2005-01-01" }),
    person("dan"),
    person("eve", { membershipStatus: "adherent" }),
    person("fay", { isDeceased: true }),
  ];
  const history = [
    event("amos", "2015-01-01", null, "communicant", "transfer"),
    event("beth", "2015-01-01", null, "communicant"),
    event("cal", "2023-01-01", null, "communicant"),
    event("dan", "2026-01-01", null, "communicant", "initial"),
    event("eve", "2020-01-01", null, "adherent"),
  ];
  const rows = officerEligibility({
    people,
    history,
    offices: [office("o", { personId: "amos" })],
    policy,
    decisions: [
      {
        id: "d1",
        personId: "amos",
        role: "elder",
        decision: "approved",
        decidedOn: "2026-02-01",
        note: "",
        revision: 1,
      },
    ],
    disciplinedOn: (id) => (id === "cal" ? true : false),
    statusOn: (p, date) => membershipAt(p, history, date),
    asOf: "2026-10-19",
  });
  const row = (id: string) => rows.find((r) => r.personId === id)!;
  it("restates recorded facts and marks gaps for review", () => {
    expect(row("amos").result).toBe("met");
    expect(row("amos").serving).toBe(true);
    expect(row("amos").decision?.decision).toBe("approved");
    expect(row("beth").result).toBe("unknown");
    expect(row("cal").result).toBe("notMet");
    // The roll entry date is not a reception date.
    expect(
      row("dan").criteria.find((c) => c.label === "Years as member"),
    ).toEqual({
      label: "Years as member",
      state: "unknown",
      detail: "Date received was not recorded (entered with the roll)",
    });
    expect(row("eve").result).toBe("notMet");
    expect(rows.some((r) => r.personId === "fay")).toBe(false);
  });
  it("finds the latest entry into a qualifying status", () => {
    const moves = [
      event("gil", "2010-01-01", null, "communicant", "profession"),
      event("gil", "2014-01-01", "communicant", "former", "transfer"),
      event("gil", "2019-03-01", "former", "communicant", "transfer"),
    ];
    expect(statusSince("gil", moves, ["communicant"], "2026-01-01")).toEqual({
      since: "2019-03-01",
    });
    expect(statusSince("gil", moves, ["communicant"], "2015-01-01")).toEqual({
      unknown: "Not in a qualifying status",
    });
  });
  it("counts a Feb 29 birthday from Feb 28", () => {
    expect(ageOn("2000-02-29", "2025-02-27")).toBe(24);
    expect(ageOn("2000-02-29", "2025-02-28")).toBe(25);
    expect(ageOn("", "2025-02-28")).toBeNull();
  });
});

describe("quorum", () => {
  const sessionRule: QuorumPolicy = {
    id: "q1",
    meetingType: "session",
    effectiveFrom: "2020-01-01",
    electorate: "officers",
    offices: ["pastor", "elder"],
    includeEmeritus: false,
    statuses: [],
    minimumAge: 0,
    excludeUnderDiscipline: false,
    minimumCount: 2,
    percent: 50,
    source: "Session rule 2020",
    revision: 1,
  };
  const officers = [
    office("p", { personId: "pat", role: "pastor" }),
    office("a", { personId: "amos" }),
    office("b", { personId: "beth", installedOn: "2024-01-01" }),
    office("c", {
      personId: "cal",
      endedOn: "2022-01-01",
      endReason: "retired",
      emeritusOn: "2022-01-01",
    }),
    office("d", { personId: "dan" }),
  ];
  const people = ["pat", "amos", "beth", "cal", "dan"].map((id) => person(id));
  const run = (date: string, present: string[], policies = [sessionRule]) =>
    quorumReport({
      policy: policyOn(policies, "session", date),
      meeting: { date, presentPersonIds: present },
      people,
      offices: officers,
      statusOn: () => "communicant",
      disciplinedOn: () => false,
    });
  it("uses the officers serving on the meeting date and shows the calculation", () => {
    const now = run("2026-03-01", ["pat", "amos"]);
    expect(now?.electorate).toBe(4);
    expect(now?.required).toBe(2);
    expect(now?.met).toBe(true);
    expect(now?.entries.find((e) => e.personId === "cal")?.reason).toBe(
      "Emeritus, not counted by this rule",
    );
    expect(now?.calculation).toBe(
      "At least 2 and 50% of 4 rounded up is 2. Required: 2. Present from the electorate: 2.",
    );
    // Before Beth was installed and while Cal still served.
    const then = run("2021-03-01", ["pat"]);
    expect(then?.electorate).toBe(4);
    expect(then?.entries.find((e) => e.personId === "beth")?.state).toBe(
      "excluded",
    );
    expect(then?.met).toBe(false);
  });
  it("reports no rule before one took effect and follows a later rule", () => {
    expect(run("2019-06-01", ["pat"])).toBeNull();
    const stricter = {
      ...sessionRule,
      id: "q2",
      effectiveFrom: "2026-01-01",
      percent: 75,
    };
    expect(
      run("2025-12-31", ["pat", "amos"], [sessionRule, stricter])?.met,
    ).toBe(true);
    expect(
      run("2026-03-01", ["pat", "amos"], [sessionRule, stricter])?.required,
    ).toBe(3);
  });
  it("cannot decide when records needing review could change the result", () => {
    const rows = [
      ...officers,
      office("e", { personId: "eli", installedOn: "" }),
    ];
    const result = quorumReport({
      policy: { ...sessionRule, minimumCount: 0, percent: 51 },
      meeting: { date: "2026-03-01", presentPersonIds: ["pat", "amos", "eli"] },
      people: [...people, person("eli")],
      offices: rows,
      statusOn: () => "communicant",
      disciplinedOn: () => false,
    });
    expect(result?.unknown).toBe(1);
    expect(result?.met).toBeNull();
  });
  it("builds a member electorate from history on the date", () => {
    const history = [
      event("amos", "2010-01-01", null, "communicant"),
      event("beth", "2010-01-01", null, "communicant"),
      event("beth", "2025-01-01", "communicant", "former", "death"),
      event("cal", "2010-01-01", null, "baptized", "baptism"),
    ];
    const members = [
      person("amos"),
      person("beth", { membershipStatus: "former", isDeceased: true }),
      person("cal", { membershipStatus: "baptized" }),
      person("dan"),
    ];
    const result = quorumReport({
      policy: quorumPolicySchema.parse({
        id: "c",
        meetingType: "congregational",
        effectiveFrom: "2000-01-01",
        electorate: "members",
        statuses: ["communicant"],
        excludeUnderDiscipline: true,
        minimumCount: 1,
        source: "Bylaws",
      }) as QuorumPolicy,
      meeting: { date: "2024-06-01", presentPersonIds: ["amos", "cal"] },
      people: members,
      offices: [],
      statusOn: (p, date) => membershipAt(p, history, date),
      disciplinedOn: (id) => (id === "beth" ? true : false),
    });
    expect(result?.entries).toEqual([
      { personId: "amos", state: "included", reason: "Qualifying member" },
      {
        personId: "beth",
        state: "excluded",
        reason: "Under discipline on this date",
      },
      {
        personId: "cal",
        state: "excluded",
        reason: "Status not in this electorate",
      },
      {
        personId: "dan",
        state: "unknown",
        reason: "Membership history needs review",
      },
    ]);
    expect(result?.presentOutside).toEqual(["cal"]);
    expect(result?.met).toBe(true);
  });
  it("reads discipline on a date from dated entries", () => {
    const record = {
      disciplineFlag: false,
      disciplineHistory: [
        { date: "2024-01-01", flag: true },
        { date: "2025-01-01", flag: false },
      ],
    };
    expect(disciplineOn(record, "2023-06-01")).toBe(false);
    expect(disciplineOn(record, "2024-06-01")).toBe(true);
    expect(disciplineOn(record, "2025-06-01")).toBe(false);
    expect(
      disciplineOn(
        { disciplineFlag: true, disciplineHistory: [] },
        "2025-01-01",
      ),
    ).toBeNull();
    expect(disciplineOn(undefined, "2025-01-01")).toBe(false);
  });
});
