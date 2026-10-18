import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { autoUpdater } from "electron-updater";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let window: BrowserWindow | null = null;
declare const __STAFF_AUTH_ORIGIN__: string;
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
  ipcMain.handle("open-staff-security", async (event, id: unknown, challenge: unknown) => {
    trusted(event);
    if (typeof id !== "string" || typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(challenge)) throw new Error("Invalid sign-in request");
    const origin = app.isPackaged ? __STAFF_AUTH_ORIGIN__ : "http://localhost:5174";
    const url = new URL("/staff-security", origin);
    if (app.isPackaged && (url.protocol !== "https:" || url.hostname.endsWith(".invalid"))) throw new Error("Configure the staff security origin before building the installer");
    url.hash = new URLSearchParams({ id, challenge }).toString();
    await shell.openExternal(url.href);
  });
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
  ipcMain.handle("set-kiosk-mode", (event, enabled: unknown) => {
    trusted(event);
    if (typeof enabled !== "boolean") throw new Error("Invalid kiosk mode");
    window!.setFullScreen(enabled);
  });
  ipcMain.handle("preview-pdf", async (event, value: unknown) => {
    trusted(event);
    if (
      !Array.isArray(value) ||
      value.length > 20 * 1024 * 1024 ||
      !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    )
      throw new Error("Invalid PDF");
    const bytes = new Uint8Array(value);
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
      throw new Error("Invalid PDF");
    const folder = await mkdtemp(path.join(tmpdir(), "sycamore-bulletin-"));
    const file = path.join(folder, "bulletin.pdf");
    await writeFile(file, bytes);
    const preview = new BrowserWindow({
      width: 900,
      height: 800,
      title: "Bulletin preview",
      webPreferences: {
        partition: `bulletin-preview-${randomUUID()}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        plugins: true,
      },
    });
    preview.removeMenu();
    preview.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    preview.webContents.session.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-navigate", (event) => event.preventDefault());
    const temporaryRoot = path.resolve(tmpdir());
    const resolvedFolder = path.resolve(folder);
    if (
      path.dirname(resolvedFolder) !== temporaryRoot ||
      !path.basename(resolvedFolder).startsWith("sycamore-bulletin-")
    )
      throw new Error("Invalid preview folder");
    preview.on("closed", () => {
      void rm(resolvedFolder, { recursive: true, force: true }).catch(() => {});
    });
    await preview.loadFile(file);
    return true;
  });
  ipcMain.handle(
    "save-report-pdf",
    async (event, title: unknown, html: unknown) => {
      trusted(event);
      if (
        typeof title !== "string" ||
        title.length > 150 ||
        typeof html !== "string" ||
        html.length > 20_000_000
      )
        throw new Error("Invalid report");
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: title.replace(/[^A-Za-z0-9-]/g, "-") + ".pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (result.canceled || !result.filePath) return false;
      const report = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: `report-${randomUUID()}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          javascript: false,
        },
      });
      report.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      report.webContents.on("will-navigate", (event) => event.preventDefault());
      report.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      report.webContents.session.webRequest.onBeforeRequest(
        {
          urls: [
            "http://*/*",
            "https://*/*",
            "ws://*/*",
            "wss://*/*",
            "file://*/*",
          ],
        },
        (_details, callback) => callback({ cancel: true }),
      );
      try {
        await report.loadURL(
          `data:text/html;base64,${Buffer.from(html).toString("base64")}`,
        );
        const bytes = await report.webContents.printToPDF({
          pageSize: "Letter",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate:
            '<div style="font-size:9px;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        });
        await writeFile(result.filePath, bytes);
      } finally {
        report.destroy();
      }
      return true;
    },
  );
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
  ipcMain.handle(
    "save-xlsx",
    async (event, value: unknown, filename: unknown) => {
      trusted(event);
      if (filename !== undefined && filename !== "sycamore-archive.xlsx")
        throw new Error("Invalid export name");
      if (
        !Array.isArray(value) ||
        value.length > 10_000_000 ||
        !value.every(
          (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
        )
      )
        throw new Error("Invalid export");
      const result = await dialog.showSaveDialog(window!, {
        defaultPath:
          filename === "sycamore-archive.xlsx" ? filename : "attendance.xlsx",
        filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, new Uint8Array(value));
      return true;
    },
  );
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
