import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
export async function readRegistry(path) {
  const mode = (await stat(path)).mode;
  if (process.platform !== "win32" && (mode & 0o077)) throw new Error("Registry must be private (chmod 600)");
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value.version !== 1 || !Array.isArray(value.allowedProjects) || !value.churches) throw new Error("Invalid operator registry");
  return value;
}
export async function writePrivate(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path); await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
}
export async function withRegistryLock(path, action) {
  const lock = `${resolve(path)}.lock`;
  let file;
  try { file = await open(lock, "wx", 0o600); }
  catch { throw new Error("Another operator holds this registry lock. After interruption, verify no operation is running before removing the stale .lock file."); }
  try { return await action(); }
  finally { await file.close(); await rm(lock, { force: true }); }
}
export function readiness(registry) {
  return Object.entries(registry.churches).map(([churchId, row]) => ({ churchId, projectId: row.projectId, environment: row.environment, origin: row.origin, release: row.release || null, checkpoints: row.checkpoints, providers: row.providers || { email: "disabled", sms: "disabled" }, backup: row.backup || { status: "unverified" }, subscription: row.subscription || { status: "unrecorded" } }));
}
