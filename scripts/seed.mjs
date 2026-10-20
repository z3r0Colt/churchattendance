// This script intentionally refuses to touch a live Firebase project.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Seed requires running Auth and Firestore emulators.");
initializeApp({
  projectId: "demo-sycamore",
  storageBucket: "demo-sycamore.appspot.com",
});
const db = getFirestore();
const auth = getAuth();
if (!(await db.doc("publicBranding/church").get()).exists) {
  const { readFile } = await import("node:fs/promises");
  const { publicBrandingSchema } = await import("@sycamore/shared");
  const fixture = JSON.parse(await readFile(new URL("../config/examples/cedar-branding.json", import.meta.url), "utf8"));
  await db.doc("publicBranding/church").set({ ...publicBrandingSchema.parse(fixture), revision: 1 });
}

for (const [uid, email, roles] of [
  ["demo-pastor", "pastor@example.test", ["pastor", "admin"]],
  ["demo-volunteer", "volunteer@example.test", ["attendanceVolunteer"]],
]) {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({
      uid,
      email,
      password: "LocalDemo123!",
      displayName: uid === "demo-pastor" ? "James Calder" : "Alex Booth",
    });
  }
  const sessionId = createHash("sha256").update(`fictional-staff-fixture:${uid}`).digest("hex");
  await auth.updateUser(uid, { emailVerified: true });
  await auth.setCustomUserClaims(uid, { roles, passkeySession: sessionId });
  await db.doc(`staffAccess/${uid}`).set({ enabled: true, roles, validAfter: 0 });
  await db.doc(`staffSessions/${sessionId}`).set({ uid, validAfter: 0, expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000) });
  await db
    .doc(`users/${uid}`)
    .set({
      personId: uid === "demo-pastor" ? "james" : "",
      displayName: uid === "demo-pastor" ? "James Calder" : "Alex Booth",
      roles,
    });
}
if (!(await db.doc("settings/church").get()).exists) {
  await db
    .doc("settings/church")
    .set({ name: "Cedar Reformed Church", timeZone: "America/Indiana/Indianapolis" });
  for (const [id, name, defaultTime] of [
    ["am", "Lord's Day Morning", "10:30"],
    ["pm", "Lord's Day Evening", "17:30"],
  ]) {
    await db
      .doc(`serviceTypes/${id}`)
      .set({ name, defaultTime, dayOfWeek: 0, isActive: true });
  }
  const people = [
    ["james", "James", "Calder", "calder", "communicant"],
    ["ruth", "Ruth", "Calder", "calder", "communicant"],
    ["grace", "Grace", "Calder", "calder", "baptized"],
    ["john", "John", "Baker", "baker", "adherent"],
    ["mary", "Mary", "Baker", "baker", "adherent"],
    ["eli", "Eli", "Moss", "moss", "visitor"],
    ["anna", "Anna", "Calder", "calder", "nonResident"],
  ];
  for (const name of ["Calder", "Baker", "Moss"])
    await db
      .doc(`households/${name.toLowerCase()}`)
      .set({ name, address: "", homePhone: "" });
  for (const [
    id,
    firstName,
    lastName,
    householdId,
    membershipStatus,
  ] of people) {
    const person = {
      firstName,
      lastName,
      preferredName: "",
      householdId,
      membershipStatus,
      email: "",
      mobilePhone: "",
      birthDate: "",
      smsOptIn: false,
      emailOptIn: false,
      isDeceased: false,
      elderDistrictId: "",
    };
    if (id === "james" || id === "ruth") {
      person.email =
        id === "james" ? "pastor@example.test" : "ruth@example.test";
      person.mobilePhone = id === "james" ? "+12025550101" : "+12025550102";
      person.emailOptIn = true;
      person.smsOptIn = true;
    }
    await db.doc(`people/${id}`).set(person);
    await db.doc(`attendanceRoster/${id}`).set({
      id,
      firstName,
      lastName,
      preferredName: "",
      householdId,
      householdName: lastName,
      membershipStatus,
      isDeceased: false,
    });
  }
}
if (!(await db.doc("communicationSettings/church").get()).exists) {
  const { communicationSettingsSchema } = await import("@sycamore/shared");
  await db
    .doc("communicationSettings/church")
    .set(
      communicationSettingsSchema.parse({
        emailEnabled: true,
        smsEnabled: true,
        previewPersonId: "james",
        reminderPersonId: "ruth",
      }),
    );
}
console.log(
  "Emulator data ready. Sign in as pastor@example.test or volunteer@example.test with LocalDemo123!",
);

// This fictional portal account exists only in the guarded emulator seed.
const portalUid = "demo-member";
if (!(await auth.getUser(portalUid).catch(() => null)))
  await auth.createUser({
    uid: portalUid,
    email: "member@example.test",
    password: "LocalDemo123!",
    emailVerified: true,
    displayName: "James Calder",
  });
await auth.setCustomUserClaims(portalUid, {});
if (!(await db.doc(`portalAccess/${portalUid}`).get()).exists)
  await db
    .doc(`portalAccess/${portalUid}`)
    .set({ personId: "james", enabled: true, revision: 1 });
console.log(
  "Portal demo account: member@example.test / LocalDemo123! at http://127.0.0.1:5174",
);
