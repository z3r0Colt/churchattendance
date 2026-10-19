import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  SESSION_ROLES,
  canReadMercy,
  canReadMercyNote,
  canTriageMercy,
  emptySecuritySchema,
  hasRole,
  mercyAssignmentSchema,
  mercyNoteSchema,
  mercyOpen,
  mercyProgressSchema,
  mercyRequestSchema,
  mercySettingsSchema,
  mercyShareSchema,
  mercyTaskSchema,
  mercyTransition,
  mercyTriageSchema,
  roleSchema,
  type MercyStatus,
  type MercyViewer,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";
import {
  openRecord,
  protectRecord,
  privateOptions,
} from "../security/encryption.js";
import { securityEvent } from "../security/audit.js";
import { getChurchZone } from "../communications/queue.js";
import { liveAccount } from "../shepherding/visits.js";

const MINISTRY = [...SESSION_ROLES, "deacon"] as const;
export async function mercySettings() {
  const row = await db.doc("mercySettings/church").get();
  return {
    chairUids: (row.get("chairUids") || []) as string[],
    revision: Number(row.get("revision") || 0),
  };
}
// Chair status is live: the account must be named by the Session and still hold the deacon role.
export async function mercyViewer(request: CallableRequest) {
  let actor;
  try {
    actor = await requireRoles(request, MINISTRY);
  } catch (error) {
    if (request.auth)
      await securityEvent(request.auth.uid, "mercy.access", "denied", "mercy");
    throw error;
  }
  const settings = await mercySettings();
  const viewer: MercyViewer = {
    uid: actor.uid,
    pastor: actor.roles.includes("pastor"),
    session: hasRole(actor.roles, SESSION_ROLES),
    deacon: actor.roles.includes("deacon"),
    chair: settings.chairUids.includes(actor.uid),
  };
  return { viewer, settings };
}
async function deny(
  uid: string,
  path: string,
  message: string,
): Promise<never> {
  await securityEvent(uid, "mercy.access", "denied", "mercy", path);
  throw new HttpsError("permission-denied", message);
}
const householdDeacons = (row: DocumentSnapshot) =>
  (row.get("deaconUids") || []) as string[];
async function requireLiveDeacons(uids: string[]) {
  await Promise.all(uids.map((uid) => liveAccount(uid, ["deacon"])));
}
const plain = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value instanceof Timestamp ? value.toDate().toISOString() : value,
    ]),
  );
const triageKeys = [
  "householdId",
  "personId",
  "category",
  "urgent",
  "neededBy",
  "status",
  "deaconUids",
  "revision",
  "createdAt",
  "createdBy",
  "source",
] as const;

export const saveMercySettings = onCall(async (request) => {
  const actor = await requireRoles(request, SESSION_ROLES);
  const { expectedRevision, chairUids } = parse(
    mercySettingsSchema,
    request.data,
  );
  await requireLiveDeacons(chairUids);
  const ref = db.doc("mercySettings/church");
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "These settings changed. Reopen them before saving.",
      );
    transaction.set(ref, {
      chairUids,
      revision: expectedRevision + 1,
      updatedBy: actor.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

// Assignment is read live on every request, so a removed deacon loses access at once.
export const saveMercyAssignment = onCall(async (request) => {
  const { viewer } = await mercyViewer(request);
  const input = parse(mercyAssignmentSchema, request.data);
  if (!canTriageMercy(viewer))
    await deny(
      viewer.uid,
      `mercyAssignments/${input.householdId}`,
      "Only the Session or a deacon chair can assign households.",
    );
  await requireLiveDeacons(input.deaconUids);
  const ref = db.doc(`mercyAssignments/${input.householdId}`);
  await db.runTransaction(async (transaction) => {
    const [before, household] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`households/${input.householdId}`)),
    ]);
    if (!household.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This assignment changed. Reopen it before saving.",
      );
    transaction.set(ref, {
      householdId: input.householdId,
      deaconUids: input.deaconUids,
      revision: input.expectedRevision + 1,
      updatedBy: viewer.uid,
      updatedAt: Timestamp.now(),
    });
  });
  return { saved: true };
});

async function requestContext(transaction: Transaction, id: string) {
  const ref = db.doc(`mercyRequests/${id}`);
  const before = await transaction.get(ref);
  const assignment = before.exists
    ? await transaction.get(
        db.doc(`mercyAssignments/${before.get("householdId")}`),
      )
    : null;
  return {
    ref,
    before,
    household: assignment ? householdDeacons(assignment) : [],
  };
}
function checkRevision(before: DocumentSnapshot, expected: number) {
  if (Number(before.get("revision") || 0) !== expected)
    throw new HttpsError(
      "aborted",
      "This request changed. Reopen it before saving.",
    );
}
// Any deacon or Session officer can raise a request. Only readers may edit its details afterwards.
export const saveMercyRequest = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const { id, expectedRevision, ...input } = parse(
    mercyRequestSchema,
    request.data,
  );
  await db.runTransaction(async (transaction) => {
    const { ref, before, household } = await requestContext(transaction, id);
    const [home, person] = await Promise.all([
      transaction.get(db.doc(`households/${input.householdId}`)),
      input.personId
        ? transaction.get(db.doc(`people/${input.personId}`))
        : null,
    ]);
    checkRevision(before, expectedRevision);
    if (!home.exists)
      throw new HttpsError("not-found", "Choose an existing household.");
    if (
      person &&
      (!person.exists ||
        person.get("householdId") !== input.householdId ||
        person.get("isDeceased"))
    )
      throw new HttpsError(
        "invalid-argument",
        "Choose a living person from this household.",
      );
    if (before.exists) {
      const status = before.get("status") as MercyStatus;
      if (!canReadMercy(viewer, household, before.get("deaconUids") || []))
        await deny(
          viewer.uid,
          ref.path,
          "Only the assigned deacons and the Pastor can edit this request.",
        );
      if (status === "resolved" || status === "declined")
        throw new HttpsError(
          "failed-precondition",
          "A closed request cannot be edited.",
        );
      if (before.get("householdId") !== input.householdId)
        throw new HttpsError(
          "invalid-argument",
          "Raise a new request for another household.",
        );
    }
    // Re-seal from the opened record so the outcome and other sealed fields survive an edit.
    transaction.set(
      ref,
      protectRecord("mercyRequests", ref.path, {
        ...(before.exists ? openRecord(ref.path, before.data()!) : {}),
        ...input,
        status: before.get("status") ?? "new",
        deaconUids: before.get("deaconUids") ?? [],
        revision: expectedRevision + 1,
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        createdBy: before.get("createdBy") ?? viewer.uid,
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});

export const triageMercyRequest = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const input = parse(mercyTriageSchema, request.data);
  if (!canTriageMercy(viewer))
    await deny(
      viewer.uid,
      `mercyRequests/${input.id}`,
      "Only the Session or a deacon chair can triage requests.",
    );
  if (input.action !== "decline") await requireLiveDeacons(input.deaconUids);
  await db.runTransaction(async (transaction) => {
    const { ref, before } = await requestContext(transaction, input.id);
    if (!before.exists)
      throw new HttpsError("not-found", "That request could not be found.");
    checkRevision(before, input.expectedRevision);
    const status = before.get("status") as MercyStatus;
    const next: MercyStatus =
      input.action === "approve"
        ? "approved"
        : input.action === "decline"
          ? "declined"
          : status;
    if (
      input.action === "reassign"
        ? !mercyOpen(status)
        : !mercyTransition(status, next)
    )
      throw new HttpsError(
        "failed-precondition",
        input.action === "reassign"
          ? "Only an open request can be reassigned."
          : "Only a request waiting for triage can be approved or declined.",
      );
    transaction.set(
      ref,
      protectRecord("mercyRequests", ref.path, {
        ...openRecord(ref.path, before.data()!),
        status: next,
        ...(input.action === "decline"
          ? { declineReason: input.reason }
          : { deaconUids: input.deaconUids }),
        ...(input.action === "approve"
          ? { approvedBy: viewer.uid, approvedAt: Timestamp.now() }
          : {}),
        revision: input.expectedRevision + 1,
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { saved: true };
});

export const progressMercyRequest = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const input = parse(mercyProgressSchema, request.data);
  await db.runTransaction(async (transaction) => {
    const { ref, before, household } = await requestContext(
      transaction,
      input.id,
    );
    if (!before.exists)
      throw new HttpsError("not-found", "That request could not be found.");
    if (!canReadMercy(viewer, household, before.get("deaconUids") || []))
      await deny(
        viewer.uid,
        ref.path,
        "Only the assigned deacons and the Pastor can update this request.",
      );
    checkRevision(before, input.expectedRevision);
    if (!mercyTransition(before.get("status"), input.status))
      throw new HttpsError(
        "failed-precondition",
        "This request cannot move to that status.",
      );
    transaction.set(
      ref,
      protectRecord("mercyRequests", ref.path, {
        ...openRecord(ref.path, before.data()!),
        status: input.status,
        ...(input.status === "resolved"
          ? {
              outcome: input.outcome,
              resolvedBy: viewer.uid,
              resolvedAt: Timestamp.now(),
            }
          : {}),
        revision: input.expectedRevision + 1,
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { saved: true };
});

export const saveMercyNote = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const { id, expectedRevision, ...input } = parse(
    mercyNoteSchema,
    request.data,
  );
  const ref = db.doc(`mercyNotes/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, assignment, linked] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`mercyAssignments/${input.householdId}`)),
      input.requestId
        ? transaction.get(db.doc(`mercyRequests/${input.requestId}`))
        : null,
    ]);
    if (
      linked &&
      (!linked.exists || linked.get("householdId") !== input.householdId)
    )
      throw new HttpsError(
        "invalid-argument",
        "Link a request for this household.",
      );
    if (
      !canReadMercy(
        viewer,
        householdDeacons(assignment),
        (linked?.get("deaconUids") || []) as string[],
      )
    )
      await deny(
        viewer.uid,
        ref.path,
        "Only the assigned deacons and the Pastor can write mercy notes here.",
      );
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This note changed. Reopen it before saving.",
      );
    if (before.exists && before.get("authorUid") !== viewer.uid)
      throw new HttpsError(
        "permission-denied",
        "Only the author can edit a mercy note.",
      );
    if (before.exists && before.get("householdId") !== input.householdId)
      throw new HttpsError(
        "invalid-argument",
        "Write a new note for another household.",
      );
    transaction.set(
      ref,
      protectRecord("mercyNotes", ref.path, {
        ...input,
        authorUid: viewer.uid,
        sharedWithSession: before.get("sharedWithSession") ?? false,
        ...(before.get("sharedBy")
          ? {
              sharedBy: before.get("sharedBy"),
              sharedAt: before.get("sharedAt"),
            }
          : {}),
        revision: expectedRevision + 1,
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});

// Sharing is a deliberate, logged act. It widens the audience to the Session and cannot be undone silently.
export const shareMercyNote = onCall(async (request) => {
  const { viewer } = await mercyViewer(request);
  const input = parse(mercyShareSchema, request.data);
  const ref = db.doc(`mercyNotes/${input.id}`);
  await db.runTransaction(async (transaction) => {
    const before = await transaction.get(ref);
    if (!before.exists)
      throw new HttpsError("not-found", "That note could not be found.");
    const [assignment, linked] = await Promise.all([
      transaction.get(db.doc(`mercyAssignments/${before.get("householdId")}`)),
      before.get("requestId")
        ? transaction.get(db.doc(`mercyRequests/${before.get("requestId")}`))
        : null,
    ]);
    if (
      !canReadMercy(
        viewer,
        householdDeacons(assignment),
        (linked?.get("deaconUids") || []) as string[],
      )
    )
      await deny(
        viewer.uid,
        ref.path,
        "Only the assigned deacons and the Pastor can share this note.",
      );
    if (Number(before.get("revision") || 0) !== input.expectedRevision)
      throw new HttpsError(
        "aborted",
        "This note changed. Reopen it before sharing.",
      );
    if (before.get("sharedWithSession"))
      throw new HttpsError(
        "failed-precondition",
        "This note is already shared with the Session.",
      );
    transaction.update(ref, {
      sharedWithSession: true,
      sharedBy: viewer.uid,
      sharedAt: Timestamp.now(),
      revision: input.expectedRevision + 1,
      updatedBy: viewer.uid,
      updatedAt: Timestamp.now(),
    });
  });
  await securityEvent(viewer.uid, "mercy.share", "success", "mercy", ref.path);
  return { shared: true };
});

export const saveMercyTask = onCall(privateOptions, async (request) => {
  const { viewer } = await mercyViewer(request);
  const { id, expectedRevision, ...input } = parse(
    mercyTaskSchema,
    request.data,
  );
  await liveAccount(input.assignedToUid, ["deacon"]);
  const ref = db.doc(`mercyTasks/${id}`);
  await db.runTransaction(async (transaction) => {
    const [before, linked] = await Promise.all([
      transaction.get(ref),
      transaction.get(db.doc(`mercyRequests/${input.requestId}`)),
    ]);
    if (!linked.exists)
      throw new HttpsError("not-found", "That request could not be found.");
    const householdId = linked.get("householdId") as string;
    const assignment = await transaction.get(
      db.doc(`mercyAssignments/${householdId}`),
    );
    const requestDeacons = (linked.get("deaconUids") || []) as string[];
    const homeDeacons = householdDeacons(assignment);
    if (!canReadMercy(viewer, homeDeacons, requestDeacons))
      await deny(
        viewer.uid,
        ref.path,
        "Only the assigned deacons and the Pastor can manage these tasks.",
      );
    if (![...homeDeacons, ...requestDeacons].includes(input.assignedToUid))
      throw new HttpsError(
        "invalid-argument",
        "Assign the task to a deacon serving this request or household.",
      );
    if (!mercyOpen(linked.get("status")))
      throw new HttpsError(
        "failed-precondition",
        "Add tasks only to an open request.",
      );
    if (before.exists && before.get("requestId") !== input.requestId)
      throw new HttpsError(
        "invalid-argument",
        "Tasks stay with their request.",
      );
    if (Number(before.get("revision") || 0) !== expectedRevision)
      throw new HttpsError(
        "aborted",
        "This task changed. Reopen it before saving.",
      );
    transaction.set(
      ref,
      protectRecord("mercyTasks", ref.path, {
        ...input,
        householdId,
        revision: expectedRevision + 1,
        createdAt: before.get("createdAt") ?? Timestamp.now(),
        authorUid: before.get("authorUid") ?? viewer.uid,
        updatedBy: viewer.uid,
        updatedAt: Timestamp.now(),
      }),
    );
  });
  return { id };
});

async function liveStaff(allowed: readonly string[]) {
  const users = await db.collection("users").get();
  const rows = await Promise.all(
    users.docs.map(async (row) => {
      const user = await getAuth()
        .getUser(row.id)
        .catch(() => null);
      const roles = roleSchema
        .array()
        .catch([])
        .parse(user?.customClaims?.roles);
      return user && !user.disabled && hasRole(roles, allowed as typeof roles)
        ? {
            uid: row.id,
            name: user.displayName || user.email || "Deacon",
            personId: (row.get("personId") || "") as string,
          }
        : null;
    }),
  );
  return rows.filter((row) => row !== null);
}
export const liveDeacons = () => liveStaff(["deacon"]);

// One audited read. Each caller receives only what their live role and assignment allow.
export const getMercyWorkspace = onCall(privateOptions, async (request) => {
  parse(emptySecuritySchema, request.data ?? {});
  const { viewer, settings } = await mercyViewer(request);
  const triage = canTriageMercy(viewer);
  const [assignmentRows, requestRows, noteRows, taskRows, visitRows, deacons] =
    await Promise.all([
      db.collection("mercyAssignments").get(),
      db.collection("mercyRequests").get(),
      db.collection("mercyNotes").get(),
      db.collection("mercyTasks").get(),
      db.collection("mercyVisits").get(),
      triage || viewer.deacon ? liveDeacons() : [],
    ]);
  // Planners may invite Session officers, who then see the time and place only.
  const officers =
    viewer.deacon || viewer.pastor ? await liveStaff(SESSION_ROLES) : [];
  const homes = new Map(
    assignmentRows.docs.map((row) => [row.id, householdDeacons(row)]),
  );
  const requestDeacons = new Map(
    requestRows.docs.map((row) => [
      row.id,
      (row.get("deaconUids") || []) as string[],
    ]),
  );
  const readable = (householdId: string, requestId = "") =>
    canReadMercy(
      viewer,
      homes.get(householdId) || [],
      requestDeacons.get(requestId) || [],
    );
  const requests = requestRows.docs.flatMap((row) => {
    const full = readable(row.get("householdId"), row.id);
    if (!full && !triage && row.get("createdBy") !== viewer.uid) return [];
    return [
      {
        full,
        path: row.ref.path,
        value: {
          ...plain(
            full
              ? openRecord(row.ref.path, row.data())
              : Object.fromEntries(
                  triageKeys.map((key) => [key, row.get(key)]),
                ),
          ),
          id: row.id,
        },
      },
    ];
  });
  const notes = noteRows.docs.filter((row) =>
    canReadMercyNote(
      viewer,
      { sharedWithSession: row.get("sharedWithSession") === true },
      homes.get(row.get("householdId")) || [],
      requestDeacons.get(row.get("requestId")) || [],
    ),
  );
  const tasks = taskRows.docs.filter((row) =>
    readable(row.get("householdId"), row.get("requestId")),
  );
  const visits = visitRows.docs.filter((row) =>
    readable(row.get("householdId"), row.get("requestId")),
  );
  // Audit commits before private content leaves the server. A failed log write blocks delivery.
  await Promise.all(
    [
      ...requests.filter((row) => row.full).map((row) => row.path),
      ...notes.map((row) => row.ref.path),
      ...tasks.map((row) => row.ref.path),
      ...visits.map((row) => row.ref.path),
    ].map((path) =>
      securityEvent(viewer.uid, "mercy.read", "success", "mercy", path),
    ),
  );
  return {
    viewer: { ...viewer, triage },
    zone: await getChurchZone(),
    settings: viewer.session ? settings : null,
    deacons: deacons.map(({ uid, name }) => ({ uid, name })),
    officers: officers.map(({ uid, name }) => ({ uid, name })),
    assignments: assignmentRows.docs
      .filter(
        (row) =>
          triage || viewer.pastor || householdDeacons(row).includes(viewer.uid),
      )
      .map((row) => ({
        householdId: row.id,
        deaconUids: householdDeacons(row),
        revision: Number(row.get("revision") || 0),
      })),
    requests: requests.map((row) => row.value),
    notes: notes.map((row) => ({
      ...plain(openRecord(row.ref.path, row.data())),
      id: row.id,
    })),
    tasks: tasks.map((row) => ({
      ...plain(openRecord(row.ref.path, row.data())),
      id: row.id,
    })),
    visits: visits.map((row) => ({
      ...plain(openRecord(row.ref.path, row.data())),
      id: row.id,
    })),
  };
});
