import { assertTarget } from "./model.mjs";
export function releasePlan({ config, registry, project, release, rollback = false }) {
  assertTarget(config, registry, project);
  if (!/^[a-f0-9]{40}$/.test(release || "")) throw new Error("A full release commit is required");
  if (config.environment === "recovery") throw new Error("Recovery projects must not deploy public Functions or automation");
  const entry = registry.releases?.[release];
  if (!entry || !Number.isInteger(entry.schema) || !Number.isInteger(entry.readsFromSchema) || entry.schema < entry.readsFromSchema || !entry.ciPassed) throw new Error("Register a validated release and schema compatibility first");
  if (config.environment === "live" && (!entry.stagingVerifiedAt || !entry.pilotVerifiedAt || !entry.selectedChurches?.includes(config.churchId))) throw new Error("Stage, verify a pilot and explicitly select each church before rollout");
  const installed = registry.churches[config.churchId];
  if (!installed) throw new Error("Provision and reserve the church before releasing");
  const schema = installed.schema ?? entry.schema;
  if (schema < entry.readsFromSchema || schema > entry.schema) throw new Error("Schema is incompatible; plan a migration and backup, not a Hosting-only rollback");
  if (rollback && (!installed?.previousRelease || installed.previousRelease !== release || entry.rollbackCompatible !== true)) throw new Error("Rollback requires the recorded previous compatible release");
  if (entry.irreversibleMigration && (installed.backup?.status !== "drill-verified" || !entry.migrationVerifiedAt)) throw new Error("Verified recovery and a supervised migration are required before irreversible migration");
  return { project, release, previousRelease: installed?.release || null, schema, components: ["firestore:rules", "firestore:indexes", "storage", "functions", "hosting:portal"], publicConfig: { churchId: config.churchId, origin: config.origin }, rollback };
}
export async function deployRelease({ config, registry, project, release, driver, save, rollback = false }) {
  const plan = releasePlan({ config, registry, project, release, rollback });
  const row = registry.churches[config.churchId] ||= { projectId: project, environment: config.environment, origin: config.origin, region: config.region, checkpoints: {} };
  const prior = row.release || null;
  row.deployment = { status: "running", targetRelease: release, previousRelease: prior, at: new Date().toISOString() };
  await save(registry);
  try {
    await driver.deploy(plan, config);
    if (!(await driver.verify(plan, config))) throw new Error("Deployment verification failed");
    row.release = release; row.schema = registry.releases[release].schema;
    row.previousRelease = prior; row.deployment.status = "verified";
  } catch {
    row.deployment.status = "partial";
    // Preserve the prior recorded verified version and the failed target for deliberate recovery.
    throw new Error(`Partial release for ${project}. Inspect infrastructure and resume or restore a compatible release.`);
  } finally { await save(registry); }
  return plan;
}
export function supportEvent({ operator, churchId, action, ticket, at = new Date().toISOString() }) {
  if (!["readiness", "deploy", "backup", "restore", "support-start", "support-end", "offboard"].includes(action) || !/^[a-zA-Z0-9@._-]{3,120}$/.test(operator) || !/^[a-z][a-z0-9-]{2,62}$/.test(churchId) || !/^[A-Za-z0-9_-]{1,64}$/.test(ticket)) throw new Error("Use a named operator, fixed action and ticket ID; do not put private narratives in logs");
  return { operator, churchId, action, ticket, at };
}
