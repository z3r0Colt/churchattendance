import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptor, assertTarget, setupPlan, runSetup } from "../operator/model.mjs";
import { writePrivate, readRegistry, withRegistryLock } from "../operator/registry.mjs";
import { releasePlan, deployRelease, supportEvent } from "../operator/releases.mjs";
import { recoveryParts, recoveryPlan, restore } from "../operator/recovery.mjs";
const cedar = descriptor(JSON.parse(await readFile("config/deployments/cedar.example.json", "utf8")));
const harbor = descriptor(JSON.parse(await readFile("config/deployments/harbor.example.json", "utf8")));
const release = "a".repeat(40), previous = "b".repeat(40);
const registry = () => ({ version: 1, allowedProjects: [cedar.projectId, harbor.projectId], churches: {}, releases: {} });
test("rejects demo/live mixing, implicit targets, project reuse, domain migration and secrets in descriptors", () => {
  assert.throws(() => descriptor({ ...cedar, environment: "live" }), /mismatch/);
  assert.throws(() => descriptor({ ...cedar, secret: "never-store-this" }), /fields/);
  assert.throws(() => assertTarget(cedar, registry()), /exact allowlisted/);
  const r = registry(); r.churches[harbor.churchId] = { projectId: cedar.projectId };
  assert.throws(() => assertTarget(cedar, r, cedar.projectId), /immutable/);
  r.churches = { [cedar.churchId]: { ...cedar, origin: "https://changed.example" } };
  assert.throws(() => assertTarget(cedar, r, cedar.projectId), /migration/);
});
test("dry-run is pure and does not include credentials, users, records or secret values", () => {
  const r = registry(), before = structuredClone(r);
  const plan = setupPlan(cedar, release);
  assert.equal(plan.length, 10); assert.deepEqual(r, before);
  assert.equal(JSON.stringify(plan).includes(cedar.admin.email), false);
  assert.throws(() => setupPlan(cedar, "main"), /full Git commit/);
});
test("interrupted setup preserves completed work, retries safely, isolates churches, and keeps DNS failure visible", async () => {
  const r = registry(), resources = new Map(), writes = [];
  let interrupted = true;
  const driver = {
    verify: async (step, config) => ({ ready: resources.has(`${config.projectId}:${step}`), code: "pending-dns" }),
    apply: async (step, config) => {
      if (step === "defaults" && interrupted) { interrupted = false; throw new Error("Secret provider body must not enter registry"); }
      resources.set(`${config.projectId}:${step}`, true); writes.push(`${config.projectId}:${step}`);
    },
  };
  const save = async () => {};
  await assert.rejects(runSetup({ config: cedar, registry: r, project: cedar.projectId, release, driver, save }), /defaults/);
  assert.equal(r.churches[cedar.churchId].checkpoints.defaults.status, "failed");
  assert.equal(JSON.stringify(r).includes("Secret provider body"), false);
  await runSetup({ config: cedar, registry: r, project: cedar.projectId, release, driver, save });
  const count = writes.length;
  await runSetup({ config: cedar, registry: r, project: cedar.projectId, release, driver, save });
  assert.equal(writes.length, count);
  await runSetup({ config: harbor, registry: r, project: harbor.projectId, release, driver, save });
  assert.equal(r.churches[cedar.churchId].release, release);
  assert.notEqual(r.churches[cedar.churchId].projectId, r.churches[harbor.churchId].projectId);
  resources.delete(`${harbor.projectId}:domains`);
  const pending = await runSetup({ config: harbor, registry: r, project: harbor.projectId, release, driver, save, verifyOnly: true });
  assert.deepEqual(pending, { ready: false, step: "domains" });
});
test("registry is private, atomically persisted, and rejects concurrent writers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "church-operator-test-")), file = join(dir, "registry.json");
  try {
    await writePrivate(file, registry()); assert.equal((await readRegistry(file)).version, 1);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o077, 0);
    await withRegistryLock(file, async () => { await assert.rejects(withRegistryLock(file, async () => {}), /Another operator/); });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("selected release and compatible rollback change church A only; partial deployments remain visible", async () => {
  const r = registry();
  r.churches[cedar.churchId] = { ...cedar, schema: 1, release: previous };
  r.churches[harbor.churchId] = { ...harbor, schema: 1, release: previous };
  const other = structuredClone(r.churches[harbor.churchId]);
  r.releases[release] = { schema: 1, readsFromSchema: 1, ciPassed: true, rollbackCompatible: true };
  r.releases[previous] = { ...r.releases[release] };
  const calls = [], driver = { deploy: async (plan) => calls.push(plan), verify: async () => true }, save = async () => {};
  await deployRelease({ config: cedar, registry: r, project: cedar.projectId, release, driver, save });
  assert.deepEqual(calls[0].components, ["firestore:rules", "firestore:indexes", "storage", "functions", "hosting:portal"]);
  assert.deepEqual(r.churches[harbor.churchId], other);
  await deployRelease({ config: cedar, registry: r, project: cedar.projectId, release: previous, driver, save, rollback: true });
  assert.equal(r.churches[cedar.churchId].release, previous);
  r.releases[release].schema = 0;
  assert.throws(() => releasePlan({ config: cedar, registry: r, project: cedar.projectId, release }), /validated release|incompatible/);
  r.releases[release].schema = 1;
  await assert.rejects(deployRelease({ config: cedar, registry: r, project: cedar.projectId, release, driver: { deploy: async () => { throw new Error("private narrative"); } }, save }), /Partial release/);
  assert.equal(r.churches[cedar.churchId].deployment.status, "partial");
  assert.equal(JSON.stringify(r).includes("private narrative"), false);
  assert.deepEqual(r.churches[harbor.churchId], other);
});
test("recovery cannot overwrite a production church; failures stay isolated and measurements follow verification", async () => {
  const r = registry(); r.churches[cedar.churchId] = { ...cedar };
  const target = descriptor({ ...harbor, churchId: "cedar-recovery", projectId: "cedar-recovery-test", environment: "recovery", backupServiceAccount: "church-backup@cedar-recovery-test.iam.gserviceaccount.com", origin: "https://cedar-recovery.example.test", authDomains: ["cedar-recovery.example.test", harbor.firebase.authDomain] });
  r.allowedProjects.push(target.projectId);
  const manifest = { version: 1, churchId: cedar.churchId, projectId: cedar.projectId, capturedAt: new Date(Date.now() - 10000).toISOString(), parts: Object.fromEntries(recoveryParts.map((part) => [part, { status: "verified", object: `gs://${cedar.backupBucket}/fictional/${part}`, sha256: "c".repeat(64) }])) };
  assert.throws(() => recoveryPlan(cedar, cedar, manifest, r), /isolated/);
  const calls = [], driver = { assertIsolated: async () => calls.push("isolation"), run: async (step) => calls.push(step), verify: async () => true };
  const result = await restore({ source: cedar, target, manifest, registry: r, driver, save: async () => {} });
  assert.equal(result.status, "verified"); assert.ok(result.measuredRpoSeconds >= 10);
  assert.equal(calls.filter((step) => step === "isolation").length, 10);
  assert.equal(r.churches[cedar.churchId].backup.status, "drill-verified");
  driver.verify = async () => false;
  await assert.rejects(restore({ source: cedar, target, manifest, registry: r, driver, save: async () => {} }), /stays isolated/);
  assert.equal(Object.values(r.recoveries)[0].status, "failed");
});
test("support audit accepts fixed actions and identifiers, never arbitrary narratives or tokens", () => {
  assert.throws(() => supportEvent({ operator: "operator@example.test", churchId: cedar.churchId, action: "read private note", ticket: "case-1" }), /fixed action/);
  assert.deepEqual(Object.keys(supportEvent({ operator: "operator@example.test", churchId: cedar.churchId, action: "readiness", ticket: "case-1" })), ["operator", "churchId", "action", "ticket", "at"]);
});

test("encrypted recovery artifacts restore files, accounts, configuration and key rings; corruption fails visibly", async () => {
  const { captureBackup, readBackup, decryptArtifact } = await import("../operator/artifacts.mjs");
  const { randomBytes } = await import("node:crypto");
  const r = registry(); r.churches[cedar.churchId] = { ...cedar };
  const key = randomBytes(32), ring = { active: "v1", keys: { v1: randomBytes(32).toString("base64") } };
  const fictional = {
    firestore: [{ path: "people/fictional", data: { firstName: "Fictional", membershipStatus: "communicant" } }, { path: "services/am_2026-11-01", data: { present: { fictional: { method: "roll" } } } }],
    storage: [{ path: "photos/fictional/current.png", bytes: Buffer.from("fictional-photo-bytes").toString("base64") }],
    auth: [{ uid: "fictional-account", linkedPersonId: "fictional", disabled: false }],
    configuration: { rules: "deny by default; Session API only", indexes: [{ collectionGroup: "services", field: "date" }] },
    keyRing: ring,
  };
  const objects = new Map(), adapter = { capture: async (part) => structuredClone(fictional[part]), put: async (path, bytes) => objects.set(path, Buffer.from(bytes)), get: async (path) => objects.get(path) };
  const manifest = await captureBackup({ config: cedar, adapter, wrappingKey: key, registry: r, save: async () => {} });
  assert.equal(JSON.stringify(manifest).includes(ring.keys.v1), false);
  assert.equal([...objects.values()].some((bytes) => bytes.includes(Buffer.from("fictional-photo-bytes"))), false);
  const restored = await readBackup({ manifest, config: cedar, adapter, wrappingKey: key });
  assert.deepEqual(restored, fictional);
  assert.equal(Buffer.from(restored.storage[0].bytes, "base64").toString(), "fictional-photo-bytes");
  assert.equal(restored.auth[0].linkedPersonId, restored.firestore[0].path.split("/")[1]);
  await assert.rejects(readBackup({ manifest, config: cedar, adapter, wrappingKey: randomBytes(32) }));
  assert.throws(() => decryptArtifact(objects.values().next().value, key, "another-church/path"));
  objects.get(manifest.parts.auth.object)[20] ^= 1;
  await assert.rejects(readBackup({ manifest, config: cedar, adapter, wrappingKey: key }), /Corrupt recovery component/);
});
