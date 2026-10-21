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
  // Simulate interruption after Auth creation but before the approved bootstrap claims.
  const interrupted = await drivers[0].auth.getUserByEmail(configs[0].admin.email).catch(() => drivers[0].auth.createUser({ email: configs[0].admin.email }));
  for (const [index, config] of configs.entries()) {
    const driver = drivers[index];
    await runSetup({ config, registry, project: config.projectId, release: "a".repeat(40), driver, save: async () => {} });
    const keys = (await driver.db.doc("operatorEmulator/secrets").get()).get("ring");
    const user = await driver.auth.getUserByEmail(config.admin.email);
    if (index === 0) assert.equal(user.uid, interrupted.uid);
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
    const user = await drivers[index].auth.getUserByEmail(config.admin.email);
    const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    // Auth emulator fixtures are unsigned. The actual Admin verifier still binds audience and issuer.
    // These fixtures must never be used or accepted outside the emulator-only driver boundary.
    const token = `${part({ alg: "none", typ: "JWT" })}.${part({ aud: config.projectId, iss: `https://securetoken.google.com/${config.projectId}`, sub: user.uid, user_id: user.uid, iat: now, exp: now + 3600, auth_time: now, email_verified: true, roles: ["admin", "pastor"], firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } })}.`;
    assert.equal((await drivers[index].auth.verifyIdToken(token)).uid, user.uid);
    await assert.rejects(drivers[1 - index].auth.verifyIdToken(token));
    const response = await fetch("http://127.0.0.1:5001/demo-sycamore/us-central1/staffSecurityStatus", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: {} }), signal: AbortSignal.timeout(10000) });
    assert.ok(response.status === 401 || response.status === 403, "Foreign-project token must not enter another project's callable");

    assert.equal((await drivers[index].db.doc("publicBranding/church").get()).get("churchId"), config.churchId);
  }
  console.log("Two fictional churches provisioned independently; idempotent users, empty records, separate keys, delivery disabled.");
} finally { await Promise.all(drivers.map(async (driver) => { await driver.db.terminate(); await deleteApp(driver.app); })); }
