import { expect, test, type APIRequestContext } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { DateTime } from "luxon";
import { grantTestStaff } from "./staff-fixture";
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
async function passwordToken(request: APIRequestContext, email: string) {
  const response = await request.post(
    `${identity}/accounts:signInWithPassword?key=demo-key`,
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await response.json()).idToken as string;
}
async function memberToken(request: APIRequestContext, uid: string) {
  const link = await sendLink(request, `${uid}@example.test`);
  const response = await linkSignIn(request, `${uid}@example.test`, link.code);
  expect(response.status()).toBe(200);
  return (await response.json()).idToken as string;
}
// A 1x1 PNG, which the browser can decode and scale.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 1),
]);
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
const saved = new Map<string, FirebaseFirestore.DocumentData | undefined>();
const restored = [
  "people/james",
  "people/grace",
  "households/calder",
  "attendanceRoster/james",
  "directoryPreferences/james",
  "directoryPreferences/grace",
];
test.afterAll(async () => {
  for (const path of restored) {
    const data = saved.get(path);
    if (data) await db.doc(path).set(data);
    else await db.doc(path).delete();
  }
});
test.beforeAll(async () => {
  for (const path of restored)
    saved.set(path, (await db.doc(path).get()).data());
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

test.describe("member details", () => {
  test.beforeEach(async () => {
    await db.doc("portalAccess/link-other").set({
      personId: "grace",
      enabled: true,
      revision: 1,
    });
    await db.doc("people/james").update({
      preferredName: "",
      email: "james@example.test",
      mobilePhone: "+12025550101",
      emailOptIn: true,
      smsOptIn: true,
      birthDate: "1980-05-01",
      photoPath: FieldValue.delete(),
    });
    await db.doc("people/grace").update({
      isDeceased: false,
      membershipStatus: "baptized",
      birthDate: DateTime.now().minus({ years: 10 }).toISODate(),
      photoPath: FieldValue.delete(),
    });
    await db
      .doc("households/calder")
      .update({ address: "1 Fictional Way", homePhone: "" });
    await db.doc("directoryPreferences/james").delete();
  });

  test("changes only the member's own contact fields and never turns texts on", async ({
    request,
  }) => {
    const token = await memberToken(request, "link-member");
    const result = await call(request, token, "saveMyContact", {
      changes: { mobilePhone: "(202) 555-0199", preferredName: "Jim" },
      expected: { mobilePhone: "+12025550101", preferredName: "" },
    });
    expect(result.textsStopped).toBe(true);
    const james = (await db.doc("people/james").get()).data()!;
    expect(james).toMatchObject({
      mobilePhone: "+12025550199",
      preferredName: "Jim",
      smsOptIn: false,
      emailOptIn: true,
      updatedBy: "link-member",
    });
    expect(
      (await db.doc("attendanceRoster/james").get()).get("preferredName"),
    ).toBe("Jim");
    const consent = await db
      .collection("consentEvents")
      .where("personId", "==", "james")
      .where("actor", "==", "link-member")
      .get();
    expect(consent.docs.map((row) => row.get("optedIn"))).toContain(false);

    // A stale form for the same field is refused.
    await call(
      request,
      token,
      "saveMyContact",
      {
        changes: { mobilePhone: "+12025550188" },
        expected: { mobilePhone: "+12025550101" },
      },
      409,
    );
    // Consent, status, another person or unknown fields cannot be sent.
    for (const data of [
      { changes: { smsOptIn: true }, expected: { smsOptIn: false } },
      {
        changes: { membershipStatus: "former" },
        expected: { membershipStatus: "communicant" },
      },
      {
        personId: "ruth",
        changes: { email: "x@example.test" },
        expected: { email: "ruth@example.test" },
      },
    ])
      await call(request, token, "saveMyContact", data, 400);
    // Changing the email keeps email consent and is a plain field edit.
    await call(request, token, "saveMyContact", {
      changes: { email: "James.New@Example.test" },
      expected: { email: "james@example.test" },
    });
    expect((await db.doc("people/james").get()).data()).toMatchObject({
      email: "james.new@example.test",
      emailOptIn: true,
      smsOptIn: false,
    });
  });

  test("lets an adult change the household address and refuses a child", async ({
    request,
  }) => {
    const adult = await memberToken(request, "link-member");
    const child = await memberToken(request, "link-other");
    expect((await call(request, adult, "portalMe")).household.canEdit).toBe(
      true,
    );
    expect((await call(request, child, "portalMe")).household.canEdit).toBe(
      false,
    );
    await call(
      request,
      child,
      "saveMyHousehold",
      {
        changes: { address: "9 Elsewhere Road" },
        expected: { address: "1 Fictional Way" },
      },
      403,
    );
    await call(request, adult, "saveMyHousehold", {
      changes: { address: "22 New Street" },
      expected: { address: "1 Fictional Way" },
    });
    expect((await db.doc("households/calder").get()).data()).toMatchObject({
      address: "22 New Street",
      updatedBy: "link-member",
    });
    await call(
      request,
      adult,
      "saveMyHousehold",
      {
        changes: { address: "23 New Street" },
        expected: { address: "1 Fictional Way" },
      },
      409,
    );
    // Without a recorded birth date the church office makes the change.
    await db.doc("people/james").update({ birthDate: "" });
    await call(
      request,
      adult,
      "saveMyHousehold",
      {
        changes: { homePhone: "2025550111" },
        expected: { homePhone: "" },
      },
      403,
    );
  });

  test("validates photos and shows them to other members only while shared", async ({
    request,
  }) => {
    const james = await memberToken(request, "link-member");
    const grace = await memberToken(request, "link-other");
    const upload = (data: Buffer, contentType = "image/jpeg") =>
      call(
        request,
        james,
        "saveMyPhoto",
        { contentType, data: data.toString("base64"), expectedPhoto: false },
        400,
      );
    await upload(Buffer.from("<html>not an image</html>"));
    await upload(png, "image/jpeg");
    await upload(Buffer.concat([jpeg, Buffer.alloc(1024 * 1024)]));
    await call(request, james, "saveMyPhoto", {
      contentType: "image/jpeg",
      data: jpeg.toString("base64"),
      expectedPhoto: false,
    });
    const first = (await db.doc("people/james").get()).get("photoPath");
    expect(first).toMatch(/^photos\/james\/[a-f0-9-]+\.jpg$/);
    expect(
      (await call(request, james, "portalPhoto", { personId: "james" })).photo,
    ).toMatch(/^data:image\/jpeg;base64,/);
    expect(
      (await call(request, grace, "portalPhoto", { personId: "james" })).photo,
    ).toBeNull();
    await db
      .doc("directoryPreferences/james")
      .set({ listed: true, sharePhoto: true, revision: 1 });
    expect(
      (await call(request, grace, "portalPhoto", { personId: "james" })).photo,
    ).toMatch(/^data:image\/jpeg;base64,/);
    const directory = await call(request, grace, "portalDirectory");
    expect(
      directory.find((row: { id: string }) => row.id === "james").hasPhoto,
    ).toBe(true);
    // Replacing removes the old file; a stale replacement is refused.
    await call(request, james, "saveMyPhoto", {
      contentType: "image/png",
      data: png.toString("base64"),
      expectedPhoto: true,
    });
    const [exists] = await getStorage().bucket().file(first).exists();
    expect(exists).toBe(false);
    await call(
      request,
      james,
      "saveMyPhoto",
      {
        contentType: "image/png",
        data: png.toString("base64"),
        expectedPhoto: false,
      },
      409,
    );
    await call(request, james, "removeMyPhoto", { expectedPhoto: true });
    expect((await db.doc("people/james").get()).get("photoPath")).toBe(
      undefined,
    );
    expect(
      (await call(request, grace, "portalPhoto", { personId: "james" })).photo,
    ).toBeNull();
  });

  test("edits details and a photo on a phone-sized screen", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const link = await sendLink(
      request,
      "link-member@example.test",
      "/?tab=profile",
    );
    await page.goto(link.url);
    await page.getByLabel("Email").fill("link-member@example.test");
    await page
      .getByRole("button", { name: "Finish signing in", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "My contact details" }),
    ).toBeVisible();
    await expect(
      page.getByText("Texts stop if you change this number."),
    ).toBeVisible();
    await page.getByLabel("Mobile phone").fill("2025550177");
    await page
      .getByRole("button", { name: "Save contact details", exact: true })
      .click();
    await expect(
      page.getByText(/Texts are off for your new number/),
    ).toBeVisible();
    await page
      .getByLabel("Add a photo")
      .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Your photo was saved.")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "My current photo" }),
    ).toBeVisible();
    await page.getByLabel("Household address").fill("5 Garden Row");
    await page
      .getByRole("button", { name: "Save household details", exact: true })
      .click();
    await expect(
      page.getByText("Your household details were saved."),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/phase10-member-details.png",
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("member requests", () => {
  const staff: Record<string, string> = {};
  test.beforeAll(async ({ request }) => {
    for (const [uid, roles] of [
      ["m10-elder", ["elder"]],
      ["m10-admin", ["admin"]],
      ["m10-deacon", ["deacon"]],
    ] as const) {
      await auth.getUser(uid).catch(() =>
        auth.createUser({
          uid,
          email: `${uid}@example.test`,
          password: "LocalDemo123!",
        }),
      );
      await grantTestStaff(uid, roles);
      staff[uid] = await passwordToken(request, `${uid}@example.test`);
    }
    staff.pastor = await passwordToken(request, "pastor@example.test");
  });
  test.beforeEach(async () => {
    for (const name of ["memberRequests", "mercyRequests", "portalBudgets"])
      await db.recursiveDelete(db.collection(name));
  });
  test.afterAll(async () => {
    for (const name of ["memberRequests", "mercyRequests", "portalBudgets"])
      await db.recursiveDelete(db.collection(name));
  });

  test("sends prayer requests only to the Session and shows the member their progress", async ({
    request,
  }) => {
    const member = await memberToken(request, "link-member");
    const prayer = {
      requestId: crypto.randomUUID(),
      kind: "prayer",
      body: "Fictional prayer for a job interview",
    };
    await call(request, member, "submitMemberRequest", prayer);
    // A retried send is received once and counts once.
    await call(request, member, "submitMemberRequest", prayer);
    const stored = await db.doc(`memberRequests/${prayer.requestId}`).get();
    expect(stored.get("body")).toBeUndefined();
    expect(stored.get("encrypted")).toBeTruthy();
    expect(stored.get("personId")).toBe("james");
    expect(
      (await db.collection("portalBudgets").get()).docs[0].get("count"),
    ).toBe(1);

    const records = await call(
      request,
      staff["m10-elder"],
      "getPrivateRecords",
      {
        collection: "memberRequests",
      },
    );
    expect(records.rows).toMatchObject([
      { id: prayer.requestId, body: prayer.body, status: "received" },
    ]);
    for (const account of ["m10-admin", "m10-deacon"])
      await call(
        request,
        staff[account],
        "getPrivateRecords",
        { collection: "memberRequests" },
        403,
      );

    const mine = await call(request, member, "myMemberRequests");
    expect(mine).toMatchObject([
      { id: prayer.requestId, kind: "prayer", progress: "Received" },
    ]);
    expect(JSON.stringify(mine)).not.toContain("job interview");

    // Members cannot move a request; the Session can.
    await call(
      request,
      member,
      "updateMemberRequest",
      { id: prayer.requestId, expectedRevision: 1, status: "closed" },
      403,
    );
    await call(request, staff["m10-elder"], "updateMemberRequest", {
      id: prayer.requestId,
      expectedRevision: 1,
      status: "acknowledged",
    });
    await call(
      request,
      staff["m10-elder"],
      "updateMemberRequest",
      { id: prayer.requestId, expectedRevision: 1, status: "closed" },
      409,
    );
    expect((await call(request, member, "myMemberRequests"))[0].progress).toBe(
      "Received by the Session",
    );
  });

  test("routes practical help to deacon triage without exposing details to the member or unassigned officers", async ({
    request,
  }) => {
    const member = await memberToken(request, "link-member");
    const help = {
      requestId: crypto.randomUUID(),
      kind: "practical",
      body: "Fictional rides to physical therapy",
      category: "transport",
      urgent: true,
      neededBy: "",
    };
    await call(request, member, "submitMemberRequest", help);
    const stored = await db.doc(`mercyRequests/${help.requestId}`).get();
    expect(stored.data()).toMatchObject({
      householdId: "calder",
      personId: "james",
      category: "transport",
      status: "new",
      source: "member",
      deaconUids: [],
    });
    expect(stored.get("details")).toBeUndefined();
    expect(
      await db.doc(`memberRequests/${help.requestId}`).get(),
    ).toHaveProperty("exists", false);

    // The elder triages without reading the details. An unassigned deacon sees nothing.
    const elder = await call(request, staff["m10-elder"], "getMercyWorkspace");
    const row = elder.requests.find(
      (value: { id: string }) => value.id === help.requestId,
    );
    expect(row).toMatchObject({ source: "member", status: "new" });
    expect(row.details).toBeUndefined();
    const deacon = await call(
      request,
      staff["m10-deacon"],
      "getMercyWorkspace",
    );
    expect(
      deacon.requests.some(
        (value: { id: string }) => value.id === help.requestId,
      ),
    ).toBe(false);
    await call(request, staff.pastor, "triageMercyRequest", {
      id: help.requestId,
      expectedRevision: 1,
      action: "approve",
      deaconUids: ["m10-deacon"],
    });
    const assigned = await call(
      request,
      staff["m10-deacon"],
      "getMercyWorkspace",
    );
    expect(
      assigned.requests.find(
        (value: { id: string }) => value.id === help.requestId,
      ).details,
    ).toBe(help.body);

    const mine = await call(request, member, "myMemberRequests");
    expect(mine).toEqual([
      {
        id: help.requestId,
        kind: "practical",
        category: "transport",
        submittedAt: expect.any(String),
        progress: "Deacons assigned",
      },
    ]);
    // A request officers raised for the same person is not the member's own.
    await db.doc("mercyRequests/officer-raised").set({
      householdId: "calder",
      personId: "james",
      category: "meals",
      status: "new",
      deaconUids: [],
      createdAt: Timestamp.now(),
    });
    expect(await call(request, member, "myMemberRequests")).toHaveLength(1);
  });

  test("limits requests per member per day", async ({ request }) => {
    const member = await memberToken(request, "link-member");
    for (let count = 0; count < 5; count++)
      await call(request, member, "submitMemberRequest", {
        requestId: crypto.randomUUID(),
        kind: "pastoral",
        body: `Fictional request ${count}`,
      });
    await call(
      request,
      member,
      "submitMemberRequest",
      {
        requestId: crypto.randomUUID(),
        kind: "pastoral",
        body: "One too many",
      },
      429,
    );
    // An unlinked account cannot send at all.
    const other = await memberToken(request, "link-other");
    await db.doc("portalAccess/link-other").delete();
    await call(
      request,
      other,
      "submitMemberRequest",
      { requestId: crypto.randomUUID(), kind: "prayer", body: "Not linked" },
      403,
    );
  });

  test("explains the audience before sending and the Session acknowledges it in the desktop", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const link = await sendLink(
      request,
      "link-member@example.test",
      "/?tab=requests",
    );
    await page.goto(link.url);
    await page.getByLabel("Email").fill("link-member@example.test");
    await page
      .getByRole("button", { name: "Finish signing in", exact: true })
      .click();
    await expect(
      page.getByText(/Who reads this: Read by the Session/),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Practical help" }).check();
    await expect(
      page.getByText(/Who reads this: Read by the deacons assigned to help/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send to the deacons", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Prayer request" }).check();
    await page.getByLabel("Your request").fill("Fictional prayer for travel");
    await page
      .getByRole("button", { name: "Send to the Session", exact: true })
      .click();
    await expect(
      page.getByText("Your request was sent to the Session."),
    ).toBeVisible();
    await expect(page.getByText(/Received$/)).toBeVisible();
    await page.screenshot({
      path: "test-results/phase10-member-requests.png",
      fullPage: true,
      animations: "disabled",
    });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("http://127.0.0.1:5173");
    await page.getByLabel("Email").fill("pastor@example.test");
    await page.getByLabel("Password").fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: /Pastoral care/ }).click();
    await page.getByRole("tab", { name: "Member requests (1)" }).click();
    await expect(page.getByText("Fictional prayer for travel")).toBeVisible();
    await page
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Member requests", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/· Acknowledged/)).toBeVisible();
  });
});
