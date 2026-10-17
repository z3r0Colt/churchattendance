import Papa from "papaparse";
export type ExportRow = Record<string, string | number>;
function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportCsv(rows: ExportRow[]) {
  const csv = Papa.unparse(rows, { escapeFormulae: true });
  if (window.desktop) await window.desktop.saveCsv(csv);
  else download("\uFEFF" + csv, "text/csv;charset=utf-8", "attendance.csv");
}
export async function exportXlsx(rows: ExportRow[]) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Sycamore RPC";
  const summary = book.addWorksheet("Summary");
  summary.addRow(["Sycamore RPC"]);
  summary.addRow(["Filtered attendance / roll export"]);
  summary.addRow(["Rows exported", rows.length]);
  if (rows[0] && "Total" in rows[0])
    summary.addRow([
      "Total attendance across services",
      rows.reduce((sum, row) => sum + Number(row.Total || 0), 0),
    ]);
  summary.addRow(["Membership categories reflect the current roll."]);
  summary.columns = [{ width: 48 }, { width: 20 }];
  for (const name of ["Detail", "Data"]) {
    const sheet = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const headers = Object.keys(rows[0] || {});
    sheet.columns = headers.map((key) => ({
      header: key,
      key,
      width: Math.max(16, Math.min(40, key.length + 10)),
    }));
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2F6B4F" },
    };
    if (headers.length)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rows.length + 1, column: headers.length },
      };
  }
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  if (window.desktop) await window.desktop.saveXlsx(Array.from(bytes));
  else
    download(
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "attendance.xlsx",
    );
}
