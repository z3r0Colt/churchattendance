import { expect, test, type APIRequestContext } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { grantTestStaff } from "./staff-fixture";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Review regressions require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore(),
  auth = getAuth();
const tokens: Record<string, string> = {};
const base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  role = "admin",
  status = 200,
) {
  const result = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[role]}` },
    data: { data },
  });
  const body = await result.json();
  expect(result.status(), JSON.stringify(body)).toBe(status);
  return body.result;
}
test.beforeAll(async ({ request }) => {
  for (const role of ["admin", "elder"]) {
    const uid = `review-${role}`;
    await auth
      .getUser(uid)
      .catch(() =>
        auth.createUser({
          uid,
          email: `${uid}@example.test`,
          password: "LocalDemo123!",
        }),
      );
    await grantTestStaff(uid, [role]);
    const login = await request.post(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
      {
        data: {
          email: `${uid}@example.test`,
          password: "LocalDemo123!",
          returnSecureToken: true,
        },
      },
    );
    tokens[role] = (await login.json()).idToken;
  }
});
test.afterAll(async () => {
  const rows = await db
    .collection("messages")
    .where("selectedPersonIds", "array-contains", "review-person")
    .get();
  for (const row of rows.docs) await db.recursiveDelete(row.ref);
});
test("audits private message reads, denies non-Session staff and keeps older queued work available", async ({
  request,
}) => {
  const batch = db.batch();
  const baseMessage = {
    channel: "email",
    body: "Fictional message",
    subject: "Fictional",
    source: "review-test",
    scheduledFor: Timestamp.now(),
    selectedPersonIds: ["review-person"],
    sessionOnly: false,
    totals: {},
    status: "completed",
  };
  for (let index = 0; index < 205; index++)
    batch.set(db.doc(`messages/review-${String(index).padStart(3, "0")}`), {
      ...baseMessage,
      createdAt: Timestamp.fromMillis(Date.UTC(2030, 0, 1) + index * 1000),
    });
  batch.set(db.doc("messages/review-old-queued"), {
    ...baseMessage,
    status: "queued",
    createdAt: Timestamp.fromMillis(0),
  });
  batch.set(db.doc("messages/review-private"), {
    ...baseMessage,
    sessionOnly: true,
    body: "Fictional private digest",
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc("messages/review-private/recipients/review"), {
    personId: "review-person",
    channel: "email",
    address: "review@example.test",
    status: "pending",
  });
  await batch.commit();
  const first = await call(request, "listMessages", {
    personId: "review-person",
  });
  expect(first.hasMore).toBe(true);
  expect(
    first.messages.some(
      (row: { id: string }) => row.id === "review-old-queued",
    ),
  ).toBe(true);
  expect(
    first.messages.some((row: { sessionOnly: boolean }) => row.sessionOnly),
  ).toBe(false);
  const next = await call(request, "listMessages", {
    personId: "review-person",
    before: first.before,
  });
  expect(next.hasMore).toBe(false);
  expect(
    next.messages.filter(
      (row: { status: string }) => row.status === "completed",
    ),
  ).toHaveLength(5);
  await call(
    request,
    "getMessageRecipients",
    { id: "review-private" },
    "admin",
    403,
  );
  const recipients = await call(
    request,
    "getMessageRecipients",
    { id: "review-private" },
    "elder",
  );
  expect(recipients[0].address).toBe("review@example.test");
  const page = await call(
    request,
    "listMessages",
    { personId: "review-person", before: first.before },
    "elder",
  );
  expect(
    page.messages.some((row: { id: string }) => row.id === "review-private"),
  ).toBe(true);
  const events = await db
    .collection("securityEvents")
    .where("actorUid", "==", "review-elder")
    .get();
  expect(
    events.docs.some(
      (row) =>
        row.get("action") === "messages.recipients" &&
        row.get("scope") === "session",
    ),
  ).toBe(true);
});
