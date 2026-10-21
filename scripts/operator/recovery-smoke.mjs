// Actual Firebase emulator recovery drill; uses only fictional projects and records.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { descriptor } from "./model.mjs";
import { firebaseDriver } from "./firebase.mjs";
import { captureBackup, readBackup } from "./artifacts.mjs";
import { restore } from "./recovery.mjs";
import { seal, unseal } from "../../functions/lib/recovery-encryption.js";
const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const { deleteApp } = require("firebase-admin/app");
const source = descriptor(JSON.parse(await readFile("config/deployments/cedar.example.json", "utf8")));
const target = descriptor({ ...source, churchId: "cedar-recovery", projectId: "demo-cedar-recovery", origin: "http://localhost:5274", storageBucket: "demo-cedar-recovery.appspot.com", backupBucket: "demo-cedar-recovery-backups", hostingSite: "demo-cedar-recovery", backupServiceAccount: "church-backup@demo-cedar-recovery.iam.gserviceaccount.com" });
const original = firebaseDriver(source), recovered = firebaseDriver(target);
const registry = { version: 1, allowedProjects: [source.projectId, target.projectId], churches: { [source.churchId]: { projectId: source.projectId, environment: source.environment, origin: source.origin, region: source.region } } };
let rules;
try {
  const ring = (await original.db.doc("operatorEmulator/secrets").get()).get("ring");
  if (!ring) throw new Error("Run emulator-smoke.mjs before the recovery drill");
  const { personInputSchema, householdInputSchema, toRoster } = await import("@sycamore/shared");
  const privatePath = "careNotes/fictional-recovery";
  const person = personInputSchema.parse({ firstName: "Fictional", lastName: "Recovery", householdId: "fictional-family", membershipStatus: "communicant" });
  await original.db.doc("people/fictional-recovery").set(person);
  await original.db.doc("attendanceRoster/fictional-recovery").set(toRoster("fictional-recovery", person, "Fictional Recovery Household"));
  await original.db.doc("people/fictional-recovery/membershipEvents/initial").set({ date: "2026-10-01", fromStatus: null, toStatus: "communicant", method: "initial" });
  await original.db.doc("households/fictional-family").set(householdInputSchema.parse({ name: "Fictional Recovery Household", address: "", homePhone: "" }));
  await original.db.doc("services/am_2026-11-01").set({ serviceTypeId: "am", date: "2026-11-01", notes: "", lastAttendancePersonId: "fictional-recovery", present: { "fictional-recovery": { method: "roll", mode: "inPerson" } } });
  await original.db.doc(privatePath).set({ personId: "fictional-recovery", encrypted: seal({ body: "Fictional Session recovery fixture" }, privatePath, ring) });
  await original.db.doc("mercyNotes/fictional-recovery").set({ householdId: "fictional-family", encrypted: seal({ body: "Fictional mercy recovery fixture" }, "mercyNotes/fictional-recovery", ring) });
  const photo = Buffer.from("fictional-photo-recovery-bytes");
  await original.storage.bucket().file("photos/fictional-recovery/current.png").save(photo, { resumable: false });
  let member = await original.auth.getUserByEmail("member-recovery@example.test").catch(() => null);
  if (!member) member = await original.auth.createUser({ email: "member-recovery@example.test", emailVerified: true });
  await original.db.doc(`users/${member.uid}`).set({ personId: "fictional-recovery" });
  async function documents(collection) {
    const rows = [];
    for (const row of (await collection.get()).docs) {
      rows.push({ path: row.ref.path, data: row.data() });
      for (const child of await row.ref.listCollections()) rows.push(...await documents(child));
    }
    return rows;
  }
  const objects = new Map();
  const adapter = {
    capture: async (part) => {
      if (part === "firestore") { const rows = []; for (const collection of await original.db.listCollections()) rows.push(...await documents(collection)); return rows; }
      if (part === "storage") { const [files] = await original.storage.bucket().getFiles(); return Promise.all(files.map(async (file) => ({ path: file.name, bytes: (await file.download())[0].toString("base64") }))); }
      if (part === "auth") return (await original.auth.listUsers()).users.map((user) => ({ uid: user.uid, email: user.email, emailVerified: user.emailVerified, customClaims: { roles: user.customClaims?.roles || [] } }));
      if (part === "keyRing") return ring;
      if (part === "configuration") return { firestoreRules: await readFile("firestore.rules", "utf8"), storageRules: await readFile("storage.rules", "utf8"), indexes: JSON.parse(await readFile("firestore.indexes.json", "utf8")) };
      throw new Error("Unknown backup component");
    },
    put: async (path, value) => objects.set(path, value),
    get: async (path) => objects.get(path),
  };
  const wrappingKey = randomBytes(32), save = async () => {};
  const manifest = await captureBackup({ config: source, adapter, wrappingKey, registry, save });
  const parts = await readBackup({ manifest, config: source, adapter, wrappingKey });
  const driver = {
    assertIsolated: async () => {
      assert.ok(target.projectId.startsWith("demo-")); assert.notEqual(target.projectId, source.projectId);
      if (rules) assert.equal(target.environment, "emulator");
    },
    run: async (step) => {
      if (step === "deny-public-access") rules = await initializeTestEnvironment({ projectId: target.projectId, firestore: { host: "127.0.0.1", port: 8080, rules: parts.configuration.firestoreRules }, storage: { host: "127.0.0.1", port: 9199, rules: parts.configuration.storageRules } });
      if (step === "restore-keys") await recovered.db.doc("operatorEmulator/recoveredKeys").set({ ring: parts.keyRing });
      if (step === "restore-firestore") {
        for (const row of parts.firestore) {
          // Never restore delivery queues, passkey sessions, challenges or grants into an active product.
          // This isolated target has no public Functions and applies deny-by-default rules first.
          if (!/^(?:deploymentIdentity|backupStatus|operatorEmulator)\//.test(row.path)) await recovered.db.doc(row.path).set(row.data);
        }
        await recovered.db.doc("communicationSettings/church").update({ emailEnabled: false, smsEnabled: false, bulletinEnabled: false });
      }
      if (step === "restore-storage") for (const file of parts.storage) await recovered.storage.bucket().file(file.path).save(Buffer.from(file.bytes, "base64"), { resumable: false });
      if (step === "restore-disabled-auth") {
        const result = await recovered.auth.importUsers(parts.auth.map((user) => ({ ...user, disabled: true, emailVerified: false })));
        assert.equal(result.failureCount, 0);
      }
    },
    verify: async (step) => {
      if (step === "validate-path-bound-encryption") {
        const restored = (await recovered.db.doc(privatePath).get()).get("encrypted");
        assert.equal(unseal(restored, privatePath, parts.keyRing).body, "Fictional Session recovery fixture");
        assert.throws(() => unseal(restored, "careNotes/wrong-path", parts.keyRing));
        assert.equal(unseal((await recovered.db.doc("mercyNotes/fictional-recovery").get()).get("encrypted"), "mercyNotes/fictional-recovery", parts.keyRing).body, "Fictional mercy recovery fixture");
      }
      if (step === "validate-history-photos-account-links") {
        assert.equal((await recovered.db.doc("people/fictional-recovery/membershipEvents/initial").get()).get("method"), "initial");
        assert.equal((await recovered.db.doc("services/am_2026-11-01").get()).get("present.fictional-recovery.mode"), "inPerson");
        const file = (await recovered.storage.bucket().file("photos/fictional-recovery/current.png").download())[0];
        assert.equal(createHash("sha256").update(file).digest("hex"), createHash("sha256").update(photo).digest("hex"));
        assert.equal((await recovered.auth.getUser(member.uid)).disabled, true);
        assert.equal((await recovered.db.doc(`users/${member.uid}`).get()).get("personId"), "fictional-recovery");
      }
      if (step === "validate-role-denials") {
        for (const role of ["admin", "deacon", "elder"]) {
          await recovered.db.doc(`staffAccess/fictional-${role}`).set({ enabled: true, roles: [role], validAfter: 0 });
          const db = rules.authenticatedContext(`fictional-${role}`, { roles: [role], email_verified: true, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_second_factor: "totp" } }).firestore();
          await assertSucceeds(getDoc(doc(db, "people/fictional-recovery")));
          await assertFails(getDoc(doc(db, privatePath))); await assertFails(getDoc(doc(db, "mercyNotes/fictional-recovery")));
        }
        assert.equal((await recovered.db.doc("communicationSettings/church").get()).get("emailEnabled"), false);
        assert.equal((await recovered.db.doc("communicationSettings/church").get()).get("smsEnabled"), false);
      }
      return true;
    },
  };
  const report = await restore({ source, target, manifest, registry, driver, save });
  console.log(JSON.stringify({ drill: "fictional-emulator", status: report.status, measuredRtoSeconds: report.measuredRtoSeconds, measuredRpoSeconds: report.measuredRpoSeconds, restored: ["history", "photos", "disabled-accounts", "private-path-bound-encryption", "role-denials"], delivery: "disabled" }));
} finally { await rules?.cleanup(); await Promise.all([deleteApp(original.app), deleteApp(recovered.app)]); }
