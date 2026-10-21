import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fingerprint } from "./model.mjs";
const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const result = (ready, code) => ({ ready, code });
export function firebaseDriver(config, { attestations = {}, deploy } = {}) {
  const emulator = config.environment === "emulator";
  for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
    const host = process.env[name];
    if (emulator ? !host || !/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) : !!host)
      throw new Error("Emulator/live credential boundary mismatch");
  }
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  const { getStorage } = require("firebase-admin/storage");
  const app = initializeApp({ projectId: config.projectId, storageBucket: config.storageBucket, ...(emulator ? {} : { credential: applicationDefault() }) }, `operator-${config.projectId}-${randomBytes(6).toString("hex")}`);
  const db = getFirestore(app), auth = getAuth(app), storage = getStorage(app);
  const identity = db.doc("deploymentIdentity/church");
  let token;
  async function api(host, path, method = "GET", body) {
    if (emulator) throw new Error("Live API forbidden from emulator setup");
    if (!token) token = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
    const response = await fetch(`https://${host}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Goog-User-Project": config.projectId }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Operator API failed (${response.status}); response bodies are redacted`);
    return response.status === 204 ? {} : response.json();
  }
  async function projectIdentity() {
    const row = await identity.get();
    if (row.exists && (row.get("churchId") !== config.churchId || row.get("projectId") !== config.projectId || row.get("environment") !== config.environment)) throw new Error("Remote project is reserved for another church or environment");
    return row;
  }
  async function secretMetadata(name) {
    return api("secretmanager.googleapis.com", `/v1/projects/${config.projectId}/secrets/${name}/versions/latest`);
  }
  const secretNames = ["PRIVATE_RECORD_KEYS", "COMMUNICATIONS_CONFIG", "PORTAL_RATE_LIMIT_KEY", "RECOVERY_WRAPPING_KEY"];
  async function verify(id, _config, release) {
    await projectIdentity();
    if (id === "identity") return result((await identity.get()).exists, "unreserved-project");
    if (id === "infrastructure") {
      if (emulator) { await Promise.all([db.listCollections(), auth.listUsers(1)]); return result(true, "emulator-only"); }
      const [firebase, database, bucket, authConfig, appCheck, backupIdentity] = await Promise.all([
        api("firebase.googleapis.com", `/v1beta1/projects/${config.projectId}`),
        api("firestore.googleapis.com", `/v1/projects/${config.projectId}/databases/(default)`),
        api("storage.googleapis.com", `/storage/v1/b/${config.storageBucket}`),
        api("identitytoolkit.googleapis.com", `/admin/v2/projects/${config.projectId}/config`),
        api("firebaseappcheck.googleapis.com", `/v1/projects/${config.projectId}/apps/${encodeURIComponent(config.firebase.appId)}/recaptchaEnterpriseConfig`),
        api("iam.googleapis.com", `/v1/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(config.backupServiceAccount)}`),
      ]);
      const ready = backupIdentity?.email === config.backupServiceAccount && !backupIdentity?.disabled && firebase?.state === "ACTIVE" && String(bucket?.projectNumber) === String(firebase.projectNumber) && bucket?.versioning?.enabled && database?.locationId === config.region && bucket?.location?.toLowerCase() === config.region && authConfig?.mfa?.state === "ENABLED" && !!appCheck?.siteKey;
      return result(!!ready, "verify-firebase-region-identity-platform-appcheck");
    }
    if (id === "secrets") {
      if (emulator) return result((await db.doc("operatorEmulator/secrets").get()).exists, "fictional-emulator-only");
      const metadata = await Promise.all(secretNames.map(secretMetadata));
      return result(metadata.every((value) => value?.state === "ENABLED"), "missing-project-secret");
    }
    if (id === "defaults") {
      const [branding, settings, communications] = await Promise.all([db.doc("publicBranding/church").get(), db.doc("settings/church").get(), db.doc("communicationSettings/church").get()]);
      return result(branding.get("churchId") === config.churchId && settings.exists && communications.exists, "missing-empty-church-defaults");
    }
    if (id === "administrator") {
      const user = await auth.getUserByEmail(config.admin.email).catch((error) => { if (error.code === "auth/user-not-found") return null; throw error; });
      if (!user) return result(false, "chosen-administrator-not-created");
      if (fingerprint([...(user.customClaims?.roles || [])].sort()) !== fingerprint([...config.admin.roles].sort())) throw new Error("Existing administrator roles need explicit reconciliation");
      return result(true, "enrollment-required-no-assurance-granted");
    }
    if (id === "domains") {
      if (emulator) return result(true, "loopback-only-not-dns-acceptance");
      const authConfig = await api("identitytoolkit.googleapis.com", `/admin/v2/projects/${config.projectId}/config`);
      const hostname = new URL(config.origin).hostname;
      const domain = await api("firebasehosting.googleapis.com", `/v1beta1/projects/${config.projectId}/sites/${config.hostingSite}/customDomains/${hostname}`);
      return result(config.authDomains.every((name) => authConfig?.authorizedDomains?.includes(name)) && (hostname === `${config.hostingSite}.web.app` || (domain?.hostState === "HOST_ACTIVE" && domain?.cert?.state === "CERT_ACTIVE")), "pending-dns-tls-or-authorized-domain");
    }
    if (id === "providers") return result(true, "delivery-disabled-provider-enrollment-separate");
    if (id === "backups") {
      if (emulator) return result(true, "emulator-drill-required-not-live-backup");
      const schedules = await api("firestore.googleapis.com", `/v1/projects/${config.projectId}/databases/(default)/backupSchedules`);
      const bucket = await api("storage.googleapis.com", `/storage/v1/b/${config.backupBucket}`);
      return result(schedules?.backupSchedules?.some((row) => row.dailyRecurrence && row.retention === "2592000s") && !!bucket?.versioning?.enabled && !!bucket?.encryption?.defaultKmsKeyName && !!bucket?.iamConfiguration?.uniformBucketLevelAccess?.enabled && !!attestations.backupRecoveryVerified, "daily-backup-storage-auth-key-drill-required");
    }
    if (id === "release") return result(attestations.deployedRelease === release, "explicit-pinned-deployment-required");
    if (id === "verify") {
      if (emulator) return result(true, "emulator-only-real-mfa-domains-appcheck-unverified");
      const response = await fetch(`${config.origin}/manifest.webmanifest`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const manifest = response.ok ? await response.json() : null;
      return result(manifest?.id === "/" && manifest?.name === config.branding.appName && !!attestations.stagingSecurityVerified, "staging-security-acceptance-required");
    }
    throw new Error("Unknown setup checkpoint");
  }
  async function apply(id, _config, release) {
    if (id === "identity") {
      if (!emulator) {
        const project = await api("cloudresourcemanager.googleapis.com", `/v1/projects/${config.projectId}`);
        if (project?.projectId !== config.projectId || project.lifecycleState !== "ACTIVE") throw new Error("Explicit existing project unavailable");
      }
      await db.runTransaction(async (tx) => {
        const before = await tx.get(identity);
        if (before.exists) { if (before.get("churchId") !== config.churchId) throw new Error("Project already assigned"); return; }
        // Refuse attaching a new church to a database already containing congregation records.
        for (const name of ["people", "households", "services", "users", "careNotes", "mercyNotes"])
          if (!(await tx.get(db.collection(name).limit(1))).empty) throw new Error("Only an empty project may be initialized");
        tx.create(identity, { churchId: config.churchId, projectId: config.projectId, environment: config.environment, createdAt: FieldValue.serverTimestamp() });
      });
    } else if (id === "secrets") {
      if (emulator) {
        const ref = db.doc("operatorEmulator/secrets");
        await db.runTransaction(async (tx) => { if (!(await tx.get(ref)).exists) tx.create(ref, { ring: { active: "v1", keys: { v1: randomBytes(32).toString("base64") } }, fictional: true }); });
        return;
      }
      for (const name of secretNames) {
        if (await secretMetadata(name)) continue;
        const existing = await api("secretmanager.googleapis.com", `/v1/projects/${config.projectId}/secrets/${name}`);
        if (existing) {
          const versions = await api("secretmanager.googleapis.com", `/v1/projects/${config.projectId}/secrets/${name}/versions`);
          if (versions?.versions?.length) throw new Error("Existing disabled or unavailable secret versions require recovery; never replace an encryption key");
        }
        if (!existing) await api("secretmanager.googleapis.com", `/v1/projects/${config.projectId}/secrets?secretId=${name}`, "POST", { replication: { automatic: {} }, labels: { "church-id": config.churchId } });
        const secret = name === "PRIVATE_RECORD_KEYS" ? JSON.stringify({ active: "v1", keys: { v1: randomBytes(32).toString("base64") } }) : name === "COMMUNICATIONS_CONFIG" ? JSON.stringify({ publicFunctionsUrl: `https://${config.region}-${config.projectId}.cloudfunctions.net`, unsubscribeSecret: randomBytes(32).toString("hex") }) : name === "RECOVERY_WRAPPING_KEY" ? randomBytes(32).toString("base64") : randomBytes(32).toString("hex");
        await api("secretmanager.googleapis.com", `/v1/projects/${config.projectId}/secrets/${name}:addVersion`, "POST", { payload: { data: Buffer.from(secret).toString("base64") } });
      }
    } else if (id === "defaults") {
      const { publicBrandingSchema, churchSettingsSchema, communicationSettingsSchema, serviceTypeSchema } = await import("@sycamore/shared");
      const rows = {
        "settings/church": { ...churchSettingsSchema.parse({ name: config.branding.churchName, address: "", timeZone: config.timeZone }), revision: 1 },
        "publicBranding/church": { ...publicBrandingSchema.parse({ ...config.branding, churchId: config.churchId, projectId: config.projectId }), revision: 1 },
        "communicationSettings/church": communicationSettingsSchema.parse({ churchName: config.branding.churchName, emailEnabled: false, smsEnabled: false }),
        ...Object.fromEntries(config.services.map(({ id, time, ...value }) => [`serviceTypes/${id}`, serviceTypeSchema.parse({ ...value, defaultTime: time, isActive: true })])),
      };
      await db.runTransaction(async (tx) => {
        const snapshots = await Promise.all(Object.keys(rows).map((path) => tx.get(db.doc(path))));
        Object.entries(rows).forEach(([path, value], index) => { if (!snapshots[index].exists) tx.create(db.doc(path), value); });
      });
    } else if (id === "administrator") {
      let user = await auth.getUserByEmail(config.admin.email).catch((error) => { if (error.code === "auth/user-not-found") return null; throw error; });
      if (!user) user = await auth.createUser({ email: config.admin.email, emailVerified: false });
      if (user.customClaims?.roles?.length && fingerprint([...user.customClaims.roles].sort()) !== fingerprint([...config.admin.roles].sort())) throw new Error("Existing roles differ from approved administrator roles");
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`staffAccess/${user.uid}`), row = await tx.get(ref);
        if (!row.exists) tx.create(ref, { enabled: true, roles: config.admin.roles, validAfter: 0 });
      });
      await auth.setCustomUserClaims(user.uid, { ...user.customClaims, roles: config.admin.roles });
      // Password reset/enrollment link stays in protected operator delivery; never log or share a default password.
    } else if (id === "backups" && !emulator) {
      const path = `/v1/projects/${config.projectId}/databases/(default)/backupSchedules`;
      const schedules = await api("firestore.googleapis.com", path);
      if (!schedules?.backupSchedules?.some((row) => row.dailyRecurrence && row.retention === "2592000s"))
        await api("firestore.googleapis.com", path, "POST", { retention: "2592000s", dailyRecurrence: {} });
    } else if (id === "release" && deploy) {
      await deploy(config, release); attestations.deployedRelease = release;
    }
    // Infrastructure, DNS, billing, providers and recovery evidence are deliberate operator prerequisites.
    // Missing prerequisites remain pending instead of being marked ready by a no-op.
  }
  return { verify, apply, db, auth, storage, app };
}
