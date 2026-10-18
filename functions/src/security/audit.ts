import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
export async function securityEvent(
  actorUid: string,
  action: string,
  outcome: string,
  scope: "security" | "session" | "mercy" = "security",
  target = "",
) {
  // Deliberately no request bodies, keys, IPs, note text or authentication material.
  await db
    .collection("securityEvents")
    .add({ actorUid, action, outcome, scope, target, at: Timestamp.now() });
}
