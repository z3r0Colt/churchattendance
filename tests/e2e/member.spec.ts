import { expect, test, type APIRequestContext } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Member tests require emulators");
if (!getApps().length)
  initializeApp({
    projectId: "demo-sycamore",
    storageBucket: "demo-sycamore.appspot.com",
  });
const db = getFirestore(),
  auth = getAuth(),
  identity = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1",
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1",
  portal = "http://127.0.0.1:5174";
async function sendLink(
  request: APIRequestContext,
  email: string,
  returnTo = "/",
) {
  const continueUrl = `${portal}/?return=${encodeURIComponent(returnTo)}`;
  const response = await request.post(
    `${identity}/accounts:sendOobCode?key=demo-key`,
    {
      data: {
        requestType: "EMAIL_SIGNIN",
        email,
        continueUrl,
        canHandleCodeInApp: true,
      },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  const codes = await (
    await request.get(
      "http://127.0.0.1:9099/emulator/v1/projects/demo-sycamore/oobCodes",
    )
  ).json();
  const code = (
    codes.oobCodes as { email: string; requestType: string; oobCode: string }[]
  )
    .filter((row) => row.email === email && row.requestType === "EMAIL_SIGNIN")
    .at(-1)!.oobCode;
  return {
    code,
    url: `${continueUrl}&mode=signIn&oobCode=${code}&apiKey=demo-key&lang=en`,
  };
}
const linkSignIn = (
  request: APIRequestContext,
  email: string,
  oobCode: string,
) =>
  request.post(`${identity}/accounts:signInWithEmailLink?key=demo-key`, {
    data: { email, oobCode, returnSecureToken: true },
  });
async function call(
  request: APIRequestContext,
  token: string,
  name: string,
  data: unknown = {},
  status = 200,
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
test.beforeAll(async () => {
  for (const uid of ["link-member", "link-other"]) {
    if (!(await auth.getUser(uid).catch(() => null)))
      await auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        emailVerified: false,
      });
    await auth.setCustomUserClaims(uid, {});
  }
});
test.beforeEach(async () => {
  await db
    .doc("portalAccess/link-member")
    .set({ personId: "james", enabled: true, revision: 1 });
  await db.doc("portalAccess/link-other").delete();
  await db.doc("people/james").update({
    isDeceased: false,
    membershipStatus: "communicant",
  });
});

test("signs in once by email link and refuses reuse, unlinked accounts and unknown addresses", async ({
  request,
}) => {
  const first = await sendLink(request, "link-member@example.test");
  const response = await linkSignIn(
    request,
    "link-member@example.test",
    first.code,
  );
  expect(response.status()).toBe(200);
  const token = (await response.json()).idToken as string;
  expect((await auth.getUser("link-member")).emailVerified).toBe(true);
  const me = await call(request, token, "portalMe");
  expect(me.person.name).toBe("James Calder");
  const reused = await linkSignIn(
    request,
    "link-member@example.test",
    first.code,
  );
  expect(reused.status()).toBe(400);
  expect(await reused.text()).toContain("INVALID_OOB_CODE");

  // A verified email with no person link reaches nothing.
  const other = await sendLink(request, "link-other@example.test");
  const otherResponse = await linkSignIn(
    request,
    "link-other@example.test",
    other.code,
  );
  expect(otherResponse.status()).toBe(200);
  await call(
    request,
    (await otherResponse.json()).idToken,
    "portalMe",
    {},
    403,
  );

  // Revoking the mapping stops the same email-link token.
  await db.doc("portalAccess/link-member").update({ enabled: false });
  await call(request, token, "portalMe", {}, 403);

  // An address with no church account cannot create one through a link.
  const stranger = await sendLink(request, "stranger-link@example.test");
  const blocked = await linkSignIn(
    request,
    "stranger-link@example.test",
    stranger.code,
  );
  expect(blocked.status()).toBe(400);
  await expect(
    auth.getUserByEmail("stranger-link@example.test"),
  ).rejects.toThrow();
});

test("finishes a link sign-in in the portal and ignores a malicious return target", async ({
  page,
  request,
}) => {
  const attack = await sendLink(
    request,
    "link-member@example.test",
    "https://attacker.example/steal",
  );
  await page.goto(attack.url);
  await expect(page).toHaveURL(`${portal}/`);
  await page.getByLabel("Email").fill("link-member@example.test");
  await page
    .getByRole("button", { name: "Finish signing in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome, James Calder" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${portal}/`);
  await expect(
    page.getByRole("tab", { name: "Directory", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();

  // A spent link explains itself and offers a new one.
  await page.goto(attack.url);
  await page.getByLabel("Email").fill("link-member@example.test");
  await page
    .getByRole("button", { name: "Finish signing in", exact: true })
    .click();
  await expect(
    page.getByText(
      "This sign-in link has expired or was already used. Request a new link.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request a new link", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Send sign-in link", exact: true }),
  ).toBeVisible();

  // A known tab is kept as the return target.
  const account = await sendLink(
    request,
    "link-member@example.test",
    "/?tab=account",
  );
  await page.goto(account.url);
  await page.getByLabel("Email").fill("link-member@example.test");
  await page
    .getByRole("button", { name: "Finish signing in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My sign-in email" }),
  ).toBeVisible();
});

test("requests a sign-in link from the portal without revealing whether the account exists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(portal);
  await page.getByRole("tab", { name: "Member sign in", exact: true }).click();
  await page.getByLabel("Email").fill("link-member@example.test");
  await page
    .getByRole("button", { name: "Send sign-in link", exact: true })
    .click();
  await expect(
    page.getByText(
      /If link-member@example.test belongs to a member account, a sign-in link is on its way/,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase10-sign-in-link.png",
    fullPage: true,
    animations: "disabled",
  });
});
