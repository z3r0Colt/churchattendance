import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("desktop", {
  openStaffSecurity: (id: string, challenge: string): Promise<void> => ipcRenderer.invoke("open-staff-security", id, challenge),
  setKioskMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("set-kiosk-mode", enabled),
  saveReportPdf: (title: string, html: string): Promise<boolean> =>
    ipcRenderer.invoke("save-report-pdf", title, html),
  previewPdf: (bytes: number[]): Promise<boolean> =>
    ipcRenderer.invoke("preview-pdf", bytes),
  saveCsv: (csv: string): Promise<boolean> =>
    ipcRenderer.invoke("save-csv", csv),
  saveXlsx: (
    bytes: number[],
    filename?: "sycamore-archive.xlsx",
  ): Promise<boolean> => ipcRenderer.invoke("save-xlsx", bytes, filename),
  printReport: (): Promise<boolean> => ipcRenderer.invoke("print-report"),
});
