import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
const state = vi.hoisted(() => ({ churchName: "Cedar Reformed Church", appName: "Cedar", bytes: [] as number[] }));
vi.mock("../branding", () => ({ currentBranding: () => ({ ...state, palette: "forest", logo: "" }) }));
vi.mock("../platform", () => ({ native: { saveXlsx: async (bytes: number[]) => { state.bytes = bytes; } } }));
vi.mock("./chms", () => ({ directoryPhoto: async () => "" }));
import { reportHtml, exportReportWorkbook } from "./reports";
describe("report identity", () => {
  it("uses each configured church in print headers and all workbook sheets", async () => {
    for (const [name, app] of [["Cedar Reformed Church", "Cedar"], ["Harbor Presbyterian Church", "Harbor"]]) {
      state.churchName = name; state.appName = app;
      const html = reportHtml("Session only · Attendance", "2026", "<p>Fictional summary</p>");
      expect(html).toContain(`<strong>${name}</strong>`);
      expect(html).toContain("Session only");
      expect(html).not.toContain("SYCAMORE");
      await exportReportWorkbook("Session only · Attendance", [{ Total: 1 }], [{ Name: "Fictional Person" }], [{ Total: 1 }]);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Uint8Array.from(state.bytes).buffer);
      expect(book.creator).toBe(name);
      for (const sheet of book.worksheets) {
        expect(sheet.getCell("A1").value).toBe(name);
        expect(sheet.getCell("B1").value).toBe("Session only · Attendance");
      }
    }
  });
  it("escapes church text in the standalone HTML document", () => {
    state.churchName = 'Cedar & Harbor';
    expect(reportHtml("Report", "", "")).toContain("Cedar &amp; Harbor");
  });
});
