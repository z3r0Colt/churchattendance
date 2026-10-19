import { describe, expect, it } from "vitest";
import { columnLabel, displayValue } from "./index";

describe("table display", () => {
  it("turns field keys into plain column names", () => {
    expect(columnLabel("PublicCalendar")).toBe("Public calendar");
    expect(columnLabel("dueDate")).toBe("Due date");
    expect(columnLabel("Person")).toBe("Person");
    expect(columnLabel("Works until")).toBe("Works until");
    expect(columnLabel("last_used")).toBe("Last used");
  });
  it("shows calendar dates in words and leaves other values alone", () => {
    expect(displayValue("2026-10-11")).toBe("Oct 11, 2026");
    expect(displayValue("2026-02-30")).toBe("2026-02-30");
    expect(displayValue("2026-10-11T18:00:00Z")).toBe("2026-10-11T18:00:00Z");
    expect(displayValue(4)).toBe(4);
    expect(displayValue("Calder")).toBe("Calder");
  });
});
