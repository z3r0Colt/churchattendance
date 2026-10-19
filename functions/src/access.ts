import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  hasRole,
  RECENT_SIGN_IN_REASON,
  roleSchema,
  type Role,
} from "@sycamore/shared";
import { getAuth } from "firebase-admin/auth";
import { db } from "./admin.js";
import { hasAssurance, recentAuthentication } from "./security/policy.js";
import { securityEvent } from "./security/audit.js";
export async function staffIdentity(request: CallableRequest) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const user = await getAuth()
    .getUser(request.auth.uid)
    .catch(() => null);
  if (!user || user.disabled || request.auth.token.kiosk)
    throw new HttpsError(
      "permission-denied",
      "This staff account is unavailable.",
    );
  const roles = z.array(roleSchema).catch([]).parse(user.customClaims?.roles);
  if (!roles.length)
    throw new HttpsError("permission-denied", "A staff account is required.");
  const validAfter =
    Math.floor(Date.parse(user.tokensValidAfterTime || "") / 1000) || 0;
  if (request.auth.token.auth_time < validAfter)
    throw new HttpsError(
      "unauthenticated",
      "Your sign-in was revoked. Sign in again.",
    );
  return { uid: user.uid, roles, user };
}
export async function requireRoles(
  request: CallableRequest,
  allowed: readonly Role[],
) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const actor = await staffIdentity(request);
  const state = (await db.doc(`staffAccess/${actor.uid}`).get()).data() || {};
  const sessionId = request.auth.token.passkeySession;
  const session =
    typeof sessionId === "string" && /^[a-f0-9]{64}$/.test(sessionId)
      ? (await db.doc(`staffSessions/${sessionId}`).get()).data() || null
      : null;
  const tokenRoles = z
    .array(roleSchema)
    .catch([])
    .parse(request.auth.token.roles);
  const roles = actor.roles.filter(
    (role) => tokenRoles.includes(role) && state.roles?.includes(role),
  );
  if (
    !actor.user.emailVerified ||
    !hasAssurance(request.auth.token, actor.uid, state, session) ||
    !hasRole(roles, allowed)
  ) {
    await securityEvent(actor.uid, "staff.access", "denied");
    throw new HttpsError(
      "permission-denied",
      "Your role cannot make this change.",
    );
  }
  return { uid: actor.uid, roles };
}
export function requireRecent(request: CallableRequest) {
  if (!request.auth || !recentAuthentication(request.auth.token.auth_time))
    throw new HttpsError(
      "unauthenticated",
      "Sign in again before changing security settings.",
      { reason: RECENT_SIGN_IN_REASON },
    );
}
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const value = schema.safeParse(data);
  if (!value.success)
    throw new HttpsError("invalid-argument", "Check the fields and try again.");
  return value.data;
}
