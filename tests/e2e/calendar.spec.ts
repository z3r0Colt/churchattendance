import { expect, test, type APIRequestContext } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { grantTestStaff } from "./staff-fixture";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Calendar tests require emulators");
if (!getApps().length)
  initializeApp({
    projectId: "demo-sycamore",
    storageBucket: "demo-sycamore.appspot.com",
  });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1",
  zone = "America/Indiana/Indianapolis";
const tokens: Record<string, string> = {};
async function login(request: APIRequestContext, email: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await response.json()).idToken as string;
}
async function call(
  request: APIRequestContext,
  account: string,
  name: string,
  data: unknown = {},
  status = 200,
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
const feed = (request: APIRequestContext, url: string) =>
  request.get(url.replace(/^.*\/calendarFeed\//, `${base}/calendarFeed/`));
// Weekly on Lord's Day evenings from next week, for four weeks.
const first = DateTime.now()
  .setZone(zone)
  .plus({ weeks: 1 })
  .set({ weekday: 7, hour: 18, minute: 0, second: 0, millisecond: 0 });
const dates = [0, 1, 2, 3].map((week) =>
  first.plus({ weeks: week }).toISODate()!,
);
const event = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  start: Timestamp.fromDate(first.toJSDate()),
  end: Timestamp.fromDate(first.plus({ hours: 1 }).toJSDate()),
  recurrence: "weekly",
  interval: 1,
  until: dates[3],
  location: "Fellowship hall",
  capacity: 0,
  cancelled: false,
  revision: 1,
  ...extra,
});
test.beforeAll(async ({ request }) => {
  for (const [uid, roles] of [
    ["cal-elder", ["elder"]],
    ["cal-reader", ["readOnly"]],
    ["cal-volunteer", ["attendanceVolunteer"]],
  ] as const) {
    await auth.getUser(uid).catch(() =>
      auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
      }),
    );
    await grantTestStaff(uid, roles);
    tokens[uid] = await login(request, `${uid}@example.test`);
  }
  await db.doc("users/cal-elder").set({
    displayName: "Elder Ashby",
    roles: ["elder"],
    personId: "ruth",
  });
  for (const uid of ["cal-member", "cal-member-two"]) {
    await auth.getUser(uid).catch(() =>
      auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        emailVerified: true,
      }),
    );
    await auth.setCustomUserClaims(uid, {});
    tokens[uid] = await login(request, `${uid}@example.test`);
  }
});
test.beforeEach(async () => {
  for (const name of [
    "events",
    "eventPublications",
    "calendarFeeds",
    "serving",
  ])
    await db.recursiveDelete(db.collection(name));
  await db
    .doc("portalAccess/cal-member")
    .set({ personId: "james", enabled: true, revision: 1 });
  await db
    .doc("portalAccess/cal-member-two")
    .set({ personId: "ruth", enabled: true, revision: 1 });
  await db.doc("people/james").update({
    isDeceased: false,
    membershipStatus: "communicant",
  });
  await db.doc("staffAccess/cal-elder").update({ enabled: true });
  await db.doc("events/study").set(event("Evening Bible study"));
  await db.doc("events/elders").set(event("Elders planning meeting"));
  await db.doc("eventPublications/study").set({
    portalVisible: true,
    publicRegistration: false,
    publicCalendar: true,
    description: "Open to all; bring a Bible",
    revision: 1,
  });
  await db.doc("events/study/rsvps/" + `${dates[0]}_james`).set({
    eventId: "study",
    date: dates[0],
    personId: "james",
    status: "yes",
  });
  for (const [id, personId] of [
    ["usher-james", "james"],
    ["usher-ruth", "ruth"],
  ])
    await db.doc(`serving/${id}`).set({
      role: personId === "james" ? "Usher" : "Greeter",
      date: dates[1],
      time: "10:00",
      personId,
      location: "Front door",
      reminderHours: 24,
      cancelled: false,
      revision: 1,
    });
});
test.afterAll(async () => {
  // Later specs count Session officers by linked person; unlink this one.
  await db.doc("users/cal-elder").delete();
  for (const name of [
    "events",
    "eventPublications",
    "calendarFeeds",
    "serving",
  ])
    await db.recursiveDelete(db.collection(name));
});

test("cancels, moves and restores one date of a series with revision checks", async ({
  request,
}) => {
  await call(request, "cal-elder", "changeEventOccurrence", {
    eventId: "study",
    date: dates[1],
    expectedRevision: 1,
    action: "cancel",
  });
  const moved = first.plus({ weeks: 2, days: 1 });
  await call(request, "cal-elder", "changeEventOccurrence", {
    eventId: "study",
    date: dates[2],
    expectedRevision: 2,
    action: "reschedule",
    start: moved.toUTC().toISO(),
    end: moved.plus({ hours: 1 }).toUTC().toISO(),
    location: "The manse",
  });
  // A stale form, a date the series never meets and a reader are refused.
  await call(
    request,
    "cal-elder",
    "changeEventOccurrence",
    { eventId: "study", date: dates[3], expectedRevision: 2, action: "cancel" },
    409,
  );
  await call(
    request,
    "cal-elder",
    "changeEventOccurrence",
    {
      eventId: "study",
      date: first.plus({ days: 1 }).toISODate(),
      expectedRevision: 3,
      action: "cancel",
    },
    400,
  );
  await call(
    request,
    "cal-reader",
    "changeEventOccurrence",
    { eventId: "study", date: dates[3], expectedRevision: 3, action: "cancel" },
    403,
  );
  const stored = (await db.doc("events/study").get()).data()!;
  expect(stored.revision).toBe(3);
  expect(stored.exceptions[dates[1]]).toEqual({ cancelled: true });
  expect(stored.exceptions[dates[2]].location).toBe("The manse");

  // A cancelled date closes member RSVPs for that date only.
  await call(
    request,
    "cal-member",
    "portalRsvp",
    { eventId: "study", date: dates[1], status: "yes" },
    400,
  );
  await call(request, "cal-member", "portalRsvp", {
    eventId: "study",
    date: dates[3],
    status: "yes",
  });

  await call(request, "cal-elder", "changeEventOccurrence", {
    eventId: "study",
    date: dates[1],
    expectedRevision: 3,
    action: "restore",
  });
  expect(
    (await db.doc("events/study").get()).get("exceptions")[dates[1]],
  ).toBeUndefined();
});

test("publishes only explicitly listed events in the public calendar and feed", async ({
  request,
}) => {
  await call(request, "cal-elder", "changeEventOccurrence", {
    eventId: "study",
    date: dates[1],
    expectedRevision: 1,
    action: "cancel",
  });
  await call(
    request,
    "cal-elder",
    "publishPortalEvent",
    {
      eventId: "elders",
      portalVisible: false,
      publicRegistration: false,
      publicCalendar: true,
      description: "",
      expectedRevision: 0,
    },
    400,
  );
  const listing = await call(request, "cal-member", "portalPublicCalendar");
  expect(listing.occurrences.map((row: { id: string }) => row.id)).toEqual(
    [dates[0], dates[2], dates[3]].map(
      (date) => `study_${date}@sycamorerpc.org`,
    ),
  );
  const response = await request.get(`${base}/calendarFeed/public.ics`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  const text = await response.text();
  expect(text).toContain(`UID:study_${dates[0]}@sycamorerpc.org`);
  expect(text).toContain("DESCRIPTION:Open to all\\; bring a Bible");
  // The cancelled date stays in the feed as cancelled so subscribers drop it.
  const cancelled = text
    .split("BEGIN:VEVENT")
    .find((row) => row.includes(`study_${dates[1]}@`))!;
  expect(cancelled).toContain("STATUS:CANCELLED");
  expect(cancelled).toContain("SEQUENCE:2");
  expect(text).not.toMatch(/Elders planning|Usher|Greeter|James|Calder/);
  expect(text).not.toMatch(/[^\r]\n/);
});

test("serves a member's private feed until it or their access is revoked", async ({
  request,
}) => {
  const { url } = await call(request, "cal-member", "createMyCalendarFeed", {
    label: "My phone",
  });
  expect(url).toMatch(/\/calendarFeed\/[A-Za-z0-9_-]{43}\.ics$/);
  const token = url.split("/").pop()!.replace(".ics", "");
  // Only the hash is stored.
  const stored = await db.collection("calendarFeeds").get();
  expect(stored.size).toBe(1);
  expect(JSON.stringify(stored.docs[0].data())).not.toContain(token);
  expect(stored.docs[0].id).not.toBe(token);

  const text = await (await feed(request, url)).text();
  expect(text).toContain("X-WR-CALNAME:Sycamore RPC member calendar");
  expect(text).toContain(`UID:study_${dates[0]}@sycamorerpc.org`);
  expect(text).toContain("SUMMARY:Serving: Usher");
  expect(text).not.toMatch(/Greeter|Elders planning|"yes"|RSVP/);

  // The second member cannot see or stop the first member's link.
  const others = await call(request, "cal-member-two", "myCalendarFeeds");
  expect(others).toEqual([]);
  await call(request, "cal-member-two", "revokeMyCalendarFeed", {
    id: stored.docs[0].id,
  });
  expect((await feed(request, url)).status()).toBe(200);

  // Turning off portal access stops the feed at once.
  await db.doc("portalAccess/cal-member").update({ enabled: false });
  expect((await feed(request, url)).status()).toBe(404);
  await db.doc("portalAccess/cal-member").update({ enabled: true });
  const mine = await call(request, "cal-member", "myCalendarFeeds");
  expect(mine).toMatchObject([{ label: "My phone", scope: "member" }]);
  expect(mine[0].lastUsedAt).not.toBe("");
  await call(request, "cal-member", "revokeMyCalendarFeed", { id: mine[0].id });
  expect((await feed(request, url)).status()).toBe(404);
  expect(
    (await request.get(`${base}/calendarFeed/not-a-token.ics`)).status(),
  ).toBe(404);
  expect(
    (await request.get(`${base}/calendarFeed/${"A".repeat(43)}.ics`)).status(),
  ).toBe(404);

  // Five active links at most.
  for (let count = 0; count < 5; count++)
    await call(request, "cal-member", "createMyCalendarFeed", {
      label: `Device ${count}`,
    });
  await call(
    request,
    "cal-member",
    "createMyCalendarFeed",
    { label: "One more" },
    429,
  );
});

test("gives staff a scoped feed of all events and stops it with staff access", async ({
  request,
}) => {
  await call(
    request,
    "cal-volunteer",
    "createStaffCalendarFeed",
    { label: "Booth" },
    403,
  );
  const { url } = await call(request, "cal-elder", "createStaffCalendarFeed", {
    label: "Outlook",
  });
  const text = await (await feed(request, url)).text();
  expect(text).toContain("X-WR-CALNAME:Sycamore RPC staff calendar");
  expect(text).toContain("SUMMARY:Elders planning meeting");
  expect(text).toContain("SUMMARY:Serving: Greeter");
  expect(text).not.toContain("Usher");
  // Each weekly date keeps 6:00 PM church time, including across a clock change.
  for (const date of dates) {
    const start = DateTime.fromISO(`${date}T18:00`, { zone })
      .toUTC()
      .toFormat("yyyyMMdd'T'HHmmss'Z'");
    expect(text).toContain(`DTSTART:${start}`);
  }
  await db.doc("staffAccess/cal-elder").update({ enabled: false });
  expect((await feed(request, url)).status()).toBe(404);
});

test("lists the public calendar and manages a member calendar link in the portal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5174");
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Evening Bible study" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Subscribe to the church calendar" }),
  ).toHaveAttribute("href", /^webcal:.*public\.ics$/);
  await expect(page.getByText("Elders planning meeting")).toHaveCount(0);
  await expect(page.getByText(/^Lord's Day, /).first()).toBeVisible();
  await page.screenshot({
    path: "test-results/phase10-public-calendar.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Member sign in", exact: true }).click();
  await page.getByRole("tab", { name: "Use my password", exact: true }).click();
  await page.getByLabel("Email").fill("cal-member@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("tab", { name: "Me", exact: true }).click();
  await page.getByRole("tab", { name: "Calendar links", exact: true }).click();
  await page.getByLabel("Name this subscription").fill("My phone");
  await page
    .getByRole("button", { name: "Create private calendar link" })
    .click();
  await expect(
    page.getByText(/calendarFeed\/[A-Za-z0-9_-]{43}\.ics/),
  ).toBeVisible();
  await expect(page.getByText("My phone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop My phone" }).click();
  await expect(page.getByText("No calendar links yet.")).toBeVisible();
});

test("cancels one date from the desktop calendar and keeps it listed for restoring", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("pastor@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByRole("tab", { name: "List", exact: true }).click();
  await page.getByLabel("Through").fill(dates[3]);
  const row = page.getByRole("row").filter({
    hasText: DateTime.fromISO(dates[1]).toFormat("LLL d, yyyy"),
  });
  await row
    .filter({ hasText: "Evening Bible study" })
    .getByRole("button", { name: "Evening Bible study" })
    .click();
  await page
    .getByRole("button", { name: "Cancel this date", exact: true })
    .click();
  await expect(
    page.getByText(
      "This date is cancelled. Calendar subscribers see it as cancelled.",
    ),
  ).toBeVisible();
  await expect(
    row.filter({ hasText: "Evening Bible study" }).getByText("Cancelled"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore this date", exact: true })
    .click();
  await expect(
    row.filter({ hasText: "Evening Bible study" }).getByText("As scheduled"),
  ).toBeVisible();
});

test.describe("event reminders", () => {
  const people = ["people/james", "people/ruth", "groups/cal-youth"];
  const saved = new Map<string, FirebaseFirestore.DocumentData | undefined>();
  test.beforeAll(async ({ request }) => {
    for (const path of people)
      saved.set(path, (await db.doc(path).get()).data());
    tokens.pastor = await login(request, "pastor@example.test");
    await auth.getUser("cal-deacon").catch(() =>
      auth.createUser({
        uid: "cal-deacon",
        email: "cal-deacon@example.test",
        password: "LocalDemo123!",
      }),
    );
    await grantTestStaff("cal-deacon", ["deacon"]);
    tokens["cal-deacon"] = await login(request, "cal-deacon@example.test");
  });
  test.afterAll(async () => {
    for (const path of people) {
      const data = saved.get(path);
      if (data) await db.doc(path).set(data);
      else await db.doc(path).delete();
    }
    await db.recursiveDelete(db.collection("emulatorDeliveries"));
  });
  test.beforeEach(async () => {
    for (const [id, email] of [
      ["james", "james@example.test"],
      ["ruth", "ruth@example.test"],
    ])
      await db.doc(`people/${id}`).update({
        email,
        emailOptIn: true,
        isDeceased: false,
        membershipStatus: "communicant",
      });
    await db.doc("communicationSettings/church").update({ emailEnabled: true });
    await db.doc("groups/cal-youth").set({
      name: "Youth leaders",
      type: "ministry",
      leaderPersonId: "",
      memberIds: ["james", "ruth"],
      schedule: "",
      archived: false,
      revision: 1,
    });
    await db.recursiveDelete(db.collection("emulatorDeliveries"));
    for (const row of (
      await db
        .collection("messages")
        .where("source", "==", "event-reminder")
        .get()
    ).docs)
      await db.recursiveDelete(row.ref);
    for (const [personId, status] of [
      ["james", "yes"],
      ["ruth", "maybe"],
    ])
      await db.doc(`events/study/rsvps/${dates[0]}_${personId}`).set({
        eventId: "study",
        date: dates[0],
        personId,
        status,
      });
  });
  const tick = (request: APIRequestContext, at: DateTime) =>
    call(request, "pastor", "runLocalCommunicationTick", {
      now: at.toUTC().toISO(),
    });
  const reminders = async () =>
    (
      await db
        .collection("messages")
        .where("source", "==", "event-reminder")
        .get()
    ).docs;
  const delivered = async () =>
    (await db.collection("emulatorDeliveries").get()).docs.map((row) =>
      row.data(),
    );
  const dayBefore = {
    id: "day",
    minutesBefore: 1440,
    channel: "email",
    audience: "attending",
    groupId: "",
  };

  test("lets only Editors set reminders, for active groups", async ({
    request,
  }) => {
    for (const account of ["cal-deacon", "cal-reader"])
      await call(
        request,
        account,
        "saveEventReminders",
        { eventId: "study", expectedRevision: 1, reminders: [dayBefore] },
        403,
      );
    await call(
      request,
      "cal-elder",
      "saveEventReminders",
      {
        eventId: "study",
        expectedRevision: 1,
        reminders: [{ ...dayBefore, audience: "group", groupId: "missing" }],
      },
      400,
    );
    await call(request, "cal-elder", "saveEventReminders", {
      eventId: "study",
      expectedRevision: 1,
      reminders: [dayBefore],
    });
    await call(
      request,
      "cal-elder",
      "saveEventReminders",
      { eventId: "study", expectedRevision: 1, reminders: [] },
      409,
    );
  });

  test("sends one reminder per date and version to current attendees with consent", async ({
    request,
  }) => {
    await call(request, "cal-elder", "saveEventReminders", {
      eventId: "study",
      expectedRevision: 1,
      reminders: [dayBefore],
    });
    await tick(request, first.minus({ hours: 25 }));
    expect(await reminders()).toHaveLength(0);
    await tick(request, first.minus({ hours: 23 }));
    await tick(request, first.minus({ hours: 22 }));
    const sent = await reminders();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toMatch(
      new RegExp(`^event_study_${dates[0]}_day_[a-z0-9]+$`),
    );
    expect(sent[0].get("selectedPersonIds")).toEqual(["james"]);
    const mail = await delivered();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      to: "james@example.test",
      subject: "Reminder: Evening Bible study",
    });
    expect(mail[0].body).toContain(
      "Hello James, a reminder: Evening Bible study is on the Lord's Day,",
    );
    expect(mail[0].body).not.toMatch(/Ruth|maybe/);
  });

  test("stops pending reminders when the date changes, is cancelled or the person no longer attends", async ({
    request,
  }) => {
    await call(request, "cal-elder", "saveEventReminders", {
      eventId: "study",
      expectedRevision: 1,
      reminders: [{ ...dayBefore, audience: "group", groupId: "cal-youth" }],
    });
    await tick(request, first.minus({ hours: 23 }));
    const [original] = await reminders();
    expect(original.get("selectedPersonIds")).toEqual(["james", "ruth"]);
    // A copy still waiting to go out stands in for a reminder queued before a change.
    const pending = async (id: string) => {
      const copy = db.doc(`messages/${id}`);
      await copy.set({ ...original.data(), status: "queued", activeCount: 0 });
      for (const row of (await original.ref.collection("recipients").get())
        .docs)
        await copy
          .collection("recipients")
          .doc(row.id)
          .set({
            ...row.data(),
            status: "pending",
            attemptKey: "",
            providerId: "",
          });
      return copy;
    };
    const statuses = async (ref: FirebaseFirestore.DocumentReference) =>
      (await ref.collection("recipients").get()).docs.map((row) => [
        row.get("personId"),
        row.get("status"),
      ]);

    // Ruth leaves the group: her waiting reminder is skipped, James's is sent.
    const left = await pending("event_copy_left");
    await db.doc("groups/cal-youth").update({ memberIds: ["james"] });
    await tick(request, first.minus({ hours: 22 }));
    expect(await statuses(left)).toEqual(
      expect.arrayContaining([
        ["james", expect.not.stringMatching(/pending|skipped/)],
        ["ruth", "skipped"],
      ]),
    );

    // The place changes: the waiting reminder for the old details is skipped
    // and one new reminder states the new place.
    const moved = await pending("event_copy_moved");
    await call(request, "cal-elder", "changeEventOccurrence", {
      eventId: "study",
      date: dates[0],
      expectedRevision: 2,
      action: "reschedule",
      start: first.toUTC().toISO(),
      end: first.plus({ hours: 1 }).toUTC().toISO(),
      location: "The manse",
    });
    await tick(request, first.minus({ hours: 21 }));
    await tick(request, first.minus({ hours: 20 }));
    expect(
      (await statuses(moved)).every(([, status]) => status === "skipped"),
    ).toBe(true);
    const current = (await reminders()).filter(
      (row) => !row.id.startsWith("event_copy") && row.id !== original.id,
    );
    expect(current).toHaveLength(1);
    expect(current[0].get("body")).toContain("The manse");

    // The date is cancelled: nothing waiting goes out and nothing new is queued.
    const cancelled = await pending("event_copy_cancelled");
    await call(request, "cal-elder", "changeEventOccurrence", {
      eventId: "study",
      date: dates[0],
      expectedRevision: 3,
      action: "restore",
    });
    await call(request, "cal-elder", "changeEventOccurrence", {
      eventId: "study",
      date: dates[0],
      expectedRevision: 4,
      action: "cancel",
    });
    const before = (await reminders()).length;
    await tick(request, first.minus({ hours: 19 }));
    expect(
      (await statuses(cancelled)).every(([, status]) => status === "skipped"),
    ).toBe(true);
    expect(await reminders()).toHaveLength(before);
  });

  test("sets reminders for an event in the desktop calendar", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill("pastor@example.test");
    await page.getByLabel("Password").fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByRole("tab", { name: "List", exact: true }).click();
    await page.getByLabel("Through").fill(dates[3]);
    await page
      .getByRole("button", { name: "Evening Bible study" })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Add reminder", exact: true })
      .click();
    await page.getByLabel("Reminder 1 timing").selectOption("10080");
    await page.getByLabel("Reminder 1 goes to").selectOption("group");
    await page.getByLabel("Reminder 1 group").selectOption("cal-youth");
    await page
      .getByRole("button", { name: "Save reminders", exact: true })
      .click();
    await expect(
      page.getByText("Reminders saved for every date of this event."),
    ).toBeVisible();
    expect((await db.doc("events/study").get()).get("reminders")).toMatchObject(
      [{ minutesBefore: 10080, audience: "group", groupId: "cal-youth" }],
    );
    await page.screenshot({
      path: "test-results/phase10-event-reminders.png",
      fullPage: true,
      animations: "disabled",
    });
  });
});

test("shows the month with Lord's Day first and opens a date from the grid", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("pastor@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const target = DateTime.fromISO(dates[1]).toFormat("LLLL yyyy");
  for (let step = 0; step < 3; step++) {
    if (await page.getByRole("heading", { name: target }).isVisible()) break;
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await expect(page.getByRole("heading", { name: target })).toBeVisible();
  const label = `Evening Bible study, ${DateTime.fromISO(dates[1]).toFormat("LLLL d")} at 6:00 PM`;
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Selected date" }),
  ).toContainText("Evening Bible study");
  await expect(
    page.getByRole("button", { name: "Cancel this date", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/design-calendar-month.png",
    fullPage: true,
    animations: "disabled",
  });
});
