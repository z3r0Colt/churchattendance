import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { writePrivate } from "./registry.mjs";
import { validateBackup, recoveryParts } from "./recovery.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function binding(config, capturedAt, part) { return `${config.churchId}/${config.projectId}/${capturedAt}/${part}`; }
export function encryptArtifact(value, key, path) {
  if (key.length !== 32) throw new Error("Recovery wrapping key must contain 256 bits");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(path));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
}
export function decryptArtifact(bytes, key, path) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (value.version !== 1) throw new Error("Unknown recovery artifact version");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAAD(Buffer.from(path)); decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
// Adapter owns the storage/KMS credentials. No key material is written to the manifest or ordinary log.
export async function captureBackup({ config, adapter, wrappingKey, registry, save }) {
  const capturedAt = new Date().toISOString(), parts = {};
  const row = registry.churches[config.churchId];
  if (!row || row.projectId !== config.projectId) throw new Error("Reserve the church/project association before backup");
  row.backup = { status: "running", capturedAt }; await save(registry);
  try {
    for (const part of recoveryParts) {
      const data = await adapter.capture(part);
      const bytes = encryptArtifact(data, wrappingKey, binding(config, capturedAt, part));
      const object = `gs://${config.backupBucket}/${capturedAt}/${part}.encrypted.json`;
      await adapter.put(object, bytes);
      const verified = await adapter.get(object);
      if (sha(verified) !== sha(bytes)) throw new Error("Recovery object checksum mismatch");
      // Verify decryptability now, not only when a disaster occurs.
      decryptArtifact(verified, wrappingKey, binding(config, capturedAt, part));
      parts[part] = { object, sha256: sha(bytes), status: "verified" };
    }
    const manifest = validateBackup({ version: 1, churchId: config.churchId, projectId: config.projectId, capturedAt, parts }, config);
    row.backup = { status: "captured", capturedAt, components: recoveryParts }; await save(registry);
    return manifest;
  } catch {
    row.backup = { status: "failed", capturedAt }; await save(registry);
    throw new Error("Backup failed; prior verified backups and keys must be retained");
  }
}
export async function readBackup({ manifest, config, adapter, wrappingKey }) {
  validateBackup(manifest, config);
  const result = {};
  for (const part of recoveryParts) {
    const record = manifest.parts[part], bytes = await adapter.get(record.object);
    if (sha(bytes) !== record.sha256) throw new Error(`Corrupt recovery component: ${part}`);
    result[part] = decryptArtifact(bytes, wrappingKey, binding(config, manifest.capturedAt, part));
  }
  return result;
}
export async function writeDrillReport(path, report) {
  // Callers must supply only the fixed operational summary, never restored record contents.
  const { status, measuredRtoSeconds, measuredRpoSeconds, sourceProject, targetProject, backupAt, steps } = report;
  await writePrivate(path, { status, measuredRtoSeconds, measuredRpoSeconds, sourceProject, targetProject, backupAt, steps });
}
