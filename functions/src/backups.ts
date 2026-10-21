import { createCipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { privateKeys } from "./security/encryption.js";
import { db } from "./admin.js";
import { emulatorMode } from "./communications/environment.js";
const bucketName = defineString("BACKUP_BUCKET", { default: "not-configured" });
const backupAccount = defineString("BACKUP_SERVICE_ACCOUNT", { default: "not-configured@not-configured.iam.gserviceaccount.com" });
const wrappingSecret = defineSecret("RECOVERY_WRAPPING_KEY");
// Dedicated backup identity: no ordinary app/API identity should read the backup bucket or wrapping key.
export const dailyRecoveryBackup = onSchedule({
  schedule: "0 4 * * *", timeZone: "Etc/UTC", region: "us-central1", timeoutSeconds: 540, memory: "512MiB",
  serviceAccount: backupAccount, secrets: [privateKeys, wrappingSecret], maxInstances: 1,
}, async () => {
  if (emulatorMode()) return; // The portable fictional drill is separate; never contact live services from emulators.
  const status = db.doc("backupStatus/daily");
  await status.set({ status: "running", startedAt: FieldValue.serverTimestamp() });
  try {
    const project = process.env.GCLOUD_PROJECT;
    const destination = bucketName.value();
    if (!project || destination === "not-configured") throw new Error("Backup configuration required");
    const key = Buffer.from(wrappingSecret.value(), "base64");
    if (key.length !== 32) throw new Error("Recovery wrapping key required");
    const backup = getStorage().bucket(destination);
    const [metadata] = await backup.getMetadata();
    if (!metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled || !metadata.encryption?.defaultKmsKeyName || !metadata.versioning?.enabled)
      throw new Error("Protected backup bucket configuration required");
    const capturedAt = new Date().toISOString(), prefix = `${project}/${capturedAt}`;
    const token = await applicationDefault().getAccessToken();
    const authorization = { Authorization: `Bearer ${token.access_token}` };
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/locations/us-central1/backups`, { headers: authorization, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Managed Firestore backup unavailable");
    const managed = await response.json() as { backups?: { name: string; state: string; snapshotTime: string }[] };
    const latest = managed.backups?.filter((row) => row.state === "READY").sort((a, b) => b.snapshotTime.localeCompare(a.snapshotTime))[0];
    if (!latest || Date.now() - Date.parse(latest.snapshotTime) > 30 * 3600000) throw new Error("Recent managed Firestore backup required");
    const files: { path: string; generation: string; object: string; crc32c: string }[] = [];
    const source = getStorage().bucket();
    // Bounded pages avoid buffering an entire congregation's photos and bulletin files.
    let pageToken: string | undefined;
    do {
      const [page, next] = await source.getFiles({ autoPaginate: false, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
      for (const file of page) {
        const [before] = await file.getMetadata();
        const object = `${prefix}/storage/${file.name}`;
        // Bind the copy to the captured source generation so replacement cannot silently mix content.
        const version = source.file(file.name, { generation: before.generation });
        await version.copy(backup.file(object), { preconditionOpts: { ifGenerationMatch: 0 } });
        const [copied] = await backup.file(object).getMetadata();
        if (!before.crc32c || copied.crc32c !== before.crc32c) throw new Error("Storage recovery checksum mismatch");
        files.push({ path: file.name, generation: String(before.generation), object, crc32c: before.crc32c });
      }
      pageToken = next?.pageToken;
    } while (pageToken);
    async function encrypted(name: string, value: unknown) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`${prefix}/${name}`));
      const content = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      const object = backup.file(`${prefix}/${name}.encrypted.json`);
      await object.save(JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: content.toString("base64") }), { resumable: false, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "application/json", cacheControl: "no-store" } });
    }
    let authPage: string | undefined, authPages = 0;
    do {
      const page = await getAuth().listUsers(500, authPage);
      if (page.users.some((user) => user.providerData.some((provider) => provider.providerId === "password") && !user.passwordHash)) throw new Error("Auth password recovery permission required");
      await encrypted(`auth-${authPages++}`, page.users.map((user) => user.toJSON()));
      authPage = page.pageToken;
    } while (authPage);
    // Hash configuration is necessary to recover password identities; never put it in a plaintext manifest.
    const hashResponse = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, { headers: authorization, signal: AbortSignal.timeout(30000) });
    if (!hashResponse.ok) throw new Error("Auth hash configuration recovery permission required");
    const authConfiguration = await hashResponse.json() as { signIn?: { hashConfig?: unknown } };
    if (!authConfiguration.signIn?.hashConfig) throw new Error("Auth hash recovery configuration unavailable");
    await encrypted("auth-hash-configuration", authConfiguration.signIn.hashConfig);
    await encrypted("key-ring", JSON.parse(privateKeys.value()));
    const configuration = JSON.parse(await readFile(new URL("../recovery-config.json", import.meta.url), "utf8"));
    await encrypted("configuration", configuration);
    await encrypted("manifest", { version: 1, project, capturedAt, completedAt: new Date().toISOString(), firestore: latest, authPages, files, configurationRelease: configuration.release });
    await status.set({ status: "captured", capturedAt, completedAt: FieldValue.serverTimestamp(), firestoreSnapshotAt: latest.snapshotTime, storageFiles: files.length, authPages, objectPrefix: prefix });
  } catch {
    await status.set({ status: "failed", failedAt: FieldValue.serverTimestamp(), code: "backup-verification-required" }, { merge: true });
    // Fixed text only. Raw provider responses, account details, private content and keys never enter logs.
    throw new Error("Daily recovery backup failed. Operator review required.");
  }
});
