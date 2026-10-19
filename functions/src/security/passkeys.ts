import { createHash, randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import {
  passkeyBeginSchema,
  passkeyFinishSchema,
  passkeyRemoveSchema,
  handoffSchema,
  handoffApproveSchema,
  emptySecuritySchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles, requireRecent } from "../access.js";
import { roles as allRoles } from "@sycamore/shared";
import { securityEvent } from "./audit.js";
import { emulatorMode } from "../communications/environment.js";

const securityOrigin = defineString("STAFF_AUTH_ORIGIN", {
  default: "https://not-configured.invalid",
});
const securityRp = defineString("STAFF_AUTH_RP_ID", {
  default: "not-configured.invalid",
});
const opaque = () => randomBytes(32).toString("hex");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
// In production the portal and the staff web (/staff/) share one origin. Locally they are
// separate Vite servers on the same "localhost" relying party.
function origin(request: CallableRequest) {
  const allowed = emulatorMode()
    ? ["http://localhost:5174", "http://localhost:5175"]
    : [securityOrigin.value()];
  const expected = request.rawRequest.header("origin") || "";
  if (
    !allowed.includes(expected) ||
    (!emulatorMode() && !expected.startsWith("https://"))
  )
    throw new HttpsError(
      "permission-denied",
      "Open the church security page to use passkeys.",
    );
  return { expected, rp: emulatorMode() ? "localhost" : securityRp.value() };
}
async function budget(key: string, limit = 20) {
  const bucket = `${hash(key)}_${Math.floor(Date.now() / 3_600_000)}`,
    ref = db.doc(`securityBudgets/${bucket}`);
  await db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    if ((row.get("count") || 0) >= limit)
      throw new HttpsError("resource-exhausted", "Wait before trying again.");
    tx.set(ref, {
      count: (row.get("count") || 0) + 1,
      expiresAt: Timestamp.fromMillis(Date.now() + 7_200_000),
    });
  });
}
async function consume(id: string, kind: string, uid = "") {
  const ref = db.doc(`securityChallenges/${id}`);
  return db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    if (
      !row.exists ||
      row.get("used") ||
      row.get("kind") !== kind ||
      row.get("expiresAt").toMillis() < Date.now() ||
      (uid && row.get("uid") !== uid)
    )
      throw new HttpsError(
        "permission-denied",
        "This challenge expired or was already used. Start again.",
      );
    tx.update(ref, { used: true });
    return row.data()!;
  });
}
export const beginPasskeyRegistration = onCall(async (request) => {
  const { rp } = origin(request),
    actor = await requireRoles(request, allRoles);
  requireRecent(request);
  const user = await getAuth().getUser(actor.uid);
  const existing = await db
    .collection("staffCredentials")
    .where("uid", "==", actor.uid)
    .get();
  if (existing.size >= 10)
    throw new HttpsError(
      "resource-exhausted",
      "Remove an unused passkey before adding another.",
    );
  const options = await generateRegistrationOptions({
    rpName: "Sycamore RPC",
    rpID: rp,
    userName: user.email!,
    userID: Buffer.from(actor.uid),
    attestationType: "none",
    excludeCredentials: existing.docs.map((row) => ({ id: row.id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  const id = opaque();
  await db.doc(`securityChallenges/${id}`).set({
    uid: actor.uid,
    kind: "register",
    challenge: options.challenge,
    used: false,
    expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
  });
  return { id, options };
});
export const finishPasskeyRegistration = onCall(async (request) => {
  const { rp, expected } = origin(request),
    actor = await requireRoles(request, allRoles);
  requireRecent(request);
  const input = parse(passkeyFinishSchema, request.data),
    challenge = await consume(input.challengeId, "register", actor.uid);
  const result = await verifyRegistrationResponse({
    response: input.response as unknown as RegistrationResponseJSON,
    expectedChallenge: challenge.challenge,
    expectedOrigin: expected,
    expectedRPID: rp,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo)
    throw new HttpsError("permission-denied", "Passkey verification failed.");
  const { credential } = result.registrationInfo;
  if (!/^[A-Za-z0-9_-]{1,1500}$/.test(credential.id))
    throw new HttpsError(
      "invalid-argument",
      "Unsupported credential identifier.",
    );
  await db.doc(`staffCredentials/${credential.id}`).create({
    uid: actor.uid,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports || [],
    createdAt: Timestamp.now(),
  });
  await securityEvent(actor.uid, "passkey.register", "success");
  return { registered: true };
});
export const beginPasskeySignIn = onCall(async (request) => {
  const { rp } = origin(request),
    input = parse(passkeyBeginSchema, request.data);
  const email = input.email.trim().toLowerCase();
  await budget(`email:${email}`, 10);
  await budget(`network:${request.rawRequest.ip}`, 40);
  const user = await getAuth()
    .getUserByEmail(email)
    .catch(() => null);
  // Discoverable credentials keep the response shape the same for unknown accounts.
  const options = await generateAuthenticationOptions({
    rpID: rp,
    userVerification: "required",
  });
  const id = opaque();
  await db.doc(`securityChallenges/${id}`).set({
    uid: user?.uid || "",
    kind: "login",
    challenge: options.challenge,
    used: false,
    expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
  });
  return { id, options };
});
export const finishPasskeySignIn = onCall(async (request) => {
  const { rp, expected } = origin(request),
    input = parse(passkeyFinishSchema, request.data);
  const challenge = await consume(input.challengeId, "login");
  const credentialId = input.response.id;
  if (
    typeof credentialId !== "string" ||
    !/^[A-Za-z0-9_-]{1,1500}$/.test(credentialId)
  )
    throw new HttpsError("permission-denied", "Passkey sign-in failed.");
  const ref = db.doc(`staffCredentials/${credentialId}`),
    credential = await ref.get();
  if (!challenge.uid || credential.get("uid") !== challenge.uid)
    throw new HttpsError("permission-denied", "Passkey sign-in failed.");
  const user = await getAuth().getUser(challenge.uid);
  const actorRoles = allRoles.filter((role) =>
    ((user.customClaims?.roles as string[]) || []).includes(role),
  );
  if (user.disabled || !user.emailVerified || !actorRoles.length)
    throw new HttpsError("permission-denied", "Passkey sign-in failed.");
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: input.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: expected,
      expectedRPID: rp,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(
          Buffer.from(credential.get("publicKey"), "base64"),
        ),
        counter: credential.get("counter"),
        transports: credential.get(
          "transports",
        ) as AuthenticatorTransportFuture[],
      },
    });
  } catch {
    await securityEvent(user.uid, "passkey.authentication", "denied");
    throw new HttpsError("permission-denied", "Passkey sign-in failed.");
  }
  if (!result.verified)
    throw new HttpsError("permission-denied", "Passkey sign-in failed.");
  const sessionId = opaque();
  await db.runTransaction(async (tx) => {
    const [current, state] = await Promise.all([
      tx.get(ref),
      tx.get(db.doc(`staffAccess/${user.uid}`)),
    ]);
    const currentRoles = state.get("roles") as string[] | undefined;
    if (
      state.get("locked") ||
      (currentRoles &&
        (currentRoles.some(
          (role) => !actorRoles.includes(role as (typeof actorRoles)[number]),
        ) ||
          actorRoles.some((role) => !currentRoles.includes(role))))
    )
      throw new HttpsError(
        "permission-denied",
        "Staff access changed. Sign in again.",
      );
    if (!current.exists || current.get("counter") !== credential.get("counter"))
      throw new HttpsError("aborted", "Try passkey sign-in again.");
    tx.update(ref, {
      counter: result.authenticationInfo.newCounter,
      lastUsedAt: Timestamp.now(),
    });
    tx.create(db.doc(`staffSessions/${sessionId}`), {
      uid: user.uid,
      verifiedAt: Timestamp.now(),
      validAfter: state.get("validAfter") || 0,
      expiresAt: Timestamp.fromMillis(Date.now() + 8 * 3_600_000),
    });
    tx.set(db.doc(`staffAccess/${user.uid}`), {
      enabled: true,
      roles: actorRoles,
      validAfter: state.get("validAfter") || 0,
    });
  });
  await securityEvent(user.uid, "passkey.authentication", "success");
  return {
    token: await getAuth().createCustomToken(user.uid, {
      passkeySession: sessionId,
    }),
  };
});
export const listMyPasskeys = onCall(async (request) => {
  const actor = await requireRoles(request, allRoles);
  const page = await db
    .collection("staffCredentials")
    .where("uid", "==", actor.uid)
    .get();
  return page.docs.map((row) => ({
    id: row.id,
    createdAt: row.get("createdAt").toDate().toISOString(),
  }));
});
export const removeMyPasskey = onCall(async (request) => {
  const actor = await requireRoles(request, allRoles);
  requireRecent(request);
  const input = parse(passkeyRemoveSchema, request.data),
    ref = db.doc(`staffCredentials/${input.id}`);
  await db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    if (row.get("uid") !== actor.uid)
      throw new HttpsError("permission-denied", "That passkey is not yours.");
    tx.delete(ref);
    tx.set(
      db.doc(`staffAccess/${actor.uid}`),
      { enabled: false, validAfter: Math.floor(Date.now() / 1000) + 1 },
      { merge: true },
    );
  });
  await getAuth().revokeRefreshTokens(actor.uid);
  await securityEvent(actor.uid, "passkey.remove", "success");
  return { removed: true };
});
// The verifier remains inside the desktop process. The browser receives its SHA-256 challenge.
export const approveDesktopSignIn = onCall(async (request) => {
  origin(request);
  const actor = await requireRoles(request, allRoles);
  requireRecent(request);
  const input = parse(handoffApproveSchema, request.data);
  const state = await db.doc(`staffAccess/${actor.uid}`).get();
  if (
    !state.get("enabled") ||
    state.get("locked") ||
    request.auth!.token.auth_time < (state.get("validAfter") || 0)
  )
    throw new HttpsError(
      "permission-denied",
      "Staff access changed. Sign in again.",
    );
  await db.doc(`desktopHandoffs/${input.id}`).create({
    uid: actor.uid,
    challenge: input.challenge,
    authTime: request.auth!.token.auth_time,
    validAfter: state.get("validAfter") || 0,
    expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    used: false,
  });
  return { approved: true };
});
export const completeDesktopSignIn = onCall(async (request) => {
  const input = parse(handoffSchema, request.data),
    ref = db.doc(`desktopHandoffs/${input.id}`);
  const grant = await db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    if (!row.exists) return null;
    if (
      row.get("used") ||
      row.get("expiresAt").toMillis() < Date.now() ||
      row.get("challenge") !== hash(input.verifier)
    )
      throw new HttpsError(
        "permission-denied",
        "Desktop sign-in expired. Start again.",
      );
    tx.update(ref, { used: true });
    return row.data()!;
  });
  if (!grant) return { pending: true };
  const user = await getAuth().getUser(grant.uid);
  if (user.disabled)
    throw new HttpsError("permission-denied", "This account is unavailable.");
  // Exchange a recent MFA browser approval for a bounded server-owned assurance session.
  const state = await db.doc(`staffAccess/${user.uid}`).get(),
    sessionId = opaque();
  if (
    !state.get("enabled") ||
    state.get("locked") ||
    grant.validAfter !== (state.get("validAfter") || 0) ||
    grant.authTime <
      Math.floor(Date.parse(user.tokensValidAfterTime || "") / 1000)
  )
    throw new HttpsError(
      "permission-denied",
      "Staff access changed. Sign in again.",
    );
  await db.doc(`staffSessions/${sessionId}`).create({
    uid: user.uid,
    verifiedAt: Timestamp.now(),
    validAfter: state.get("validAfter") || 0,
    expiresAt: Timestamp.fromMillis(Date.now() + 8 * 3_600_000),
  });
  await securityEvent(user.uid, "desktop.authentication", "success");
  return {
    token: await getAuth().createCustomToken(user.uid, {
      passkeySession: sessionId,
    }),
  };
});
export const getStaffSecurityPage = onCall((request) => {
  parse(emptySecuritySchema, request.data);
  return {
    url: `${emulatorMode() ? "http://localhost:5174" : securityOrigin.value()}/staff-security`,
  };
});
