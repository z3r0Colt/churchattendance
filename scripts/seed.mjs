// This script intentionally refuses to touch a live Firebase project.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Seed requires running Auth and Firestore emulators.");
initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore();
const auth = getAuth();
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
  await auth.setCustomUserClaims(uid, { roles });
}
if (!(await db.doc("settings/church").get()).exists) {
  await db
    .doc("settings/church")
    .set({ name: "Sycamore RPC", timeZone: "America/Indiana/Indianapolis" });
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
    await db.doc(`people/${id}`).set(person);
    await db
      .doc(`attendanceRoster/${id}`)
      .set({
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
console.log(
  "Emulator data ready. Sign in as pastor@example.test or volunteer@example.test with LocalDemo123!",
);
