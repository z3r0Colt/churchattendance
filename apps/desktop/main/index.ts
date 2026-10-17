import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { autoUpdater } from "electron-updater";
import { writeFile } from "node:fs/promises";
import path from "node:path";

let window: BrowserWindow | null = null;
function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Untrusted caller");
}
app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#1B1D1C",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      const connect = app.isPackaged
        ? "https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app https://*.appspot.com https://*.firebasestorage.app"
        : "http://127.0.0.1:* ws://127.0.0.1:* https://*.googleapis.com";
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${connect}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          ],
        },
      });
    },
  );
  ipcMain.handle("save-csv", async (event, value: unknown) => {
    trusted(event);
    if (typeof value !== "string" || value.length > 10_000_000)
      throw new Error("Invalid export");
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: "attendance.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, "\uFEFF" + value, "utf8");
    return true;
  });
  ipcMain.handle("print-report", async (event) => {
    trusted(event);
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: "attendance.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const buffer = await window!.webContents.printToPDF({
      pageSize: "Letter",
      printBackground: true,
    });
    await writeFile(result.filePath, buffer);
    return true;
  });
  ipcMain.handle("save-xlsx", async (event, value: unknown) => {
    trusted(event);
    if (
      !Array.isArray(value) ||
      value.length > 10_000_000 ||
      !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    )
      throw new Error("Invalid export");
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: "attendance.xlsx",
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, new Uint8Array(value));
    return true;
  });
  if (app.isPackaged) {
    await window.loadFile(path.join(__dirname, "renderer/index.html"));
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((error) => console.error("Update check failed", error.message));
  } else if (process.env.SYCAMORE_DEV === "1")
    await window.loadURL("http://127.0.0.1:5173");
  else await window.loadFile(path.join(__dirname, "renderer/index.html"));
});
app.on("window-all-closed", () => app.quit());
