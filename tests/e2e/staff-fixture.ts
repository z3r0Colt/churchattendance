import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
// A synthetic server-owned assurance grant, not an MFA implementation or bypass endpoint.
// This helper is never bundled into the app or deployed Functions.
export async function grantTestStaff(uid: string, roles: readonly string[]) {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("Staff fixtures require emulators");
  const sessionId = createHash("sha256")
    .update(`fictional-staff-fixture:${uid}`)
    .digest("hex");
  await getAuth().updateUser(uid, { emailVerified: true });
  await getAuth().setCustomUserClaims(uid, {
    roles: [...roles],
    passkeySession: sessionId,
  });
  await getFirestore()
    .doc(`staffAccess/${uid}`)
    .set({ enabled: true, roles: [...roles], validAfter: 0 });
  await getFirestore()
    .doc(`staffSessions/${sessionId}`)
    .set({
      uid,
      validAfter: 0,
      expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
    });
}
