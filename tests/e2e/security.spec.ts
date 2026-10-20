import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";
import { grantTestStaff } from "./staff-fixture";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Security tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1",
  tokens: Record<string, string> = {};
async function login(request: APIRequestContext, uid: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      data: {
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        returnSecureToken: true,
      },
    },
  );
  return (await response.json()).idToken as string;
}
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown = {},
  account = "phase7-elder",
  status: number | number[] = 200,
  origin = "http://localhost:5174",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: {
      ...(tokens[account]
        ? { Authorization: `Bearer ${tokens[account]}` }
        : {}),
      Origin: origin,
    },
    data: { data },
  });
  const body = await response.json();
  expect(
    Array.isArray(status) ? status : [status],
    JSON.stringify(body),
  ).toContain(response.status());
  return body.result;
}
// The Firebase Auth accounts a page keeps in IndexedDB, localStorage and sessionStorage.
async function storedAccounts(page: Page) {
  const stored = await page.evaluate(async () => {
    const indexed = (await indexedDB.databases()).some(
      (row) => row.name === "firebaseLocalStorageDb",
    )
      ? await new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open("firebaseLocalStorageDb");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            if (!database.objectStoreNames.contains("firebaseLocalStorage")) {
              database.close();
              return resolve([]);
            }
            const keys = database
              .transaction("firebaseLocalStorage", "readonly")
              .objectStore("firebaseLocalStorage")
              .getAllKeys();
            keys.onerror = () => reject(keys.error);
            keys.onsuccess = () => {
              database.close();
              resolve(keys.result.map(String));
            };
          };
        })
      : [];
    return {
      indexed,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    };
  });
  const users = (keys: string[]) =>
    keys.filter((key) => key.startsWith("firebase:authUser:"));
  return {
    indexed: users(stored.indexed),
    local: users(stored.local),
    session: users(stored.session),
  };
}
test.beforeAll(async ({ request }) => {
  for (const [uid, roles] of [
    ["phase7-elder", ["elder"]],
    ["phase7-admin", ["admin"]],
    ["phase7-deacon", ["deacon"]],
    ["phase7-unassured", ["elder"]],
    ["phase7-passkey", ["elder"]],
  ] as const) {
    await auth.getUser(uid).catch(() =>
      auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        emailVerified: true,
      }),
    );
    if (uid !== "phase7-unassured") await grantTestStaff(uid, roles);
    else await auth.setCustomUserClaims(uid, { roles: [...roles] });
    tokens[uid] = await login(request, uid);
  }
  tokens.pastor = (
    await (
      await request.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
        {
          data: {
            email: "pastor@example.test",
            password: "LocalDemo123!",
            returnSecureToken: true,
          },
        },
      )
    ).json()
  ).idToken;
});
test("rejects an unenrolled account even when it claims a staff role or submits an assurance flag", async ({
  request,
}) => {
  await call(
    request,
    "getPrivateRecords",
    { collection: "careNotes" },
    "phase7-unassured",
    403,
  );
  await call(request, "activateStaffAccess", {}, "phase7-unassured", 403);
  await call(
    request,
    "saveChurchSettings",
    {
      expectedRevision: 0,
      name: "Forged",
      address: "",
      timeZone: "UTC",
      assured: true,
    },
    "phase7-unassured",
    403,
  );
  expect((await db.doc("staffAccess/phase7-unassured").get()).exists).toBe(
    false,
  );
});
test("encrypts care text and discipline, audits reads and protects them from non-Session accounts", async ({
  request,
}) => {
  const id = `phase7-${randomBytes(6).toString("hex")}`,
    body = "Fictional confidential conversation for encryption test";
  await call(request, "saveCareNote", {
    id,
    expectedRevision: 0,
    personId: "james",
    kind: "visit",
    date: "2026-10-18",
    body,
  });
  const stored = (await db.doc(`careNotes/${id}`).get()).data()!;
  expect(stored.body).toBeUndefined();
  expect(stored.encrypted.v).toBe(1);
  expect(JSON.stringify(stored)).not.toContain(body);
  const result = await call(request, "getPrivateRecords", {
    collection: "careNotes",
  });
  expect(result.rows.find((row: { id: string }) => row.id === id).body).toBe(
    body,
  );
  const report = await call(request, "getPrivateRecords", {
    collection: "careNotes",
    view: "report",
  });
  expect(
    report.rows.find((row: { id: string }) => row.id === id).body,
  ).toBeUndefined();
  for (const account of ["phase7-admin", "phase7-deacon"])
    await call(
      request,
      "getPrivateRecords",
      { collection: "careNotes" },
      account,
      403,
    );
  const logs = await call(request, "getSecurityEvents", { scope: "session" });
  expect(
    logs.events.some(
      (row: { target: string }) => row.target === `careNotes/${id}`,
    ),
  ).toBe(true);
  await call(
    request,
    "getSecurityEvents",
    { scope: "session" },
    "phase7-admin",
    403,
  );
  await db.doc(`careNotes/${id}`).delete();
});
test("migrates legacy plaintext once, preserves revision checks and resumes safely", async ({
  request,
}) => {
  const id = "phase7-legacy",
    ref = db.doc(`careNotes/${id}`);
  await ref.set({
    personId: "james",
    kind: "note",
    date: "2026-10-18",
    body: "Fictional legacy note",
    revision: 4,
  });
  await call(
    request,
    "migratePrivateRecords",
    { collection: "careNotes", backupConfirmed: true },
    "phase7-admin",
    403,
  );
  let after = "";
  do {
    const page = await call(
      request,
      "migratePrivateRecords",
      { collection: "careNotes", after, backupConfirmed: true },
      "pastor",
    );
    after = page.next;
  } while (after);
  expect((await ref.get()).get("body")).toBeUndefined();
  expect((await ref.get()).get("revision")).toBe(4);
  await call(
    request,
    "saveCareNote",
    {
      id,
      personId: "james",
      kind: "note",
      date: "2026-10-18",
      body: "Updated fictional note",
      expectedRevision: 3,
    },
    "phase7-elder",
    409,
  );
  await call(request, "saveCareNote", {
    id,
    personId: "james",
    kind: "note",
    date: "2026-10-18",
    body: "Updated fictional note",
    expectedRevision: 4,
  });
  expect((await ref.get()).get("body")).toBeUndefined();
  expect((await ref.get()).get("revision")).toBe(5);
  await ref.delete();
});
test("binds desktop handoff to its verifier, consumes it once and rejects replay", async ({
  request,
}) => {
  const id = randomBytes(32).toString("hex"),
    verifier = randomBytes(32).toString("hex"),
    challenge = createHash("sha256").update(verifier).digest("hex");
  await call(request, "approveDesktopSignIn", { id, challenge });
  await call(
    request,
    "completeDesktopSignIn",
    { id, verifier: "b".repeat(64) },
    "anonymous",
    403,
  );
  const result = await call(
    request,
    "completeDesktopSignIn",
    { id, verifier },
    "anonymous",
  );
  expect(result.token).toBeTruthy();
  await call(
    request,
    "completeDesktopSignIn",
    { id, verifier },
    "anonymous",
    403,
  );
  await call(
    request,
    "beginPasskeySignIn",
    { email: "phase7-elder@example.test" },
    "anonymous",
    403,
    "https://attacker.invalid",
  );
});
test("confirms in the browser only as the account already signed in on the desktop", async ({
  request,
}) => {
  function handoff() {
    const verifier = randomBytes(32).toString("hex");
    return {
      id: randomBytes(32).toString("hex"),
      verifier,
      challenge: createHash("sha256").update(verifier).digest("hex"),
    };
  }
  const uidOf = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))
      .uid as string;
  const sessions = async (uid: string) =>
    (
      await db.collection("staffSessions").where("uid", "==", uid).count().get()
    ).data().count;
  async function complete(data: object, account?: string) {
    const response = await request.post(`${base}/completeDesktopSignIn`, {
      headers: {
        ...(account ? { Authorization: `Bearer ${tokens[account]}` } : {}),
        Origin: "http://localhost:5174",
      },
      data: { data },
    });
    return { status: response.status(), body: await response.json() };
  }
  // Another account approves; the account signed in on the desktop cannot use it.
  const other = handoff(),
    before = await sessions("phase7-admin");
  await call(
    request,
    "approveDesktopSignIn",
    { id: other.id, challenge: other.challenge },
    "phase7-admin",
  );
  const refused = await complete(
    { id: other.id, verifier: other.verifier, sameAccount: true },
    "phase7-elder",
  );
  expect(refused.status).toBe(403);
  expect(refused.body.error.message).toBe(
    "Approve with the account signed in on this PC.",
  );
  expect(refused.body.result).toBeUndefined();
  expect(await sessions("phase7-admin")).toBe(before);
  // The refused approval is used up.
  expect(
    (await complete({ id: other.id, verifier: other.verifier })).status,
  ).toBe(403);
  // Confirming needs someone signed in on the desktop.
  const unsigned = handoff();
  await call(request, "approveDesktopSignIn", {
    id: unsigned.id,
    challenge: unsigned.challenge,
  });
  const anonymous = await complete({
    id: unsigned.id,
    verifier: unsigned.verifier,
    sameAccount: true,
  });
  expect(anonymous.status).toBe(403);
  expect(anonymous.body.result).toBeUndefined();
  // The same account confirms.
  const same = handoff();
  const waiting = await complete(
    { id: same.id, verifier: same.verifier, sameAccount: true },
    "phase7-elder",
  );
  expect(waiting.body.result).toEqual({ pending: true });
  await call(request, "approveDesktopSignIn", {
    id: same.id,
    challenge: same.challenge,
  });
  const confirmed = await complete(
    { id: same.id, verifier: same.verifier, sameAccount: true },
    "phase7-elder",
  );
  expect(confirmed.status).toBe(200);
  expect(uidOf(confirmed.body.result.token)).toBe("phase7-elder");
  // The sign-in screen still accepts whichever account approves.
  const signIn = handoff();
  await call(
    request,
    "approveDesktopSignIn",
    { id: signIn.id, challenge: signIn.challenge },
    "phase7-admin",
  );
  const switched = await complete(
    { id: signIn.id, verifier: signIn.verifier },
    "phase7-elder",
  );
  expect(switched.status).toBe(200);
  expect(uidOf(switched.body.result.token)).toBe("phase7-admin");
});
test("allows no self-role grant or non-Session administrator factor reset of Session", async ({
  request,
}) => {
  await call(
    request,
    "setUserRoles",
    { uid: "phase7-admin", roles: ["admin", "elder"] },
    "phase7-admin",
    403,
  );
  await call(
    request,
    "manageStaffAccount",
    { uid: "phase7-elder", action: "recover" },
    "phase7-admin",
    403,
  );
  await call(
    request,
    "manageStaffAccount",
    { uid: "phase7-admin", action: "disable" },
    "phase7-admin",
    400,
  );
});
test("closes revoked accounts immediately and permits only fresh assurance to reactivate", async ({
  request,
}) => {
  await call(
    request,
    "manageStaffAccount",
    { uid: "phase7-deacon", action: "revoke" },
    "phase7-admin",
  );
  await call(
    request,
    "getPrivateRecords",
    { collection: "diaconalTasks" },
    "phase7-deacon",
    [401, 403],
  );
  await call(request, "activateStaffAccess", {}, "phase7-deacon", [401, 403]);
});
test("registers and verifies a real WebAuthn assertion with a virtual authenticator", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("http://localhost:5174/staff-security");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("phase7-passkey@example.test");
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Passkey added.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByLabel("Passkey account email")
    .fill("phase7-passkey@example.test");
  await page
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await expect(
    page.getByText(
      "Signed in as phase7-passkey@example.test. Staff access is verified.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase7-passkeys.png",
    fullPage: true,
  });
});
test("a passkey sign-in on the church security page lasts only for this tab", async ({
  browser,
}) => {
  const uid = "phase7-passkey-tab",
    email = `${uid}@example.test`,
    signedIn = `Signed in as ${email}. Staff access is verified.`;
  await auth.getUser(uid).catch(() =>
    auth.createUser({
      uid,
      email,
      password: "LocalDemo123!",
      emailVerified: true,
    }),
  );
  await grantTestStaff(uid, ["elder"]);
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("http://localhost:5174/staff-security");
  // A browser page never offers to keep a staff sign-in.
  await expect(
    page.getByRole("checkbox", { name: "Keep this PC signed in" }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Passkey added.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // A fresh load starts from the portal's own default, as a borrowed browser would.
  await page.reload();
  await page.getByLabel("Passkey account email").fill(email);
  await page
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await expect(page.getByText(signedIn)).toBeVisible();
  const stored = await storedAccounts(page);
  expect(stored.indexed).toEqual([]);
  expect(stored.local).toEqual([]);
  expect(stored.session).toHaveLength(1);
  // Another tab in the same browser does not share the sign-in.
  const other = await context.newPage();
  await other.goto("http://localhost:5174/staff-security");
  // The sign-in form shows while Firebase restores any stored account, so give it time.
  await other.waitForTimeout(2000);
  await expect(
    other.getByRole("button", { name: "Sign in with passkey", exact: true }),
  ).toBeVisible();
  await expect(other.getByText(/^Signed in as/)).toHaveCount(0);
  await other.close();
  // Reloading this tab keeps it signed in.
  await page.reload();
  await expect(page.getByText(signedIn)).toBeVisible();
  await context.close();
});
// Signs in on the desktop sign-in screen through the church security page, as a
// person at the booth PC would, with Keep this PC signed in ticked or not.
async function desktopBrowserSignIn(browser: Browser, keep: boolean) {
  const uid = `phase7-handoff-${keep ? "kept" : "closed"}`,
    email = `${uid}@example.test`;
  await auth.getUser(uid).catch(() =>
    auth.createUser({
      uid,
      email,
      password: "LocalDemo123!",
      emailVerified: true,
    }),
  );
  await grantTestStaff(uid, ["elder"]);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("/");
    const keepBox = page.getByRole("checkbox", {
      name: "Keep this PC signed in",
    });
    await expect(keepBox).not.toBeChecked();
    if (keep) await keepBox.check();
    const opened = context.waitForEvent("page");
    await page
      .getByRole("button", {
        name: "Sign in with browser or passkey",
        exact: true,
      })
      .click();
    const security = await opened;
    const notice = page.getByText(/^Finish sign-in in your browser/);
    await expect(notice).toBeVisible();
    const code = /code: ([a-f0-9]{8})\./.exec(
      (await notice.textContent()) || "",
    )?.[1];
    expect(code).toBeTruthy();
    await security
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(email);
    await security.getByLabel(/^Password/).fill("LocalDemo123!");
    await security
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(security.getByText(code!, { exact: true })).toBeVisible();
    await security
      .getByRole("checkbox", { name: "This code matches the app on my own PC" })
      .check();
    await security
      .getByRole("button", { name: "Approve desktop sign-in", exact: true })
      .click();
    await expect(
      security.getByText("Approved. Return to the desktop app."),
    ).toBeVisible();
    await security.close();
    await expect(
      page.getByRole("heading", { name: "Take attendance" }),
    ).toBeVisible();
    const stored = await storedAccounts(page);
    // A new page starts with empty sessionStorage, as reopening the app does.
    const reopened = await context.newPage();
    await reopened.goto("/");
    if (keep) {
      expect(stored.session).toEqual([]);
      expect([...stored.indexed, ...stored.local]).toHaveLength(1);
      await expect(
        reopened.getByRole("heading", { name: "Take attendance" }),
      ).toBeVisible();
    } else {
      expect(stored.indexed).toEqual([]);
      expect(stored.local).toEqual([]);
      expect(stored.session).toHaveLength(1);
      // The sign-in screen shows while Firebase restores any stored account, so give it time.
      await reopened.waitForTimeout(2000);
      await expect(
        reopened.getByRole("button", {
          name: "Sign in with browser or passkey",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        reopened.getByRole("heading", { name: "Take attendance" }),
      ).toHaveCount(0);
    }
  } finally {
    await context.close();
    await auth.deleteUser(uid).catch(() => undefined);
    const rows = [
      db.doc(`staffAccess/${uid}`),
      ...(
        await db.collection("staffSessions").where("uid", "==", uid).get()
      ).docs.map((row) => row.ref),
      ...(
        await db.collection("desktopHandoffs").where("uid", "==", uid).get()
      ).docs.map((row) => row.ref),
      ...(
        await db.collection("securityEvents").where("actorUid", "==", uid).get()
      ).docs.map((row) => row.ref),
    ];
    await Promise.all(rows.map((ref) => ref.delete()));
  }
}
test("the desktop browser sign-in lasts until the app closes when Keep this PC signed in is off", async ({
  browser,
}) => {
  await desktopBrowserSignIn(browser, false);
});
test("the desktop browser sign-in keeps the PC signed in when Keep this PC signed in is on", async ({
  browser,
}) => {
  await desktopBrowserSignIn(browser, true);
});

test("creates staff accounts, serializes security updates and recovers lost factors", async ({
  request,
  page,
}) => {
  await call(
    request,
    "createStaffAccount",
    {
      email: "phase7-no-grant@example.test",
      displayName: "Fictional Elder",
      roles: ["elder"],
    },
    "phase7-admin",
    403,
  );
  const created = await call(
    request,
    "createStaffAccount",
    {
      email: `phase7-new-${randomBytes(4).toString("hex")}@example.test`,
      displayName: "Fictional New Reader",
      roles: ["readOnly"],
    },
    "phase7-admin",
  );
  expect(created.setupLink).toBeTruthy();
  const ref = db.doc(`staffAccess/${created.uid}`);
  expect((await ref.get()).get("enabled")).toBe(false);
  await call(
    request,
    "manageStaffAccount",
    { uid: created.uid, action: "disable" },
    "phase7-admin",
  );
  expect((await auth.getUser(created.uid)).disabled).toBe(true);
  expect((await ref.get()).get("locked")).toBe(true);
  await call(
    request,
    "manageStaffAccount",
    { uid: created.uid, action: "enable" },
    "phase7-admin",
  );
  expect((await ref.get()).get("enabled")).toBe(false);
  await ref.update({ pending: true, locked: true });
  await call(
    request,
    "manageStaffAccount",
    { uid: created.uid, action: "recover" },
    "phase7-admin",
    409,
  );
  await ref.update({ pending: false, locked: false });
  await db.doc(`staffCredentials/phase7-lost-factor`).set({ uid: created.uid });
  await call(
    request,
    "manageStaffAccount",
    { uid: created.uid, action: "recover" },
    "phase7-admin",
  );
  expect(
    (await db.doc("staffCredentials/phase7-lost-factor").get()).exists,
  ).toBe(false);
  expect((await ref.get()).get("enabled")).toBe(false);
  await page.goto("/");
  await page.getByLabel("Email").fill("phase7-admin@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await expect(page.getByText("Staff accounts", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Fictional New Reader", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Session only record access" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Fictional New Reader", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit church roles", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Manage staff account" });
  await dialog
    .getByRole("checkbox", { name: "readOnly", exact: true })
    .uncheck();
  await dialog
    .getByRole("checkbox", { name: "attendanceVolunteer", exact: true })
    .check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await auth.getUser(created.uid)).customClaims?.roles)
    .toEqual(["attendanceVolunteer"]);
  await page.screenshot({
    path: "test-results/phase7-security.png",
    fullPage: true,
  });
});
