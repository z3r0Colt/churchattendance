import { createHash } from "node:crypto";
const fail = (message) => { throw new Error(message); };
const object = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail("Invalid descriptor fields");
};
const text = (value, pattern, label) => { if (typeof value !== "string" || !pattern.test(value)) fail(`Invalid ${label}`); return value; };
export function descriptor(value) {
  object(value, ["version", "churchId", "projectId", "environment", "origin", "region", "storageBucket", "hostingSite", "authDomains", "firebase", "branding", "admin", "services", "providers", "backupBucket", "budgetMonthlyUsd", "timeZone", "backupServiceAccount"]);
  if (value.version !== 1) fail("Unsupported descriptor version");
  text(value.churchId, /^[a-z][a-z0-9-]{2,62}$/, "church ID");
  text(value.projectId, /^[a-z][a-z0-9-]{4,29}$/, "explicit project ID");
  if (!["emulator", "staging", "live", "recovery"].includes(value.environment)) fail("Invalid environment");
  if (value.projectId.startsWith("demo-") !== (value.environment === "emulator")) fail("Demo/live project mismatch");
  const origin = new URL(value.origin);
  if (origin.origin !== value.origin || origin.username || origin.password || origin.protocol !== (value.environment === "emulator" ? "http:" : "https:")) fail("Use a single canonical origin");
  if (value.environment === "emulator" && !["localhost", "127.0.0.1"].includes(origin.hostname)) fail("Emulator origin must be loopback");
  // Current callables and clients intentionally share this region. Expand together, never silently move an existing database.
  if (value.region !== "us-central1") fail("This release supports us-central1 only");
  try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(); if (!value.timeZone) fail("Time zone required"); } catch { fail("Choose a valid church time zone"); }
  text(value.storageBucket, /^[a-z0-9][a-z0-9.-]{2,221}$/, "storage bucket");
  text(value.backupBucket, /^[a-z0-9][a-z0-9.-]{2,221}$/, "separate backup bucket");
  text(value.backupServiceAccount, /^[a-z][a-z0-9-]*@[a-z][a-z0-9-]*\.iam\.gserviceaccount\.com$/, "dedicated backup service account");
  if (!value.backupServiceAccount.endsWith(`@${value.projectId}.iam.gserviceaccount.com`)) fail("Backup identity must belong to the selected project");
  if (value.storageBucket === value.backupBucket) fail("Use a separate protected backup bucket");
  text(value.hostingSite, /^[a-z][a-z0-9-]{4,29}$/, "Hosting site");
  if (!Array.isArray(value.authDomains) || !value.authDomains.includes(origin.hostname) || value.authDomains.some((domain) => !/^[a-z0-9.-]+$/.test(domain))) fail("Auth domains must include the canonical host");
  object(value.firebase, ["apiKey", "appId", "authDomain"]);
  for (const key of ["apiKey", "appId", "authDomain"]) text(value.firebase[key], /^[A-Za-z0-9:._-]{3,256}$/, `Firebase ${key}`);
  if (!value.authDomains.includes(value.firebase.authDomain)) fail("Allowlist the Firebase auth domain explicitly");
  object(value.branding, ["churchName", "appName", "subtitle", "palette", "website", "contactEmail", "contactPhone", "logo"]);
  for (const key of ["churchName", "appName"]) text(value.branding[key], /^[^<>\x00-\x1f]{1,80}$/, key);
  if (!["forest", "navy", "plum"].includes(value.branding.palette)) fail("Invalid brand palette");
  object(value.admin, ["email", "roles"]);
  text(value.admin.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "chosen administrator email");
  const roles = ["admin", "pastor", "clerk", "elder", "deacon", "attendanceVolunteer", "readOnly"];
  if (!Array.isArray(value.admin.roles) || !value.admin.roles.includes("admin") || new Set(value.admin.roles).size !== value.admin.roles.length || value.admin.roles.some((role) => !roles.includes(role))) fail("Approve explicit roles including Admin; Session is never automatic");
  if (!Array.isArray(value.services) || value.services.length > 20) fail("Choose up to 20 initial service templates");
  for (const service of value.services) {
    object(service, ["id", "name", "time", "dayOfWeek"]);
    text(service.id, /^[a-z][a-z0-9-]{0,39}$/, "service ID");
    text(service.name, /^[^<>\x00-\x1f]{1,80}$/, "service name");
    text(service.time, /^(?:[01]\d|2[0-3]):[0-5]\d$/, "service time");
    if (!Number.isInteger(service.dayOfWeek) || service.dayOfWeek < 0 || service.dayOfWeek > 6) fail("Invalid service day");
  }
  object(value.providers, ["email", "sms"]);
  if (!["disabled", "graph"].includes(value.providers.email) || !["disabled", "twilio"].includes(value.providers.sms)) fail("Unsupported provider selection");
  if (!(value.budgetMonthlyUsd > 0 && Number.isFinite(value.budgetMonthlyUsd))) fail("Choose a monthly budget alert threshold");
  return structuredClone(value);
}
export function fingerprint(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function assertTarget(config, registry, project) {
  if (project !== config.projectId || !registry.allowedProjects?.includes(project)) fail("Select the exact allowlisted project with --project");
  for (const [id, row] of Object.entries(registry.churches || {})) {
    if (config.environment !== "emulator" && id !== config.churchId && row.origin === config.origin) fail("A church origin cannot be reused by another church");
    if ((row.projectId === project && id !== config.churchId) || (id === config.churchId && (row.projectId !== project || row.environment !== config.environment || row.origin !== config.origin || row.region !== config.region))) fail("Church/project/domain association is immutable; use a reviewed migration");
  }
}
export const setupSteps = ["identity", "infrastructure", "secrets", "defaults", "administrator", "domains", "providers", "backups", "release", "verify"];
export function setupPlan(config, release) {
  if (!/^[a-f0-9]{40}$/.test(release || "")) fail("Pin a full Git commit with --release");
  return setupSteps.map((id) => ({ id, projectId: config.projectId, churchId: config.churchId, release,
    description: {
      identity: "Verify project identity and reserve a stable church association",
      infrastructure: "Verify existing Firebase, Identity Platform, us-central1 database/Storage, Hosting and App Check",
      secrets: "Create missing per-project key ring, communication and rate-limit secrets; preserve existing versions",
      defaults: "Create missing empty-church settings and selected templates, with delivery disabled",
      administrator: "Create or verify the chosen administrator, explicit roles, no default password or assurance bypass",
      domains: "Verify canonical DNS, Auth domains, passkey identity and return/callback URLs",
      providers: "Record disabled or pending church-owned Graph/Twilio setup; never automatically enable delivery",
      backups: "Verify daily 30-day Firestore backup and protected Storage/Auth/key recovery coverage",
      release: "Build/deploy the pinned source with church-bound public config using an explicit project",
      verify: "Verify the deployment and record pending staging gates without claiming live MFA or provider verification",
    }[id] }));
}
export async function runSetup({ config, registry, project, release, driver, save, verifyOnly = false }) {
  assertTarget(config, registry, project);
  const plan = setupPlan(config, release);
  const row = registry.churches[config.churchId] ||= { projectId: project, environment: config.environment, origin: config.origin, region: config.region, checkpoints: {} };
  // No private bodies or raw exception/provider output enters the registry.
  for (const step of plan) {
    row.checkpoints[step.id] = { status: "checking", at: new Date().toISOString() };
    await save(registry);
    try {
      let result = await driver.verify(step.id, config, release);
      if (!result.ready && !verifyOnly) {
        await driver.apply(step.id, config, release);
        result = await driver.verify(step.id, config, release);
      }
      row.checkpoints[step.id] = { status: result.ready ? "ready" : "pending", code: result.code || "verification-required", at: new Date().toISOString() };
      await save(registry);
      if (!result.ready) return { ready: false, step: step.id };
    } catch {
      row.checkpoints[step.id] = { status: "failed", code: "operator-check-required", at: new Date().toISOString() };
      await save(registry);
      throw new Error(`Setup failed at ${step.id} for ${project}. Review protected operator diagnostics; no delivery was enabled.`);
    }
  }
  row.release = release; await save(registry);
  return { ready: true };
}
