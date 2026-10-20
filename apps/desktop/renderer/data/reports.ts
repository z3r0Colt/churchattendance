import { currentBranding } from "../branding";
import { brandPalettes, brandingFilename } from "@sycamore/shared";
import type { ReportRow } from "@sycamore/shared";
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  LineController,
  LineElement,
  PointElement,
} from "chart.js";
import { directoryPhoto } from "./chms";
import { native } from "../platform";
Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  LineController,
  LineElement,
  PointElement,
);
export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function reportChart(
  labels: string[],
  values: (number | null)[],
  canvas?: HTMLCanvasElement,
  label = "Average attendance",
  kind: "bar" | "line" = "bar",
) {
  const element = canvas || document.createElement("canvas");
  element.width = 900;
  element.height = 280;
  const chart = new Chart(element, {
    type: kind,
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: brandPalettes[currentBranding().palette].light,
          borderColor: brandPalettes[currentBranding().palette].light,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: "#5B625E" } },
        x: { ticks: { color: "#5B625E" } },
      },
    },
  });
  const png = chart.toBase64Image();
  chart.destroy();
  return png;
}
export function reportTable(rows: ReportRow[]) {
  const columns = Object.keys(rows[0] || {});
  return `<table><thead><tr>${columns.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
export function reportHtml(title: string, period: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>@page{size:letter;margin:0.45in}body{font:11px 'Segoe UI',sans-serif;color:#1f2321}h1{font-size:20px}h2{font-size:14px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{text-align:left;padding:5px;border-bottom:1px solid #dadfdc;vertical-align:top}th{background:#eef3ef}thead{display:table-header-group}tr,.directory-family{break-inside:avoid}.chart{width:100%;height:170px;object-fit:contain}.directory{display:grid;grid-template-columns:1fr 1fr;gap:16px}.directory-family{border:1px solid #dadfdc;padding:12px}.portrait{width:60px;height:75px;object-fit:cover;float:right;margin:0 0 6px 8px}footer{font-size:10px;color:#5b625e}.page-break{break-before:page}</style></head><body>${currentBranding().logo ? `<img src="${escapeHtml(currentBranding().logo)}" alt="" width="48" height="48" style="object-fit:contain" />` : ""}<strong>${escapeHtml(currentBranding().churchName)}</strong><h1>${escapeHtml(title)}</h1><p>${escapeHtml(period)}</p>${content}<footer>Church records · Review the source data before distribution.</footer></body></html>`;
}
export async function savePdf(title: string, html: string) {
  if (native) return native.saveReportPdf(title, html);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const popup = window.open(url, "_blank");
  if (!popup)
    throw new Error(
      "Allow the report window to open, then use Print to save a PDF.",
    );
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
export async function exportReportWorkbook(
  title: string,
  summary: ReportRow[],
  detail: ReportRow[],
  data: ReportRow[],
  chart = "",
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = currentBranding().churchName;
  for (const [name, rows] of [
    ["Summary", summary],
    ["Detail", detail],
    ["Data", data],
  ] as const) {
    const sheet = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 3 }],
    });
    sheet.addRow([currentBranding().churchName, title]);
    sheet.addRow([]);
    const keys = Object.keys(rows[0] || {});
    sheet.addRow(keys);
    sheet.columns = keys.map(() => ({ width: 28 }));
    sheet.getRow(3).font = { bold: true };
    for (const row of rows) {
      const added = sheet.addRow(keys.map((key) => row[key]));
      added.eachCell((cell) => {
        if (typeof cell.value === "string" && /^[=+@-]/.test(cell.value))
          cell.value = "'" + cell.value;
      });
    }
    if (name === "Summary" && chart) {
      const image = book.addImage({ base64: chart, extension: "png" });
      sheet.addImage(image, {
        tl: { col: 0, row: rows.length + 5 },
        ext: { width: 700, height: 220 },
      });
    }
  }
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  if (native) await native.saveXlsx(Array.from(bytes));
  else {
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${brandingFilename(currentBranding().appName)}-${brandingFilename(title)}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function photoData(path: string | undefined) {
  if (!path) return "";
  return directoryPhoto(path);
}
