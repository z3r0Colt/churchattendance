import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("desktop", {
  saveCsv: (csv: string): Promise<boolean> =>
    ipcRenderer.invoke("save-csv", csv),
  saveXlsx: (bytes: number[]): Promise<boolean> =>
    ipcRenderer.invoke("save-xlsx", bytes),
  printReport: (): Promise<boolean> => ipcRenderer.invoke("print-report"),
});
