import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("desktop", {
  previewPdf: (bytes: number[]): Promise<boolean> =>
    ipcRenderer.invoke("preview-pdf", bytes),
  saveCsv: (csv: string): Promise<boolean> =>
    ipcRenderer.invoke("save-csv", csv),
  saveXlsx: (bytes: number[]): Promise<boolean> =>
    ipcRenderer.invoke("save-xlsx", bytes),
  printReport: (): Promise<boolean> => ipcRenderer.invoke("print-report"),
});
