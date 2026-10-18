import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
// Cross-service Auth/Firestore changes cannot be atomic. Close access first and serialize them.
// A failed Auth operation leaves this lock for an operator to reconcile, never an automatic unlock.
export async function lockStaffAccount(
  uid: string,
  expectedRoles: string[],
  nextRoles = expectedRoles,
) {
  const ref = db.doc(`staffAccess/${uid}`);
  await db.runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data() || {},
      current = state.roles as string[] | undefined;
    if (
      state.pending ||
      (current &&
        (current.some((role) => !expectedRoles.includes(role)) ||
          expectedRoles.some((role) => !current.includes(role))))
    )
      throw new HttpsError(
        "aborted",
        "This account changed or has an unfinished security update. Refresh or ask the church project operator to review it.",
      );
    tx.set(ref, {
      ...state,
      enabled: false,
      locked: true,
      pending: true,
      roles: nextRoles,
      validAfter: Math.floor(Date.now() / 1000) + 1,
    });
  });
}
export async function finishStaffAccountChange(uid: string, disabled = false) {
  await db
    .doc(`staffAccess/${uid}`)
    .update({ pending: false, locked: disabled, enabled: false });
}
