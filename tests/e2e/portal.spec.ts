import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { DateTime } from "luxon";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Portal tests require emulators");
if (!getApps().length)
  initializeApp({
    projectId: "demo-sycamore",
    storageBucket: "demo-sycamore.appspot.com",
  });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
const tokens: Record<string, string> = {};
const day = DateTime.now()
  .setZone("America/Indiana/Indianapolis")
  .plus({ days: 7 })
  .set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
const date = day.toISODate()!;
async function token(request: APIRequestContext, email: string) {
  const result = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await result.json()).idToken as string;
}
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown = {},
  status = 200,
  account = "pastor",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: tokens[account]
      ? { Authorization: `Bearer ${tokens[account]}` }
      : {},
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
test.beforeAll(async ({ request }) => {
  tokens.pastor = await token(request, "pastor@example.test");
  for (const [id, verified] of [
    ["member-james", true],
    ["member-ruth", true],
    ["unlinked", true],
    ["unverified", false],
  ] as const) {
    const user = await auth
      .getUser(id)
      .catch(() =>
        auth.createUser({
          uid: id,
          email: `${id}@example.test`,
          password: "LocalDemo123!",
          emailVerified: verified,
        }),
      );
    await auth.updateUser(user.uid, {
      emailVerified: verified,
      disabled: false,
    });
    await auth.setCustomUserClaims(user.uid, {});
    tokens[id] = await token(request, `${id}@example.test`);
  }
});
test.beforeEach(async () => {
  for (const name of [
    "portalAccess",
    "directoryPreferences",
    "eventPublications",
    "onlineSubmissions",
    "portalBudgets",
    "events",
  ])
    await db.recursiveDelete(db.collection(name));
  await db
    .doc("portalAccess/member-james")
    .set({ personId: "james", enabled: true, revision: 1 });
  await db
    .doc("portalAccess/member-ruth")
    .set({ personId: "ruth", enabled: true, revision: 1 });
  await db
    .doc("portalAccess/unverified")
    .set({ personId: "james", enabled: true, revision: 1 });
  await db
    .doc("people/james")
    .update({
      isDeceased: false,
      membershipStatus: "communicant",
      email: "pastor@example.test",
      mobilePhone: "+12025550101",
      emailOptIn: false,
      smsOptIn: false,
    });
  await db
    .doc("people/ruth")
    .update({
      isDeceased: false,
      membershipStatus: "communicant",
      email: "ruth@example.test",
      mobilePhone: "+12025550102",
    });
  await db
    .doc("events/meal")
    .set({
      title: "Congregational meal",
      start: Timestamp.fromDate(day.toJSDate()),
      end: Timestamp.fromDate(day.plus({ hours: 2 }).toJSDate()),
      recurrence: "none",
      interval: 1,
      until: "",
      location: "Fellowship hall",
      capacity: 1,
      cancelled: false,
      revision: 1,
    });
});
const visitor = (overrides: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  kind: "visitor",
  firstName: "Mara",
  lastName: "Willow",
  email: "mara@example.test",
  mobilePhone: "+12025550155",
  message: "Planning a first visit.",
  eventId: "",
  date: "",
  website: "",
  ...overrides,
});
const publish = (request: APIRequestContext, publicRegistration = true) =>
  call(request, "publishPortalEvent", {
    eventId: "meal",
    portalVisible: true,
    publicRegistration,
    description: "A church gathering for fellowship.",
    expectedRevision: 0,
  });
test("requires verified, active, administrator-linked access and honors revocation with the same token", async ({
  request,
}) => {
  await call(request, "portalMe", {}, 401, "anonymous");
  await call(request, "portalMe", {}, 403, "unlinked");
  await call(request, "portalMe", {}, 403, "unverified");
  expect(
    (await call(request, "portalMe", {}, 200, "member-james")).person.name,
  ).toBe("James Calder");
  await call(request, "setPortalAccess", {
    uid: "member-james",
    personId: "james",
    enabled: false,
    expectedRevision: 1,
  });
  await call(request, "portalDirectory", {}, 403, "member-james");
  await call(
    request,
    "setPortalAccess",
    {
      uid: "member-ruth",
      personId: "ruth",
      enabled: true,
      expectedRevision: 1,
    },
    403,
    "member-james",
  );
});
test("starts directory sharing off, returns only consented fields and prevents writing another person's preferences", async ({
  request,
}) => {
  expect(
    await call(request, "portalDirectory", {}, 200, "member-james"),
  ).toEqual([]);
  await call(
    request,
    "saveDirectoryPreferences",
    {
      listed: true,
      shareEmail: true,
      sharePhone: false,
      shareAddress: false,
      expectedRevision: 0,
    },
    200,
    "member-ruth",
  );
  const rows = await call(request, "portalDirectory", {}, 200, "member-james");
  expect(rows).toEqual([
    {
      id: "ruth",
      name: "Ruth Calder",
      email: "ruth@example.test",
      phone: "",
      address: "",
    },
  ]);
  expect(JSON.stringify(rows)).not.toMatch(
    /birthDate|membershipStatus|discipline/,
  );
  await call(
    request,
    "saveDirectoryPreferences",
    { listed: true, personId: "james" },
    400,
    "member-ruth",
  );
  await call(
    request,
    "saveDirectoryPreferences",
    { listed: false, expectedRevision: 1 },
    200,
    "member-ruth",
  );
  expect(
    await call(request, "portalDirectory", {}, 200, "member-james"),
  ).toEqual([]);
  await call(
    request,
    "saveDirectoryPreferences",
    { listed: true, expectedRevision: 0 },
    409,
    "member-ruth",
  );
});
test("exposes only published events and reserves RSVP capacity only for the signed-in person's identity", async ({
  request,
}) => {
  expect(
    await call(request, "portalPublicEvents", {}, 200, "anonymous"),
  ).toEqual([]);
  await publish(request, false);
  expect(
    await call(request, "portalPublicEvents", {}, 200, "anonymous"),
  ).toEqual([]);
  expect(
    await call(request, "portalMemberEvents", {}, 200, "member-james"),
  ).toHaveLength(1);
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "yes", personId: "ruth" },
    400,
    "member-james",
  );
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "yes" },
    200,
    "member-james",
  );
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "yes" },
    429,
    "member-ruth",
  );
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "no" },
    200,
    "member-james",
  );
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "yes" },
    200,
    "member-ruth",
  );
  expect(
    (await db.doc(`events/meal/rsvps/${date}_ruth`).get()).get("personId"),
  ).toBe("ruth");
});
test("stores public requests once, ignores honeypots, and creates a consent-off visitor only after staff approval", async ({
  request,
}) => {
  const input = visitor();
  await call(request, "submitOnlineForm", input, 200, "anonymous");
  await call(request, "submitOnlineForm", input, 200, "anonymous");
  expect((await db.collection("onlineSubmissions").get()).size).toBe(1);
  await call(
    request,
    "submitOnlineForm",
    visitor({ website: "spam.invalid" }),
    200,
    "anonymous",
  );
  expect((await db.collection("onlineSubmissions").get()).size).toBe(1);
  await call(
    request,
    "reviewOnlineSubmission",
    { id: input.requestId, action: "approve" },
    403,
    "member-james",
  );
  await call(request, "reviewOnlineSubmission", {
    id: input.requestId,
    action: "approve",
  });
  const personId = (
    await db.doc(`onlineSubmissions/${input.requestId}`).get()
  ).get("approvedPersonId");
  expect((await db.doc(`people/${personId}`).get()).data()).toMatchObject({
    firstName: "Mara",
    membershipStatus: "visitor",
    emailOptIn: false,
    smsOptIn: false,
  });
  expect(
    (await db.collection(`people/${personId}/membershipEvents`).get()).size,
  ).toBe(1);
  await call(request, "reviewOnlineSubmission", {
    id: input.requestId,
    action: "approve",
  });
  expect(
    (
      await db
        .collection("people")
        .where("email", "==", "mara@example.test")
        .get()
    ).size,
  ).toBe(1);
});
test("keeps public event requests pending until a capacity-checked review and stops closed event forms", async ({
  request,
}) => {
  await publish(request);
  const input = visitor({ kind: "event", eventId: "meal", date });
  await call(request, "submitOnlineForm", input, 200, "anonymous");
  expect((await db.collection("events/meal/rsvps").get()).empty).toBe(true);
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "yes" },
    200,
    "member-james",
  );
  await call(
    request,
    "reviewOnlineSubmission",
    { id: input.requestId, action: "approve", personId: "ruth" },
    429,
  );
  expect(
    (await db.doc(`onlineSubmissions/${input.requestId}`).get()).get("status"),
  ).toBe("pending");
  await call(
    request,
    "portalRsvp",
    { eventId: "meal", date, status: "no" },
    200,
    "member-james",
  );
  await call(request, "reviewOnlineSubmission", {
    id: input.requestId,
    action: "approve",
    personId: "ruth",
  });
  await call(request, "publishPortalEvent", {
    eventId: "meal",
    portalVisible: true,
    publicRegistration: false,
    description: "Closed",
    expectedRevision: 1,
  });
  await call(
    request,
    "submitOnlineForm",
    visitor({ kind: "event", eventId: "meal", date }),
    400,
    "anonymous",
  );
});
test("throttles public requests without retaining a raw network address", async ({
  request,
}) => {
  for (let i = 0; i < 8; i++)
    await call(
      request,
      "submitOnlineForm",
      visitor({ email: `mara${i}@example.test` }),
      200,
      "anonymous",
    );
  await call(request, "submitOnlineForm", visitor(), 429, "anonymous");
  const budgets = await db.collection("portalBudgets").get();
  expect(budgets.size).toBe(1);
  expect(JSON.stringify(budgets.docs[0].data())).not.toMatch(
    /127\.0\.0\.1|::1/,
  );
});
async function portalLogin(page: Page) {
  await page.goto("http://127.0.0.1:5174");
  await page.getByRole("tab", { name: "Member sign in", exact: true }).click();
  await page.getByLabel("Email").fill("member-james@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, James Calder", exact: true }),
  ).toBeVisible();
}
test("supports mobile member sharing and RSVP without exposing the staff shell", async ({
  page,
  request,
}) => {
  await publish(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await portalLogin(page);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("tab", { name: "My sharing choices", exact: true })
    .click();
  await page.getByLabel("Include my name in the member directory").check();
  await page.getByLabel("Share my email with members").check();
  await page
    .getByRole("button", { name: "Save sharing choices", exact: true })
    .click();
  await expect(
    page.getByText("Your directory sharing choices were saved.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Directory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "James Calder", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "pastor@example.test", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase4-member-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("tab", { name: "Events & my RSVPs", exact: true })
    .click();
  await page
    .getByLabel(`My response for Congregational meal ${date}`)
    .selectOption("yes");
  await expect(
    page.getByText("Your RSVP was saved.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Life together, throughout the week",
      exact: true,
    }),
  ).toBeVisible();
});
test("submits a visitor form and reviews it in the staff desktop", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174");
  await page.getByRole("tab", { name: "Plan a visit", exact: true }).click();
  await page.getByLabel("First name").fill("Lena");
  await page.getByLabel("Last name").fill("Ashford");
  await page.getByLabel("Email").fill("lena@example.test");
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(page.getByText(/Your request has been received/)).toBeVisible();
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Email").fill("pastor@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Online access", exact: true })
    .click();
  await page.getByRole("button", { name: "Lena Ashford", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve and create visitor", exact: true })
    .click();
  await expect(
    page.getByText("Request approved. Messaging consent stays unchanged.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase4-staff-review.png",
    fullPage: true,
    animations: "disabled",
  });
});
