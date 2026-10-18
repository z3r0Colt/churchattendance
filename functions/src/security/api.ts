import { getAuth } from "firebase-admin/auth";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import {
  roleSchema,
  SESSION_ROLES,
  hasRole,
  accountCreateSchema,
  accountActionSchema,
  accountListSchema,
  privatePageSchema,
  migrationPageSchema,
  securityLogSchema,
  emptySecuritySchema,
} from "@sycamore/shared";
import { db } from "../admin.js";
import {
  parse,
  requireRoles,
  requireRecent,
  staffIdentity,
} from "../access.js";
import { hasAssurance } from "./policy.js";
import { securityEvent } from "./audit.js";
import {
  openRecord,
  protectRecord,
  privateOptions,
  keyRing,
} from "./encryption.js";
import { isDeepStrictEqual } from "node:util";
import { lockStaffAccount, finishStaffAccountChange } from "./account-lock.js";

export const staffSecurityStatus = onCall(async (request) => {
  const actor = await staffIdentity(request);
  const state = (await db.doc(`staffAccess/${actor.uid}`).get()).data() || {};
  const sid = request.auth!.token.passkeySession;
  const session =
    typeof sid === "string" && /^[a-f0-9]{64}$/.test(sid)
      ? (await db.doc(`staffSessions/${sid}`).get()).data() || null
      : null;
  return {
    assured:
      actor.user.emailVerified &&
      hasAssurance(request.auth!.token, actor.uid, state, session),
    expiresAt: session?.expiresAt?.toMillis() || 0,
    roles: actor.roles,
    canActivate: hasAssurance(
      request.auth!.token,
      actor.uid,
      { ...state, enabled: true },
      session,
    ),
    verified: actor.user.emailVerified,
    factors: actor.user.multiFactor?.enrolledFactors.length || 0,
  };
});
export const activateStaffAccess = onCall(async (request) => {
  parse(emptySecuritySchema, request.data);
  const actor = await staffIdentity(request);
  const ref = db.doc(`staffAccess/${actor.uid}`);
  await db
    .runTransaction(async (tx) => {
      const state = (await tx.get(ref)).data() || {};
      const sid = request.auth!.token.passkeySession;
      const session =
        typeof sid === "string" && /^[a-f0-9]{64}$/.test(sid)
          ? (await tx.get(db.doc(`staffSessions/${sid}`))).data() || null
          : null;
      const changedRoles =
        state.roles &&
        (state.roles.some(
          (role: string) =>
            !actor.roles.includes(role as (typeof actor.roles)[number]),
        ) ||
          actor.roles.some((role) => !state.roles.includes(role)));
      if (
        changedRoles ||
        !actor.user.emailVerified ||
        !hasAssurance(
          request.auth!.token,
          actor.uid,
          { ...state, enabled: true },
          session,
        )
      )
        throw new HttpsError(
          "permission-denied",
          "Verify your email and complete MFA, then sign in again.",
        );
      tx.set(
        ref,
        {
          enabled: true,
          roles: actor.roles,
          validAfter: state.validAfter || 0,
        },
        { merge: true },
      );
    })
    .catch(async (error) => {
      await securityEvent(actor.uid, "authentication", "denied");
      throw error;
    });
  await securityEvent(actor.uid, "authentication", "success");
  return { enabled: true };
});
export const listStaffAccounts = onCall(async (request) => {
  await requireRoles(request, ["admin"]);
  // Bounded UI listing, with pagination rather than silently omitting accounts.
  const input = parse(accountListSchema, request.data);
  const page = await getAuth().listUsers(100, input.after || undefined);
  return {
    accounts: page.users
      .filter(
        (u) => roleSchema.array().catch([]).parse(u.customClaims?.roles).length,
      )
      .map((u) => ({
        uid: u.uid,
        email: u.email || "",
        displayName: u.displayName || "",
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        roles: roleSchema.array().catch([]).parse(u.customClaims?.roles),
        factors: u.multiFactor?.enrolledFactors.length || 0,
      })),
    next: page.pageToken || "",
  };
});
export const createStaffAccount = onCall(async (request) => {
  const actor = await requireRoles(request, ["admin"]);
  requireRecent(request);
  const input = parse(accountCreateSchema, request.data);
  if (
    hasRole(input.roles, SESSION_ROLES) &&
    !hasRole(actor.roles, SESSION_ROLES)
  )
    throw new HttpsError(
      "permission-denied",
      "A Session administrator must grant Session access.",
    );
  const user = await getAuth().createUser({
    email: input.email,
    displayName: input.displayName,
    password: randomBytes(48).toString("base64url"),
    emailVerified: false,
  });
  await getAuth().setCustomUserClaims(user.uid, {
    roles: [...new Set(input.roles)],
  });
  await db
    .doc(`users/${user.uid}`)
    .set({ displayName: input.displayName, roles: input.roles });
  await db
    .doc(`staffAccess/${user.uid}`)
    .set({ enabled: false, roles: input.roles, validAfter: 0 });
  // No mail is sent. An administrator can hand this one-time setup link to the verified recipient.
  const setupLink = await getAuth().generatePasswordResetLink(input.email);
  await securityEvent(
    actor.uid,
    "account.create",
    "success",
    "security",
    user.uid,
  );
  return { uid: user.uid, setupLink };
});
export const manageStaffAccount = onCall(async (request) => {
  const actor = await requireRoles(request, ["admin"]);
  requireRecent(request);
  const { uid, action } = parse(accountActionSchema, request.data);
  if (uid === actor.uid || uid.startsWith("kiosk_"))
    throw new HttpsError(
      "failed-precondition",
      "Another administrator must manage your account.",
    );
  const target = await getAuth().getUser(uid);
  const targetRoles = roleSchema
    .array()
    .catch([])
    .parse(target.customClaims?.roles);
  if (
    !targetRoles.length ||
    (hasRole(targetRoles, SESSION_ROLES) &&
      !hasRole(actor.roles, SESSION_ROLES))
  )
    throw new HttpsError(
      "permission-denied",
      "A Session administrator must manage this account.",
    );
  // Revoke database access before changing Auth. A partial failure leaves access closed.
  await lockStaffAccount(uid, targetRoles);
  await getAuth().revokeRefreshTokens(uid);
  if (action === "disable" || action === "enable")
    await getAuth().updateUser(uid, { disabled: action === "disable" });
  if (action === "recover") {
    await getAuth().updateUser(uid, { multiFactor: { enrolledFactors: [] } });
    const credentials = await db
      .collection("staffCredentials")
      .where("uid", "==", uid)
      .get();
    const batch = db.batch();
    credentials.docs.forEach((row) => batch.delete(row.ref));
    await batch.commit();
  }
  await securityEvent(
    actor.uid,
    `account.${action}`,
    "success",
    "security",
    uid,
  );
  await finishStaffAccountChange(uid, action === "disable");
  return { updated: true };
});
export const getSecurityEvents = onCall(async (request) => {
  const actor = await requireRoles(request, ["admin", ...SESSION_ROLES]);
  const input = parse(securityLogSchema, request.data);
  if (input.scope === "session" && !hasRole(actor.roles, SESSION_ROLES))
    throw new HttpsError("permission-denied", "Session access is required.");
  let query = db
    .collection("securityEvents")
    .where("scope", "==", input.scope)
    .orderBy(FieldPath.documentId())
    .limit(100);
  if (input.after) query = query.startAfter(input.after);
  const page = await query.get();
  return {
    events: page.docs.map((row) => ({
      id: row.id,
      scope: input.scope,
      actorUid: row.get("actorUid"),
      action: row.get("action"),
      outcome: row.get("outcome"),
      target: row.get("target"),
      at: row.get("at").toDate().toISOString(),
    })),
    next: page.size === 100 ? page.docs.at(-1)!.id : "",
  };
});
export const getPrivateRecords = onCall(privateOptions, async (request) => {
  const input = parse(privatePageSchema, request.data);
  let actor;
  try {
    actor = await requireRoles(
      request,
      input.collection === "diaconalTasks"
        ? [...SESSION_ROLES, "deacon"]
        : SESSION_ROLES,
    );
  } catch (error) {
    if (request.auth)
      await securityEvent(
        request.auth.uid,
        "private.read",
        "denied",
        "session",
      );
    throw error;
  }
  let query = db
    .collection(input.collection)
    .orderBy(FieldPath.documentId())
    .limit(25);
  if (!hasRole(actor.roles, SESSION_ROLES))
    query = query.where("assignedToUid", "==", actor.uid);
  if (input.after) query = query.startAfter(input.after);
  const page = await query.get();
  // Audit commits before the records leave the server. A failed log write blocks delivery.
  for (const row of page.docs)
    await securityEvent(
      actor.uid,
      "private.read",
      "success",
      "session",
      row.ref.path,
    );
  return {
    rows: page.docs.map((row) => ({
      ...(input.view === "report"
        ? Object.fromEntries(
            [
              "personId",
              "kind",
              "date",
              "dueDate",
              "done",
              "assignedToUid",
              "revision",
            ]
              .filter((key) => key in row.data())
              .map((key) => [key, row.get(key)]),
          )
        : openRecord(row.ref.path, row.data())),
      id: row.id,
    })),
    next: page.size === 25 ? page.docs.at(-1)!.id : "",
  };
});
export const migratePrivateRecords = onCall(privateOptions, async (request) => {
  const actor = await requireRoles(request, ["admin"]);
  requireRecent(request);
  if (!hasRole(actor.roles, SESSION_ROLES))
    throw new HttpsError(
      "permission-denied",
      "A Session administrator must migrate private records.",
    );
  const input = parse(migrationPageSchema, request.data),
    ring = keyRing();
  let query = db
    .collection(input.collection)
    .orderBy(FieldPath.documentId())
    .limit(25);
  if (input.after) query = query.startAfter(input.after);
  const page = await query.get();
  let migrated = 0;
  for (const document of page.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const row = await transaction.get(document.ref);
      if (!row.exists) return false;
      const data = row.data()!;
      if (
        data.encrypted?.key === ring.active &&
        ![
          "body",
          "title",
          "before",
          "after",
          "disciplineFlag",
          "disciplineHistory",
        ].some((field) => field in data)
      )
        return false;
      const plain = openRecord(row.ref.path, data),
        sealed = protectRecord(input.collection, row.ref.path, plain);
      // Verify with the active key before replacing the legacy document.
      if (
        !isDeepStrictEqual(
          JSON.parse(JSON.stringify(openRecord(row.ref.path, sealed))),
          JSON.parse(JSON.stringify(plain)),
        )
      )
        throw new Error("Private migration verification failed");
      transaction.set(row.ref, { ...sealed, migratedAt: Timestamp.now() });
      return true;
    });
    if (changed) migrated++;
  }
  await securityEvent(
    actor.uid,
    "encryption.migrate",
    "success",
    "session",
    input.collection,
  );
  return {
    migrated,
    next: page.size === 25 ? page.docs.at(-1)!.id : "",
    key: ring.active,
  };
});
