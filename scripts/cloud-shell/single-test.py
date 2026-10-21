#!/usr/bin/env python3
"""Set up an explicitly selected, disposable single-church test project.

Run in Google Cloud Shell. Uses local Google credentials, never a pasted key.
Does not seed people, send messages, bypass MFA, or claim production readiness.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class SetupError(Exception):
    pass


def command(args, *, capture=False, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, check=False)
    if result.returncode:
        raise SetupError(f"Command failed: {args[0]} {args[1] if len(args) > 1 else ''}. "
                         "Review the error in this terminal; do not share credentials.")
    return result.stdout.strip() if capture else None


class Google:
    def __init__(self, project):
        self.project = project
        self.token = None
        self.expires = 0

    def api(self, host, path, method="GET", body=None, missing=False):
        if time.monotonic() >= self.expires:
            self.token = command(["gcloud", "auth", "print-access-token"], capture=True)
            self.expires = time.monotonic() + 1200
        request = Request(f"https://{host}{path}", method=method,
                          data=None if body is None else json.dumps(body).encode(),
                          headers={"Authorization": f"Bearer {self.token}",
                                   "Content-Type": "application/json",
                                   "X-Goog-User-Project": self.project})
        try:
            with urlopen(request, timeout=90) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except HTTPError as error:
            if missing and error.code == 404:
                return None
            # API bodies can contain private records/configuration. Never echo them.
            raise SetupError(f"Google API HTTP {error.code}: {method} {host}{path.split('?')[0]}. "
                             "Nothing was marked complete; rerun after correcting the project permission/resource error.") from None

    def operation(self, host, value, prefix="/v1/"):
        deadline = time.monotonic() + 600
        while not value.get("done"):
            if time.monotonic() > deadline:
                raise SetupError("Google operation is still pending. Rerun to inspect and resume.")
            time.sleep(3)
            value = self.api(host, prefix + value["name"])
        if value.get("error"):
            raise SetupError("Google operation failed; inspect that project's operation status.")
        return value.get("response", {})


def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value, indent=2) + "\n")
    path.chmod(0o600)


def validate(args):
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,29}", args.project) or args.project.startswith("demo-"):
        raise SetupError("Choose an explicit real Firebase project ID.")
    if not re.fullmatch(r"[a-f0-9]{40}", args.release):
        raise SetupError("Pin --release to a full reviewed Git commit.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", args.admin_email):
        raise SetupError("Choose an administrator email.")
    if not args.church_name.strip() or len(args.church_name) > 80 or re.search(r"[<>\x00-\x1f]", args.church_name):
        raise SetupError("Use a plain church display name up to 80 characters.")


def source_checkout(release):
    root = Path.home() / f"foldkeeper-test-{release[:12]}"
    marker = root / ".foldkeeper-source-release"
    if root.exists():
        if not marker.exists() or marker.read_text().strip() != release:
            raise SetupError(f"Existing directory is not this pinned test checkout: {root}")
        return root
    root.mkdir(mode=0o700)
    url = f"https://codeload.github.com/z3r0Colt/churchattendance/tar.gz/{release}"
    try:
        with tempfile.TemporaryFile() as archive:
            with urlopen(url, timeout=120) as response:
                shutil.copyfileobj(response, archive)
            archive.seek(0)
            with tarfile.open(fileobj=archive, mode="r:gz") as source:
                for member in source.getmembers():
                    parts = Path(member.name).parts[1:]
                    if not parts:
                        continue
                    if member.issym() or member.islnk() or not (member.isfile() or member.isdir()) or ".." in parts:
                        raise SetupError("Unsupported source archive entry.")
                    destination = root.joinpath(*parts)
                    if member.isdir():
                        destination.mkdir(parents=True, exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with source.extractfile(member) as data:
                            destination.write_bytes(data.read())
        marker.write_text(release + "\n")
        return root
    except Exception:
        # Only our newly created, incomplete checkout is removed.
        shutil.rmtree(root)
        raise


def deny_rules(google, release_name, source):
    host = "firebaserules.googleapis.com"
    parent = f"/v1/projects/{google.project}"
    if google.api(host, f"{parent}/releases/{release_name}", missing=True):
        return  # Preserve previously deployed rules on resumption.
    ruleset = google.api(host, parent + "/rulesets", "POST",
                         {"source": {"files": [{"name": "initial.rules", "content": source}]}})
    google.api(host, parent + "/releases", "POST",
               {"name": f"projects/{google.project}/releases/{release_name}",
                "rulesetName": ruleset["name"]})


def provision(args, google):
    project = args.project
    parent = f"projects/{project}"
    resource = google.api("cloudresourcemanager.googleapis.com", f"/v1/{parent}")
    if resource.get("projectId") != project or resource.get("lifecycleState") != "ACTIVE":
        raise SetupError("Selected project is not active.")
    billing = google.api("cloudbilling.googleapis.com", f"/v1/{parent}/billingInfo")
    if not billing.get("billingEnabled"):
        raise SetupError("Billing is not enabled on the selected project.")
    database_path = f"/v1/{parent}/databases/(default)"
    firestore = "firestore.googleapis.com"
    database = google.api(firestore, database_path, missing=True)
    marker_path = database_path + "/documents/deploymentIdentity/church"
    marker = google.api(firestore, marker_path, missing=True) if database else None
    if marker:
        fields = marker.get("fields", {})
        expected = {"churchId": "testing-rpc", "projectId": project, "environment": "staging"}
        if any(fields.get(key, {}).get("stringValue") != value for key, value in expected.items()):
            raise SetupError("Project is reserved for a different church or environment.")
    elif database:
        collections = google.api(firestore, database_path + "/documents:listCollectionIds", "POST", {})
        if collections.get("collectionIds"):
            raise SetupError("This tool initializes an empty test database only. Existing data needs review.")
    if not database:
        print("Creating regional Firestore database...", flush=True)
        operation = google.api(firestore, f"/v1/{parent}/databases?databaseId=(default)", "POST",
                               {"type": "FIRESTORE_NATIVE", "locationId": "us-central1",
                                "databaseEdition": "STANDARD"})
        google.operation(firestore, operation)
        database = google.api(firestore, database_path)
    if database.get("locationId") != "us-central1" or database.get("type") != "FIRESTORE_NATIVE":
        raise SetupError("Existing Firestore must be Native mode in us-central1; this script will not move it.")
    if not marker:
        google.api(firestore, marker_path + "?currentDocument.exists=false", "PATCH",
                   {"fields": {key: {"stringValue": value} for key, value in
                               {"churchId": "testing-rpc", "projectId": project, "environment": "staging"}.items()}})
    deny_rules(google, "cloud.firestore", "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{path=**} { allow read, write: if false; } } }")
    print("Creating/linking restricted Firebase Storage...", flush=True)
    storage_path = f"/v1beta/{parent}/defaultBucket"
    bucket = google.api("firebasestorage.googleapis.com", storage_path, missing=True)
    if not bucket:
        bucket = google.api("firebasestorage.googleapis.com", storage_path, "POST",
                            {"location": "us-central1", "storageClass": "STANDARD"})
    bucket_name = bucket["bucket"]["name"].split("/")[-1]
    metadata = google.api("storage.googleapis.com", f"/storage/v1/b/{bucket_name}")
    if str(metadata.get("projectNumber")) != str(resource["projectNumber"]) or metadata.get("location", "").lower() != "us-central1":
        raise SetupError("Storage ownership/location does not match the selected project.")
    google.api("storage.googleapis.com", f"/storage/v1/b/{bucket_name}", "PATCH", {"versioning": {"enabled": True}})
    deny_rules(google, f"firebase.storage/{bucket_name}", "rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{path=**} { allow read, write: if false; } } }")
    print("Configuring Identity Platform, email sign-in and real TOTP MFA...", flush=True)
    auth = "identitytoolkit.googleapis.com"
    config_path = f"/admin/v2/{parent}/config"
    config = google.api(auth, config_path, missing=True)
    if not config or config.get("subtype") != "IDENTITY_PLATFORM":
        google.api(auth, f"/v2/{parent}/identityPlatform:initializeAuth", "POST", {})
        config = google.api(auth, config_path)
    domains = sorted(set(config.get("authorizedDomains", []) + [f"{project}.web.app", f"{project}.firebaseapp.com"]))
    google.api(auth, config_path + "?updateMask=signIn.email,authorizedDomains,mfa", "PATCH",
               {"signIn": {"email": {"enabled": True, "passwordRequired": False}},
                "authorizedDomains": domains,
                "mfa": {"state": "ENABLED", "providerConfigs": [{"state": "ENABLED", "totpProviderConfig": {"adjacentIntervals": 1}}]}})
    print("Registering the web app and real reCAPTCHA Enterprise App Check...", flush=True)
    firebase = "firebase.googleapis.com"
    apps_path = f"/v1beta1/{parent}/webApps"
    apps = google.api(firebase, apps_path + "?pageSize=100").get("apps", [])
    matches = [app for app in apps if app.get("displayName") == "Foldkeeper single-church test" and app.get("state", "ACTIVE") == "ACTIVE"]
    if len(matches) > 1:
        raise SetupError("Multiple matching web apps need review.")
    app = matches[0] if matches else google.operation(firebase, google.api(firebase, apps_path, "POST", {"displayName": "Foldkeeper single-church test"}), "/v1beta1/")
    sdk = google.api(firebase, f"/v1beta1/{app['name']}/config")
    recaptcha = "recaptchaenterprise.googleapis.com"
    keys = []
    page = ""
    while True:
        response = google.api(recaptcha, f"/v1/{parent}/keys?" + urlencode({"pageSize": 100, "pageToken": page}))
        keys.extend(response.get("keys", []))
        page = response.get("nextPageToken", "")
        if not page:
            break
    keys = [key for key in keys if key.get("displayName") == "Foldkeeper single-church test"]
    if len(keys) > 1:
        raise SetupError("Multiple matching App Check keys need review.")
    key = keys[0] if keys else google.api(recaptcha, f"/v1/{parent}/keys", "POST",
                {"displayName": "Foldkeeper single-church test", "webSettings":
                 {"integrationType": "SCORE", "allowAllDomains": False,
                  "allowedDomains": [f"{project}.web.app", f"{project}.firebaseapp.com"]}})
    web = key.get("webSettings", {})
    if web.get("allowAllDomains") or web.get("integrationType") != "SCORE" or f"{project}.web.app" not in web.get("allowedDomains", []):
        raise SetupError("Existing reCAPTCHA key configuration needs review.")
    site_key = key["name"].split("/")[-1]
    number = str(resource["projectNumber"])
    check_name = f"projects/{number}/apps/{app['appId']}/recaptchaEnterpriseConfig"
    google.api("firebaseappcheck.googleapis.com", "/v1/" + check_name + "?updateMask=siteKey,tokenTtl", "PATCH",
               {"name": check_name, "siteKey": site_key, "tokenTtl": "3600s"})
    print("Creating missing secrets without replacing existing keys...", flush=True)
    for name in ["PRIVATE_RECORD_KEYS", "COMMUNICATIONS_CONFIG", "PORTAL_RATE_LIMIT_KEY", "RECOVERY_WRAPPING_KEY"]:
        path = f"/v1/{parent}/secrets/{name}"
        secret = google.api("secretmanager.googleapis.com", path, missing=True)
        if secret:
            versions = google.api("secretmanager.googleapis.com", path + "/versions?pageSize=100").get("versions", [])
            latest = google.api("secretmanager.googleapis.com", path + "/versions/latest", missing=True)
            if versions and (not latest or latest.get("state") != "ENABLED"):
                raise SetupError(f"Existing {name} versions need recovery review; no key was replaced.")
            if latest and latest.get("state") == "ENABLED":
                continue
        else:
            google.api("secretmanager.googleapis.com", f"/v1/{parent}/secrets?secretId={name}", "POST", {"replication": {"automatic": {}}})
        value = {"PRIVATE_RECORD_KEYS": lambda: json.dumps({"active": "v1", "keys": {"v1": base64.b64encode(secrets.token_bytes(32)).decode()}}),
                 "COMMUNICATIONS_CONFIG": lambda: json.dumps({"publicFunctionsUrl": f"https://us-central1-{project}.cloudfunctions.net", "unsubscribeSecret": secrets.token_hex(32)}),
                 "PORTAL_RATE_LIMIT_KEY": lambda: secrets.token_hex(32),
                 "RECOVERY_WRAPPING_KEY": lambda: base64.b64encode(secrets.token_bytes(32)).decode()}[name]()
        google.api("secretmanager.googleapis.com", path + ":addVersion", "POST", {"payload": {"data": base64.b64encode(value.encode()).decode()}})
    hosting = f"/v1beta1/{parent}/sites/{project}"
    if not google.api("firebasehosting.googleapis.com", hosting, missing=True):
        google.api("firebasehosting.googleapis.com", f"/v1beta1/{parent}/sites?siteId={project}", "POST", {})
    return {"projectId": project, "churchId": "testing-rpc", "origin": f"https://{project}.web.app",
            "churchName": args.church_name, "adminEmail": args.admin_email,
            "timeZone": "America/Indiana/Indianapolis", "bucket": bucket_name,
            "firebase": sdk, "siteKey": site_key, "projectNumber": number}


ADMIN_SCRIPT = r'''
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { churchSettingsSchema, publicBrandingSchema, communicationSettingsSchema, serviceTypeSchema } from "@sycamore/shared";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const config = JSON.parse(readFileSync(new URL("./single-test-config.json", import.meta.url), "utf8"));
const app = initializeApp({ projectId: config.projectId, storageBucket: config.bucket, credential: applicationDefault() });
const db = getFirestore(app), auth = getAuth(app);
try {
  const rows = {
    "settings/church": { ...churchSettingsSchema.parse({ name: config.churchName, address: "", timeZone: config.timeZone }), revision: 1 },
    "publicBranding/church": { ...publicBrandingSchema.parse({ churchId: config.churchId, projectId: config.projectId, churchName: config.churchName, appName: config.churchName, palette: "forest" }), revision: 1 },
    "communicationSettings/church": communicationSettingsSchema.parse({ churchName: config.churchName, emailEnabled: false, smsEnabled: false }),
    "serviceTypes/am": serviceTypeSchema.parse({ name: "Lord's Day Morning", dayOfWeek: 0, defaultTime: "10:00", isActive: true }),
  };
  await db.runTransaction(async tx => {
    const marker = await tx.get(db.doc("deploymentIdentity/church"));
    if (marker.get("projectId") !== config.projectId || marker.get("churchId") !== config.churchId || marker.get("environment") !== "staging") throw Error("Project reservation mismatch");
    const entries = Object.entries(rows);
    const before = await Promise.all(entries.map(([path]) => tx.get(db.doc(path))));
    entries.forEach(([path, value], index) => { if (!before[index].exists) tx.create(db.doc(path), value); });
    const communications = before[entries.findIndex(([path]) => path === "communicationSettings/church")];
    if (communications.exists && (communications.get("emailEnabled") || communications.get("smsEnabled"))) throw Error("Existing delivery must be reviewed before resuming test setup");
  });
  let user = await auth.getUserByEmail(config.adminEmail).catch(error => { if (error.code === "auth/user-not-found") return null; throw error; });
  if (!user) user = await auth.createUser({ email: config.adminEmail, emailVerified: false });
  if (user.disabled) throw Error("Administrator is disabled; review before proceeding");
  const roles = user.customClaims?.roles || [];
  if (roles.length && (roles.length !== 1 || roles[0] !== "admin")) throw Error("Existing roles differ; no Session access was granted");
  await db.runTransaction(async tx => {
    const ref = db.doc(`staffAccess/${user.uid}`), before = await tx.get(ref);
    if (!before.exists) tx.create(ref, { enabled: true, roles: ["admin"], validAfter: 0 });
    else if (!before.get("enabled") || before.get("locked") || JSON.stringify(before.get("roles")) !== JSON.stringify(["admin"])) throw Error("Existing staff access requires review");
  });
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, roles: ["admin"] });
  // This is a credential: keep it in a private local file, never console output.
  const link = await auth.generatePasswordResetLink(config.adminEmail, { url: config.origin + "/staff/" });
  writeFileSync(new URL("./administrator-setup.txt", import.meta.url), "Open this private link to set your password. Do not paste it into chat or tickets.\n\n" + link + "\n\nThen sign in to the staff app, verify your email and enroll a real authenticator/passkey.\n", { mode: 0o600 });
} finally { await db.terminate(); await deleteApp(app); }
'''


def deploy(args, google, config, root):
    env = dict(os.environ)
    sdk = config["firebase"]
    env.update({"ELECTRON_SKIP_BINARY_DOWNLOAD": "1", "VITE_USE_EMULATORS": "false",
                "CHURCH_RELEASE": args.release, "VITE_FIREBASE_API_KEY": sdk["apiKey"],
                "VITE_FIREBASE_APP_ID": sdk["appId"], "VITE_FIREBASE_AUTH_DOMAIN": sdk["authDomain"],
                "VITE_FIREBASE_PROJECT_ID": args.project, "VITE_DEPLOYMENT_PROJECT_ID": args.project,
                "VITE_FIREBASE_STORAGE_BUCKET": config["bucket"], "VITE_CHURCH_ID": config["churchId"],
                "VITE_CHURCH_ORIGIN": config["origin"], "VITE_STAFF_AUTH_ORIGIN": config["origin"],
                "VITE_PORTAL_ORIGIN": config["origin"], "VITE_PORTAL_APP_CHECK_SITE_KEY": config["siteKey"]})
    for name in ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "FUNCTIONS_EMULATOR", "FIREBASE_AUTH_EMULATOR_HOST"]:
        if env.get(name):
            raise SetupError("Emulator environment is set; use a fresh Cloud Shell terminal for real-project setup.")
    print("Checking local application-default authorization for the deployment CLI...", flush=True)
    try:
        command(["gcloud", "auth", "application-default", "print-access-token"], capture=True)
    except SetupError:
        print("Google requires local authorization. Complete its browser prompt; do not paste any codes into chat.", flush=True)
        command(["gcloud", "auth", "application-default", "login", "--no-launch-browser"])
    private = root / ".church-operator"
    private_json(private / "single-test-config.json", config)
    (private / "initialize.mjs").write_text(ADMIN_SCRIPT)
    firebase = json.loads((root / "firebase.json").read_text())
    firebase["hosting"].pop("target", None)
    firebase["hosting"]["site"] = args.project
    private_json(root / "firebase.json", firebase)
    params = {"CHURCH_ID": config["churchId"], "SERVICE_DELIVERY": "pwa", "PORTAL_ORIGIN": config["origin"],
              "STAFF_AUTH_ORIGIN": config["origin"], "STAFF_AUTH_RP_ID": f"{args.project}.web.app",
              "CALENDAR_UID_DOMAIN": f"{args.project}.web.app"}
    parameter_file = root / "functions" / f".env.{args.project}"
    parameter_file.write_text("\n".join(f"{key}={value}" for key, value in params.items()) + "\n")
    parameter_file.chmod(0o600)
    print("Installing and building the pinned app; this can take several minutes...", flush=True)
    command(["npm", "ci"], cwd=root, env=env)
    command(["npm", "run", "build"], cwd=root, env=env)
    command(["npm", "run", "check:bundles"], cwd=root, env=env)
    command(["node", str(private / "initialize.mjs")], cwd=root, env=env)
    # Modern projects may not grant the default runtime identity broad Editor access.
    # Grant only application roles inside this isolated test project, plus source-bucket access.
    runtime = f"{config['projectNumber']}-compute@developer.gserviceaccount.com"
    command(["gcloud", "iam", "service-accounts", "describe", runtime, "--project", args.project], capture=True)
    for role in ["roles/datastore.user", "roles/firebaseauth.admin", "roles/cloudbuild.builds.builder"]:
        command(["gcloud", "projects", "add-iam-policy-binding", args.project, "--member", f"serviceAccount:{runtime}", "--role", role, "--condition=None", "--quiet"], capture=True)
    command(["gcloud", "iam", "service-accounts", "add-iam-policy-binding", runtime, "--project", args.project,
             "--member", f"serviceAccount:{runtime}", "--role", "roles/iam.serviceAccountTokenCreator", "--quiet"], capture=True)
    command(["gcloud", "storage", "buckets", "add-iam-policy-binding", f"gs://{config['bucket']}",
             "--member", f"serviceAccount:{runtime}", "--role", "roles/storage.objectAdmin", "--quiet"], capture=True)
    for secret in ["PRIVATE_RECORD_KEYS", "COMMUNICATIONS_CONFIG", "PORTAL_RATE_LIMIT_KEY"]:
        command(["gcloud", "secrets", "add-iam-policy-binding", secret, "--project", args.project,
                 "--member", f"serviceAccount:{runtime}", "--role", "roles/secretmanager.secretAccessor", "--quiet"], capture=True)
    cli = [str(root / "node_modules" / ".bin" / "firebase"), "deploy", "--project", args.project, "--non-interactive"]
    command(cli + ["--only", "firestore:rules,firestore:indexes,storage"], cwd=root, env=env)
    # A disposable UI test deployment must not pretend to have production recovery.
    # Deploy the actual app endpoints, deliberately excluding the daily recovery job.
    discovery_env = dict(env, GCLOUD_PROJECT=args.project,
                         FIREBASE_CONFIG=json.dumps({"projectId": args.project, "storageBucket": config["bucket"]}))
    names = command(["node", "--input-type=module", "-e",
                     'const m = await import("./functions/lib/index.js"); const names = Object.entries(m).filter(([name, fn]) => name !== "dailyRecoveryBackup" && fn?.__endpoint).map(([name]) => name); if (!names.length) throw Error("No app endpoints discovered"); console.log("FOLDKEEPER_ENDPOINTS=" + JSON.stringify(names));'],
                    cwd=root, env=discovery_env)
    line = next((line for line in names.splitlines() if line.startswith("FOLDKEEPER_ENDPOINTS=")), None)
    endpoints = json.loads(line.split("=", 1)[1]) if line else []
    if not endpoints or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) for name in endpoints):
        raise SetupError("Could not safely determine app endpoints.")
    command(cli + ["--only", ",".join("functions:" + name for name in endpoints)], cwd=root, env=env)
    command(cli + ["--only", "hosting"], cwd=root, env=env)
    print("Verifying public deployment identity...", flush=True)
    with urlopen(config["origin"] + "/release.json", timeout=30) as response:
        version = json.load(response)
    with urlopen(config["origin"] + "/manifest.webmanifest", timeout=30) as response:
        manifest = json.load(response)
    expected_name = config["churchName"] if config["churchName"] == "Foldkeeper" else config["churchName"] + " · Foldkeeper"
    if any(version.get(key) != value for key, value in {"release": args.release, "projectId": args.project, "churchId": config["churchId"], "origin": config["origin"]}.items()) or manifest.get("name") != expected_name:
        raise SetupError("Deployed identity does not match the requested test project/church/release.")
    print(f"\nTEST DEPLOYMENT READY: {config['origin']}/staff/\n"
          f"Private administrator password-setup link: {private / 'administrator-setup.txt'}\n"
          "Open that file in Cloud Shell Editor; do not paste its contents into chat.\n"
          "Then verify your email and enroll real MFA/passkey in the app.\n"
          "Admin only; Session access was not granted. No people were seeded; SMS/email delivery is disabled.\n"
          "This is a disposable single-church test, not production acceptance.\n"
          "Full recovery/backup jobs and a billing budget alert are NOT configured by this script.", flush=True)


def enable_services(project):
    services = ["cloudresourcemanager.googleapis.com", "cloudbilling.googleapis.com",
             "firebase.googleapis.com", "firestore.googleapis.com", "firebasestorage.googleapis.com",
             "firebasehosting.googleapis.com", "firebaserules.googleapis.com", "identitytoolkit.googleapis.com",
             "firebaseappcheck.googleapis.com", "recaptchaenterprise.googleapis.com", "secretmanager.googleapis.com",
             "cloudfunctions.googleapis.com", "run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com",
             "eventarc.googleapis.com", "pubsub.googleapis.com", "cloudscheduler.googleapis.com", "iam.googleapis.com",
             "iamcredentials.googleapis.com", "compute.googleapis.com"]
    # Service Usage rejects enable requests containing more than 20 services.
    for start in range(0, len(services), 20):
        command(["gcloud", "services", "enable", *services[start:start + 20],
                 "--project", project, "--quiet"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--church-name", required=True)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    validate(args)
    os.umask(0o077)
    for tool in ["gcloud", "node", "npm"]:
        if not shutil.which(tool):
            raise SetupError(f"{tool} is required. Run this in Google Cloud Shell with Node 22 or newer.")
    if int(command(["node", "-p", "process.versions.node.split('.')[0]"], capture=True)) < 22:
        raise SetupError("Node 22+ is required. In Cloud Shell run 'nvm install 22' and rerun this command.")
    print(f"Setting up {args.project} for disposable single-church testing.\n"
          "Real cloud resources will be created; Google Cloud usage is billable. Delivery remains disabled.", flush=True)
    google = Google(args.project)
    # Explicit target everywhere; never change the user's default gcloud project.
    enable_services(args.project)
    root = source_checkout(args.release)
    config = provision(args, google)
    deploy(args, google, config, root)


if __name__ == "__main__":
    try:
        main()
    except (SetupError, OSError, ValueError, KeyError) as error:
        # Never emit a traceback containing provider responses or authorization material.
        print(f"\nSETUP STOPPED: {error}\nCompleted resources are preserved. Rerun the same command to resume; do not paste credentials or the private enrollment file into chat.", file=sys.stderr)
        sys.exit(1)
