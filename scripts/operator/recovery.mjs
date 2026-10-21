import { createHash } from "node:crypto";
import { assertTarget } from "./model.mjs";
export const recoveryParts = ["firestore", "storage", "auth", "configuration", "keyRing"];
export function validateBackup(manifest, config) {
  if (Object.keys(manifest).some((key) => !["version", "churchId", "projectId", "capturedAt", "parts"].includes(key))) throw new Error("Unknown backup manifest fields");
  if (manifest.version !== 1 || manifest.churchId !== config.churchId || manifest.projectId !== config.projectId || !Number.isFinite(Date.parse(manifest.capturedAt))) throw new Error("Backup identity or timestamp mismatch");
  for (const part of recoveryParts) {
    const value = manifest.parts?.[part];
    if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !value.object || !value.object.startsWith(`gs://${config.backupBucket}/`) || value.status !== "verified") throw new Error(`Incomplete recovery component: ${part}`);
    if (Object.keys(value).some((key) => !["object", "sha256", "status", "generation"].includes(key))) throw new Error("Recovery manifest contains forbidden fields");
  }
  return manifest;
}
export function recoveryPlan(source, target, manifest, registry) {
  assertTarget(source, registry, source.projectId);
  assertTarget(target, registry, target.projectId);
  validateBackup(manifest, source);
  if (!(target.environment === "recovery" || (source.environment === "emulator" && target.environment === "emulator")) || target.projectId === source.projectId || target.churchId === source.churchId || target.origin === source.origin) throw new Error("Restore requires a distinct isolated recovery descriptor and origin");
  return ["deny-public-access", "verify-no-functions-or-jobs", "restore-keys", "restore-firestore", "restore-storage", "restore-disabled-auth", "validate-path-bound-encryption", "validate-history-photos-account-links", "validate-role-denials", "record-recovery-measurements"];
}
export async function restore({ source, target, manifest, registry, driver, save }) {
  const steps = recoveryPlan(source, target, manifest, registry);
  const started = Date.now();
  const record = { sourceProject: source.projectId, targetProject: target.projectId, backupAt: manifest.capturedAt, status: "running", steps: {} };
  const key = createHash("sha256").update(`${source.projectId}:${target.projectId}:${manifest.capturedAt}`).digest("hex");
  registry.recoveries ||= {}; registry.recoveries[key] = record;
  await save(registry);
  try {
    for (const step of steps) {
      // Restore adapter must verify isolation again before EACH import. No side effects replayed.
      await driver.assertIsolated(target);
      await driver.run(step, { source, target, manifest });
      if (!(await driver.verify(step, { source, target, manifest }))) throw new Error("Recovery verification failed");
      record.steps[step] = "verified"; await save(registry);
    }
    record.status = "verified";
    record.measuredRtoSeconds = Math.ceil((Date.now() - started) / 1000);
    record.measuredRpoSeconds = Math.max(0, Math.ceil((started - Date.parse(manifest.capturedAt)) / 1000));
    registry.churches[source.churchId].backup = { status: "drill-verified", capturedAt: manifest.capturedAt, verifiedAt: new Date().toISOString(), recoveryId: key, measuredRtoSeconds: record.measuredRtoSeconds, measuredRpoSeconds: record.measuredRpoSeconds };
  } catch {
    record.status = "failed";
    throw new Error("Recovery failed. Target stays isolated and delivery remains disabled. See registry checkpoints.");
  } finally { await save(registry); }
  return record;
}
