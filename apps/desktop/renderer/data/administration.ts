import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import {
  archiveJsonParts,
  addPersonSchema,
  exportPageSchema,
  hasRole,
  privateExportCollections,
  publicExportCollections,
  SESSION_ROLES,
  type ChurchSettings,
  type ExportCollection,
  type ExportPage,
  type Role,
} from "@sycamore/shared";
import { db } from "./firebase";
import { chmsCall } from "./chms";
export function useChurchSettings() {
  const [value, setValue] = useState<ChurchSettings | null>(null),
    [error, setError] = useState("");
  useEffect(
    () =>
      onSnapshot(
        doc(db, "settings/church"),
        (row) =>
          setValue({
            name: row.get("name") || "Sycamore RPC",
            address: row.get("address") || "",
            timeZone: row.get("timeZone") || "America/Indiana/Indianapolis",
            revision: row.get("revision") || 0,
          }),
        () => setError("Church settings could not be loaded."),
      ),
    [],
  );
  return { value, error };
}
export const addPerson = (input: unknown) =>
  chmsCall<{ id: string }>("addPerson", addPersonSchema.parse(input));
export async function exportAdministration(
  roles: Role[],
  progress: (value: string) => void,
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook(),
    started = new Date().toISOString();
  const summary = book.addWorksheet("Summary");
  const session = hasRole(roles, SESSION_ROLES);
  summary.addRows([
    ["Sycamore RPC administrative archive", "Format 1"],
    ["Started UTC", started],
    [
      "Scope",
      session ? "Administrative and Session records" : "Administrative records",
    ],
    [
      "Consistency",
      "Each page is read live. Pause editing during export. This is not an atomic snapshot.",
    ],
    [
      "Contents",
      "Document paths and JSON chunks. Timestamps retain seconds and nanoseconds.",
    ],
    [
      "Excluded",
      "Storage files, delivery queue and bulletin records, secret configuration, capabilities, suppressions and operational budgets.",
    ],
    [
      "Recovery",
      "This workbook is an inspectable archive. Use managed Firestore backups for recovery.",
    ],
    ...(!session
      ? [
          [
            "Session records",
            "Excluded. A Session administrator must export these records.",
          ],
        ]
      : []),
    ["Collection", "Documents"],
  ]);
  summary.columns = [{ width: 34 }, { width: 110 }];
  const names: readonly ExportCollection[] = session
    ? [...publicExportCollections, ...privateExportCollections]
    : publicExportCollections;
  let bytes = 0;
  for (const name of names) {
    progress(`Exporting ${name}`);
    const sheet = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Document path", key: "path", width: 55 },
      { header: "Part", key: "part", width: 10 },
      { header: "JSON", key: "json", width: 110 },
    ];
    let after = "",
      count = 0;
    do {
      const page = await chmsCall<ExportPage>(
        "exportDataPage",
        exportPageSchema.parse({ collection: name, after }),
      );
      for (const row of page.rows) {
        const json = JSON.stringify(row.data);
        bytes += json.length * 2;
        if (bytes > 80_000_000)
          throw new Error(
            "This archive is too large for a desktop workbook. Ask an administrator for a managed export.",
          );
        for (const [index, part] of archiveJsonParts(json).entries())
          sheet.addRow({
            path: row.path,
            part: index + 1,
            json: part,
          });
        count++;
      }
      after = page.next;
    } while (after);
    summary.addRow([name, count]);
  }
  summary.addRow(["Completed UTC", new Date().toISOString()]);
  const buffer = new Uint8Array(await book.xlsx.writeBuffer());
  if (buffer.byteLength > 10_000_000)
    throw new Error(
      "The archive exceeds the 10 MB desktop save limit. Ask an administrator for a managed export.",
    );
  if (window.desktop)
    return window.desktop.saveXlsx(Array.from(buffer), "sycamore-archive.xlsx");
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `sycamore-archive-${started.slice(0, 10)}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
