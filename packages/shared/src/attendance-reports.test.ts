import { describe, expect, it } from "vitest";
import {
  attendanceReport,
  attendanceReportFilterSchema,
  historicalMembership,
  reportAttendanceRows,
  type AttendanceReportSource,
} from "./attendance-reports";
import {
  personInputSchema,
  type MembershipStatus,
  type Service,
} from "./domain";
import type { HistoryEvent } from "./chms";
const person = (id: string, status: MembershipStatus) => ({
  ...personInputSchema.parse({
    firstName: id,
    lastName: "Ash",
    householdId: "ash",
    membershipStatus: status,
  }),
  id,
});
const event = (
  personId: string,
  date: string,
  fromStatus: MembershipStatus | null,
  toStatus: MembershipStatus,
): HistoryEvent => ({
  id: date,
  personId,
  date,
  fromStatus,
  toStatus,
  method: fromStatus === null ? "initial" : "other",
  otherChurch: "",
  reason: "Example history",
});
const service = (date: string, ids: string[], type = "am"): Service => ({
  id: `${type}_${date}`,
  date,
  serviceTypeId: type,
  notes: "",
  lastAttendancePersonId: "",
  present: Object.fromEntries(
    ids.map((id) => [id, { at: null, method: "roll", byUid: "staff" }]),
  ),
});
const filter = {
  from: "2026-01-01",
  to: "2026-03-31",
  serviceTypeId: "am",
  status: "" as const,
  districtId: "",
};
function source(): AttendanceReportSource {
  return {
    people: [
      person("Avery", "communicant"),
      { ...person("Blake", "former"), isDeceased: true },
      person("Casey", "communicant"),
    ],
    households: [
      { id: "ash", name: "Ash", address: "1 Example Lane", homePhone: "" },
    ],
    types: [
      {
        id: "am",
        name: "Lord's Day Morning",
        dayOfWeek: 0,
        defaultTime: "10:30",
        isActive: true,
      },
    ],
    history: [
      event("Avery", "2026-01-01", null, "visitor"),
      event("Avery", "2026-02-01", "visitor", "communicant"),
      event("Blake", "2026-01-01", null, "baptized"),
      event("Blake", "2026-03-01", "baptized", "former"),
    ],
    sacraments: [],
    services: [
      service("2026-01-11", ["Avery", "Blake", "Casey", "orphan"]),
      service("2026-02-08", ["Avery", "Blake"]),
      service("2026-03-08", ["Avery"]),
    ],
  };
}
describe("historical attendance reports", () => {
  it("scopes raw exports to report subjects and excludes visitor opportunities from shepherding rates", () => {
    const data = source(),
      result = attendanceReport(data, filter);
    expect(
      reportAttendanceRows(result, "visitors").map((row) => row["Person ID"]),
    ).toEqual(["Avery"]);
    data.services[0] = service("2026-01-11", []);
    const rates = attendanceReport(data, filter);
    expect(
      rates.matrix.find((row) => row.Name === "Avery Ash")?.["Attendance %"],
    ).toBe(66.7);
    expect(
      rates.shepherding.find((row) => row.Name === "Avery Ash")?.[
        "Attendance %"
      ],
    ).toBe(100);
    data.people[1] = person("Blake", "baptized");
    data.history = data.history.filter(
      (row) => row.personId !== "Blake" || row.fromStatus === null,
    );
    data.services = [
      service("2026-01-11", ["Avery", "Blake", "Casey", "orphan"]),
      service("2026-02-08", []),
      service("2026-02-15", []),
      service("2026-03-08", []),
    ];
    expect(
      reportAttendanceRows(
        attendanceReport(data, filter),
        "shepherding",
        true,
      ).map((row) => row["Person ID"]),
    ).toEqual(["Blake"]);
  });
  it("flags malformed historical dates without crashing the report", () => {
    const data = source();
    data.history[0].date = "not-a-date";
    expect(
      attendanceReport(data, filter).review.some(
        (row) => row.Name === "Avery Ash",
      ),
    ).toBe(true);
    expect(
      historicalMembership(data.people[0], data.history, "2026-02-02").known,
    ).toBe(false);
  });
  it("does not extend a change record indefinitely into an undocumented past or classify an inconsistent deceased flag", () => {
    const row = person("Avery", "communicant"),
      history = [event("Avery", "2026-02-01", "baptized", "communicant")];
    expect(historicalMembership(row, history, "2026-01-01").known).toBe(false);
    expect(historicalMembership(row, history, "2026-02-02")).toEqual({
      known: true,
      status: "communicant",
    });
    expect(
      historicalMembership({ ...row, isDeceased: true }, history, "2026-02-02")
        .known,
    ).toBe(false);
  });
  it("preserves all marks and classifies them using the meeting date", () => {
    const result = attendanceReport(source(), filter);
    expect(result.summary[0]).toMatchObject({
      Visitors: 1,
      Baptized: 1,
      Communicant: 0,
      Unclassified: 2,
      Total: 4,
    });
    expect(result.summary[1]).toMatchObject({
      Visitors: 0,
      Baptized: 1,
      Communicant: 1,
      Total: 2,
    });
    for (const row of result.summary)
      expect(
        row.Communicant +
          row.Baptized +
          row["Non-resident"] +
          row.Adherents +
          row.Visitors +
          row.Former +
          row.Unclassified,
      ).toBe(row.Total);
    expect(
      result.review.some((row) => row.Name === "Person record missing"),
    ).toBe(true);
  });
  it("does not infer missing or inconsistent history from today's status", () => {
    const data = source();
    expect(
      historicalMembership(data.people[2], data.history, "2026-02-01"),
    ).toEqual({ known: false, status: null });
    data.history.push(event("Casey", "2026-01-01", null, "visitor"));
    expect(
      historicalMembership(data.people[2], data.history, "2026-02-01"),
    ).toEqual({ known: false, status: null });
    expect(
      attendanceReport(data, filter).matrix.find(
        (row) => row.Name === "Casey Ash",
      )?.["Attendance %"],
    ).toBe("Review history");
  });
  it("distinguishes a date before the initial roll entry from missing history", () => {
    const data = source();
    expect(
      historicalMembership(data.people[0], data.history, "2025-12-31"),
    ).toEqual({ known: true, status: null });
  });
  it("includes former people historically and excludes post-removal opportunities", () => {
    const row = attendanceReport(source(), filter).matrix.find(
      (row) => row.Name === "Blake Ash",
    )!;
    expect(row.Eligible).toBe(2);
    expect(row.Attended).toBe(2);
    expect(row["Attendance %"]).toBe(100);
    expect(row["2026-03-08 Lord's Day Morning [am]"]).toBe("n/a");
  });
  it("filters by historical status without substituting current status", () => {
    const result = attendanceReport(source(), { ...filter, status: "visitor" });
    expect(result.summary[0].Total).toBe(1);
    expect(result.summary[1].Total).toBe(0);
    expect(
      result.matrix.find((row) => row.Name === "Avery Ash")?.Eligible,
    ).toBe(1);
    expect(result.matrix.some((row) => row.Name === "Casey Ash")).toBe(false);
  });
  it("averages recorded meetings only and compares the same weekday 52 weeks earlier", () => {
    const data = source();
    data.services = [
      service("2025-03-09", ["Avery", "Blake"]),
      service("2026-02-22", []),
      service("2026-03-08", ["Avery"]),
    ];
    const result = attendanceReport(data, filter),
      row = result.summary.at(-1)!;
    expect(row["Prior 4 week average"]).toBe(0);
    expect(row["Same weekday 52 weeks earlier"]).toBe(2);
    expect(result.summary).toHaveLength(2);
    expect(result.monthly.find((row) => row.Month === "2026-01")?.Average).toBe(
      "No records",
    );
  });
  it("counts distinct recorded Lord's Days in absence streaks and treats either service as attendance", () => {
    const data = source();
    data.services = [
      service("2026-02-08", []),
      service("2026-02-08", [], "pm"),
      service("2026-03-08", []),
      service("2026-03-22", []),
    ];
    let result = attendanceReport(data, { ...filter, serviceTypeId: "" });
    expect(
      result.shepherding.find((row) => row.Name === "Avery Ash")?.[
        "Recorded Lord's Days missed"
      ],
    ).toBe(3);
    expect(
      result.shepherding.find((row) => row.Name === "Casey Ash")?.[
        "Recorded Lord's Days missed"
      ],
    ).toBe(0);
    data.services.push(service("2026-03-22", ["Avery"], "pm"));
    result = attendanceReport(data, { ...filter, serviceTypeId: "" });
    expect(
      result.shepherding.find((row) => row.Name === "Avery Ash")?.[
        "Recorded Lord's Days missed"
      ],
    ).toBe(0);
  });
  it("counts visitor dates once even when the visitor attends both services or later joins", () => {
    const data = source();
    data.services.push(
      service("2026-01-11", ["Avery"], "pm"),
      service("2026-01-18", ["Avery"]),
    );
    const row = attendanceReport(data, { ...filter, serviceTypeId: "" })
      .visitors[0];
    expect(row.Name).toBe("Avery Ash");
    expect(row["Distinct visits in range"]).toBe(2);
    expect(row.Returning).toBe("Yes");
  });
  it("keeps private care absent unless authorized data was supplied, and exports no note bodies", () => {
    const data = source(),
      publicRows = attendanceReport(data, filter);
    expect(publicRows.visitors[0]["Follow-up information"]).toBe(
      "Session only",
    );
    expect(publicRows.visitors[0]).not.toHaveProperty(
      "Current open follow-ups",
    );
    data.followUps = [
      {
        id: "f",
        personId: "Avery",
        assignedToUid: "elder",
        title: "Private task",
        dueDate: "2026-03-01",
        done: false,
        revision: 1,
      },
    ];
    data.careNotes = [
      {
        id: "v",
        personId: "Avery",
        authorUid: "elder",
        kind: "visit",
        date: "2026-02-15",
        body: "Private body never exported",
        revision: 1,
      },
    ];
    const rows = attendanceReport(data, filter).visitors;
    expect(rows[0]["Current open follow-ups"]).toBe(1);
    expect(rows[0]["Latest recorded visit"]).toBe("2026-02-15");
    expect(JSON.stringify(rows)).not.toContain("Private body");
    expect(JSON.stringify(rows)).not.toContain("Private task");
  });
  it("builds the roll at the chosen date with dated sacrament records", () => {
    const data = source();
    data.sacraments = [
      {
        id: "s",
        personId: "Blake",
        type: "baptism",
        date: "2025-01-01",
        category: "infant",
      },
    ];
    const result = attendanceReport(data, { ...filter, to: "2026-02-20" });
    expect(result.roll.find((row) => row.Name === "Blake Ash")).toMatchObject({
      Status: "Baptized Member",
      Baptism: "2025-01-01",
      Address: "1 Example Lane",
    });
    expect(result.roll.some((row) => row.Name === "Casey Ash")).toBe(false);
  });
  it("uses current district assignments and unique columns for duplicate service names", () => {
    const data = source();
    data.people[0].elderDistrictId = "north";
    data.types.push({ ...data.types[0], id: "pm" });
    data.services.push(service("2026-01-11", ["Avery"], "pm"));
    const result = attendanceReport(data, {
      ...filter,
      serviceTypeId: "",
      districtId: "north",
    });
    expect(result.matrix).toHaveLength(1);
    expect(new Set(result.headers).size).toBe(result.headers.length);
    expect(result.summary[0].Total).toBe(1);
  });
  it("validates ranges and excludes services after the chosen end date", () => {
    for (const patch of [
      { from: "2026-04-01" },
      { to: "2028-01-01" },
      { from: "2026-02-30" },
    ])
      expect(
        attendanceReportFilterSchema.safeParse({ ...filter, ...patch }).success,
      ).toBe(false);
    const data = source();
    data.services.push(service("2027-01-03", ["Avery"]));
    expect(attendanceReport(data, filter).summary).toHaveLength(3);
  });
});
