import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import {
  MEMBER_REQUESTS_PER_DAY,
  SESSION_ROLES,
  memberRequestProgress,
  memberRequestSchema,
  memberRequestStatusSchema,
  sessionRequestTransition,
  type MercyCategory,
  type MyRequest,
  type SessionRequestStatus,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import { getChurchZone } from "../communications/queue.js";
import { privateOptions, protectRecord } from "../security/encryption.js";
import { member, portalOptions } from "../portal.js";
import { linkedPerson } from "./profile.js";

const iso = (value: unknown) =>
  value instanceof Timestamp ? value.toDate().toISOString() : "";

// The member chooses the ministry by the kind of request; the server picks the
// collection, so a request can never be routed to another audience.
export const submitMemberRequest = onCall(
  { ...portalOptions, ...privateOptions },
  async (request) => {
    const current = await member(request);
    const input = parse(memberRequestSchema, request.data);
    const zone = await getChurchZone();
    const today = DateTime.now().setZone(zone).toISODate()!;
    const practical = input.kind === "practical";
    const ref = db.doc(
      `${practical ? "mercyRequests" : "memberRequests"}/${input.requestId}`,
    );
    const budget = db.doc(`portalBudgets/member_${current.person.id}_${today}`);
    await db.runTransaction(async (transaction) => {
      const [existing, spent] = await Promise.all([
        transaction.get(ref),
        transaction.get(budget),
      ]);
      const person = await linkedPerson(
        transaction,
        current.uid,
        current.person.id,
      );
      // A retried submission is received once. An ID that is already taken
      // reveals nothing about the other record.
      if (existing.exists) return;
      const count = Number(spent.get("count") || 0);
      if (count >= MEMBER_REQUESTS_PER_DAY)
        throw new HttpsError(
          "resource-exhausted",
          "You have sent several requests today. Please contact the church office directly.",
        );
      transaction.set(budget, {
        count: count + 1,
        expiresAt: Timestamp.fromMillis(Date.now() + 2 * 86400000),
      });
      const now = Timestamp.now();
      transaction.create(
        ref,
        practical
          ? protectRecord("mercyRequests", ref.path, {
              householdId: person.get("householdId"),
              personId: current.person.id,
              category: input.category,
              urgent: input.urgent,
              neededBy: input.neededBy,
              details: input.body,
              status: "new",
              deaconUids: [],
              source: "member",
              revision: 1,
              createdAt: now,
              createdBy: current.uid,
              updatedBy: current.uid,
              updatedAt: now,
            })
          : protectRecord("memberRequests", ref.path, {
              personId: current.person.id,
              kind: input.kind,
              body: input.body,
              status: "received",
              revision: 1,
              createdAt: now,
              createdBy: current.uid,
              updatedBy: current.uid,
              updatedAt: now,
            }),
      );
    });
    return { received: true };
  },
);

// Members see the kind, date and progress of their own requests only.
export const myMemberRequests = onCall(portalOptions, async (request) => {
  const current = await member(request);
  const [prayer, practical] = await Promise.all([
    db
      .collection("memberRequests")
      .where("personId", "==", current.person.id)
      .get(),
    db
      .collection("mercyRequests")
      .where("personId", "==", current.person.id)
      .where("source", "==", "member")
      .get(),
  ]);
  const rows: MyRequest[] = [
    ...prayer.docs.map((row) => ({
      id: row.id,
      kind: row.get("kind"),
      category: "" as const,
      submittedAt: iso(row.get("createdAt")),
      progress: memberRequestProgress(row.get("status")),
    })),
    ...practical.docs.map((row) => ({
      id: row.id,
      kind: "practical" as const,
      category: row.get("category") as MercyCategory,
      submittedAt: iso(row.get("createdAt")),
      progress: memberRequestProgress(row.get("status")),
    })),
  ];
  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
});

export const updateMemberRequest = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const input = parse(memberRequestStatusSchema, request.data);
  await db.runTransaction(async (transaction) => {
    const ref = db.doc(`memberRequests/${input.id}`);
    const before = await transaction.get(ref);
    if (!before.exists)
      throw new HttpsError("not-found", "That request could not be found.");
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This request changed. Refresh before saving.",
      );
    if (
      !sessionRequestTransition(
        before.get("status") as SessionRequestStatus,
        input.status,
      )
    )
      throw new HttpsError(
        "failed-precondition",
        "This request has already moved past that step.",
      );
    transaction.update(ref, {
      status: input.status,
      revision: input.expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

// Waiting requests for the Session daily summary: kind and date only.
export async function waitingMemberRequests(zone: string) {
  const rows = await db
    .collection("memberRequests")
    .where("status", "==", "received")
    .get();
  return rows.docs
    .map((row) => ({
      kind: row.get("kind") as string,
      at: (row.get("createdAt") as Timestamp).toDate(),
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(
      (row) =>
        `${row.kind === "prayer" ? "Prayer" : "Pastoral care"} request from ${DateTime.fromJSDate(row.at, { zone }).toFormat("LLL d")}`,
    );
}
