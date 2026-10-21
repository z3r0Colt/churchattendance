import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { descriptor, assertTarget, setupPlan, runSetup } from "./model.mjs";
import { readRegistry, writePrivate, withRegistryLock, readiness } from "./registry.mjs";
import { releasePlan, deployRelease, supportEvent } from "./releases.mjs";
import { recoveryPlan } from "./recovery.mjs";
const [command, ...args] = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  if (!/^--[a-z-]+$/.test(key) || !args[index + 1] || args[index + 1].startsWith("--") || options[key]) throw new Error("Use unique --option value pairs");
  options[key] = args[index + 1];
}
const known = ["--registry", "--descriptor", "--project", "--release", "--operator", "--ticket", "--target", "--manifest"];
if (Object.keys(options).some((key) => !known.includes(key))) throw new Error("Unknown operator option");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
try {
  if (!options["--registry"]) throw new Error("Select a private registry with --registry");
  const path = resolve(options["--registry"]);
  const registry = await readRegistry(path);
  if (command === "status") console.log(JSON.stringify(readiness(registry), null, 2));
  else {
    if (!options["--descriptor"]) throw new Error("Select a validated --descriptor");
    const config = descriptor(await json(options["--descriptor"]));
    const project = options["--project"], release = options["--release"];
    assertTarget(config, registry, project);
    if (command === "plan") console.log(JSON.stringify(setupPlan(config, release), null, 2));
    else if (command === "release-plan" || command === "rollback-plan") console.log(JSON.stringify(releasePlan({ config, registry, project, release, rollback: command === "rollback-plan" }), null, 2));
    else if (command === "recovery-plan") {
      const target = descriptor(await json(options["--target"]));
      console.log(JSON.stringify(recoveryPlan(config, target, await json(options["--manifest"]), registry), null, 2));
    } else if (command === "apply" || command === "verify" || command === "deploy" || command === "rollback") {
      if (!options["--operator"] || !options["--ticket"]) throw new Error("Name the infrastructure operator and support/change ticket");
      await withRegistryLock(path, async () => {
        // Re-read after locking so two operators cannot overwrite each other's state.
        const current = await readRegistry(path); assertTarget(config, current, project);
        current.audit ||= []; current.audit.push(supportEvent({ operator: options["--operator"], churchId: config.churchId, action: command === "apply" || command === "verify" ? "readiness" : "deploy", ticket: options["--ticket"] }));
        const save = (value) => writePrivate(path, value); await save(current);
        if (command === "deploy" || command === "rollback") {
          const { deploymentDriver } = await import("./deploy.mjs");
          await deployRelease({ config, registry: current, project, release, driver: deploymentDriver(), save, rollback: command === "rollback" });
        } else {
          const { firebaseDriver } = await import("./firebase.mjs");
          const driver = firebaseDriver(config, { attestations: current.churches[config.churchId]?.attestations || {} });
          try { console.log(JSON.stringify(await runSetup({ config, registry: current, project, release, driver, save, verifyOnly: command === "verify" }))); }
          finally { const { deleteApp } = await import("firebase-admin/app"); await deleteApp(driver.app); }
        }
      });
    } else throw new Error("Commands: plan, apply, verify, status, release-plan, deploy, rollback-plan, rollback, recovery-plan");
  }
} catch (error) {
  // All driver failures are sanitized before reaching here. Never print SDK/raw provider errors or payloads.
  console.error(error instanceof Error ? error.message : "Operator command failed"); process.exitCode = 1;
}
