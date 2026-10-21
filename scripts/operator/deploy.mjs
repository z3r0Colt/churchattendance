import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function deploymentDriver() {
  const execute = (command, args, cwd, env = {}) => {
    try { return execFileSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 20 * 60_000 }); }
    catch { throw new Error(`Release command failed: ${command}. Command output is redacted; inspect the selected project's deployment status.`); }
  };
  return {
    async deploy(plan, config) {
      if (["emulator", "recovery"].includes(config.environment)) throw new Error("Public deployment requires an explicitly selected staging or live descriptor");
      const { firebaseDriver } = await import("./firebase.mjs");
      const guard = firebaseDriver(config);
      try {
        for (const step of ["identity", "infrastructure", "domains"]) if (!(await guard.verify(step, config, plan.release)).ready) throw new Error("Deployment prerequisites must be verified in the selected project");
      } finally { const { deleteApp } = await import("firebase-admin/app"); await deleteApp(guard.app); }
      const directory = await mkdtemp(join(tmpdir(), "church-release-"));
      try {
        const archive = execute("git", ["archive", "--format=tar", plan.release], process.cwd());
        const archivePath = join(directory, "release.tar"); await writeFile(archivePath, archive, { mode: 0o600 });
        execute("tar", ["-xf", archivePath, "-C", directory], directory);
        const firebase = JSON.parse(await readFile(join(directory, "firebase.json"), "utf8"));
        firebase.hosting.site = config.hostingSite; delete firebase.hosting.target;
        await writeFile(join(directory, "firebase.json"), JSON.stringify(firebase));
        const params = { CHURCH_ID: config.churchId, BACKUP_BUCKET: config.backupBucket, BACKUP_SERVICE_ACCOUNT: config.backupServiceAccount, SERVICE_DELIVERY: "pwa", PORTAL_ORIGIN: config.origin, STAFF_AUTH_ORIGIN: config.origin, STAFF_AUTH_RP_ID: new URL(config.origin).hostname, CALENDAR_UID_DOMAIN: new URL(config.origin).hostname };
        await writeFile(join(directory, `functions/.env.${config.projectId}`), Object.entries(params).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
        const env = { VITE_USE_EMULATORS: "false", CHURCH_RELEASE: plan.release, ELECTRON_SKIP_BINARY_DOWNLOAD: "1", VITE_FIREBASE_API_KEY: config.firebase.apiKey, VITE_FIREBASE_APP_ID: config.firebase.appId, VITE_FIREBASE_AUTH_DOMAIN: config.firebase.authDomain, VITE_FIREBASE_PROJECT_ID: config.projectId, VITE_FIREBASE_STORAGE_BUCKET: config.storageBucket, VITE_DEPLOYMENT_PROJECT_ID: config.projectId, VITE_CHURCH_ID: config.churchId, VITE_CHURCH_ORIGIN: config.origin, VITE_PORTAL_ORIGIN: config.origin, VITE_STAFF_AUTH_ORIGIN: config.origin };
        // App Check site key is public config, but is supplied deliberately by the operator runtime.
        if (!process.env.VITE_PORTAL_APP_CHECK_SITE_KEY) throw new Error("App Check public site key is required");
        execute("npm", ["ci"], directory, env);
        execute("npm", ["run", "build"], directory, env);
        execute("npm", ["run", "check:bundles"], directory, env);
        execute("npx", ["--no-install", "firebase", "deploy", "--non-interactive", "--project", plan.project, "--only", "firestore:rules,firestore:indexes,storage,functions,hosting"], directory, env);
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async verify(_plan, config) {
      const manifest = await fetch(`${config.origin}/manifest.webmanifest`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!manifest.ok) return false;
      const value = await manifest.json();
      const versionResponse = await fetch(`${config.origin}/release.json`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!versionResponse.ok) return false;
      const version = await versionResponse.json();
      return value.id === "/" && value.start_url === "/launch" && value.name === config.branding.appName && version.release === _plan.release && version.projectId === config.projectId && version.churchId === config.churchId && version.origin === config.origin;
    },
  };
}
