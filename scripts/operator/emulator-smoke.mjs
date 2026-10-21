// Runs only inside the emulator suite, using two empty fictional projects. Never accepts live project names.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { descriptor, runSetup } from "./model.mjs";
import { firebaseDriver } from "./firebase.mjs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const { deleteApp } = require("firebase-admin/app");
const configs = await Promise.all(["cedar", "harbor"].map(async (name) => descriptor(JSON.parse(await readFile(`config/deployments/${name}.example.json`, "utf8")))));
const registry = { version: 1, allowedProjects: configs.map((config) => config.projectId), churches: {} };
const drivers = configs.map((config) => firebaseDriver(config, { attestations: { deployedRelease: "a".repeat(40) } }));
try {
  for (const [index, config] of configs.entries()) {
    const driver = drivers[index];
    await runSetup({ config, registry, project: config.projectId, release: "a".repeat(40), driver, save: async () => {} });
    const keys = (await driver.db.doc("operatorEmulator/secrets").get()).get("ring");
    const user = await driver.auth.getUserByEmail(config.admin.email);
    assert.deepEqual(user.customClaims.roles, ["admin"]);
    assert.equal(user.emailVerified, false);
    assert.equal(user.passwordHash, undefined);
    assert.equal((await driver.db.collection("people").get()).empty, true);
    await runSetup({ config, registry, project: config.projectId, release: "a".repeat(40), driver, save: async () => {} });
    assert.equal((await driver.auth.getUserByEmail(config.admin.email)).uid, user.uid);
    assert.deepEqual((await driver.db.doc("operatorEmulator/secrets").get()).get("ring"), keys);
  }
  assert.notDeepEqual((await drivers[0].db.doc("operatorEmulator/secrets").get()).get("ring"), (await drivers[1].db.doc("operatorEmulator/secrets").get()).get("ring"));
  for (const [index, config] of configs.entries()) {
    await assert.rejects(drivers[1 - index].auth.getUserByEmail(config.admin.email), (error) => error.code === "auth/user-not-found");
    assert.equal((await drivers[index].db.doc("publicBranding/church").get()).get("churchId"), config.churchId);
  }
  console.log("Two fictional churches provisioned independently; idempotent users, empty records, separate keys, delivery disabled.");
} finally { await Promise.all(drivers.map((driver) => deleteApp(driver.app))); }
