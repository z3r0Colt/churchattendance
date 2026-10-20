import Papa from "papaparse";
import { DateTime } from "luxon";
import {
  importProcessSchema,
  importStartSchema,
  type ImportDecision,
  type ImportValue,
  type PreviewRow,
} from "@sycamore/shared";
import { chmsCall, useCollection } from "./chms";

export type ImportPreview = {
  rows: PreviewRow[];
  people: Record<
    string,
    {
      name: string;
      preferredName: string;
      email: string;
      mobilePhone: string;
      birthDate: string;
    }
  >;
};
// Reads cell text only. Excel formulas are never evaluated; they arrive marked so the preview refuses them.
export async function readImportFile(file: File) {
  let table: string[][];
  if (file.name.toLowerCase().endsWith(".csv")) {
    const parsed = Papa.parse<string[]>(await file.text(), {
      skipEmptyLines: "greedy",
    });
    table = parsed.data.map((row) => row.map((cell) => String(cell ?? "")));
  } else if (file.name.toLowerCase().endsWith(".xlsx")) {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error("The workbook has no sheets.");
    table = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = row.getCell(column);
        const value = cell.value;
        cells.push(
          cell.formula ||
            (value && typeof value === "object" && "formula" in value)
            ? `=${cell.formula || "formula"}`
            : value instanceof Date
              ? DateTime.fromJSDate(value, { zone: "utc" }).toISODate()!
              : cell.text,
        );
      }
      table.push(cells);
    });
  } else throw new Error("Choose a .csv or .xlsx file.");
  const [headers = [], ...rows] = table;
  return {
    headers: headers.map((cell) => cell.trim()),
    rows: rows.filter((row) => row.some((cell) => cell.trim())),
  };
}
export const previewPeopleImport = (value: unknown) =>
  chmsCall<ImportPreview>("previewPeopleImport", value);
// Starts a batch (or resumes one) and applies its rows in small calls until none are waiting.
export async function runPeopleImport(
  input: unknown,
  progress: (left: number) => void,
) {
  const batchId =
    typeof input === "string"
      ? input
      : (
          await chmsCall<{ batchId: string }>(
            "startPeopleImport",
            importStartSchema.parse(input),
          )
        ).batchId;
  for (;;) {
    const { remaining } = await chmsCall<{ remaining: number }>(
      "processPeopleImport",
      importProcessSchema.parse({ batchId }),
    );
    progress(remaining);
    if (remaining < 0 || !Number.isInteger(remaining))
      throw new Error(
        "This import needs a count review before it can continue.",
      );
    if (remaining === 0) return batchId;
  }
}
type Moment = { toDate?: () => Date } | undefined;
export type ImportBatch = {
  id: string;
  fileName: string;
  createdAt: string;
  total: number;
  pending: number;
  created: number;
  updated: number;
  skipped: number;
  conflict: number;
  failed: number;
};
export function useImportBatches() {
  const batches = useCollection<
    Omit<ImportBatch, "createdAt"> & { createdAt: Moment }
  >("importBatches");
  return {
    rows: batches.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt?.toDate?.().toISOString() ?? "",
    })) as ImportBatch[],
    error: batches.error,
  };
}
export type ImportRowRecord = {
  id: string;
  row: number;
  value: ImportValue | null;
  decision: ImportDecision;
  outcome: string;
  personId: string;
  message: string;
};
export const useImportRows = (batchId: string) =>
  useCollection<ImportRowRecord>(batchId ? `importBatches/${batchId}/rows` : "")
    .rows;
