import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { db } from "../admin.js";
import { privateKeys } from "../security/encryption.js";
import { startRuns } from "./engine.js";

// Every start is idempotent: run IDs come from the workflow and the subject.
export const workflowVisitorRecorded = onDocumentCreated(
  { document: "people/{personId}", secrets: [privateKeys] },
  async (event) => {
    const person = event.data?.data();
    // An imported record is history being entered, not a newly recorded visitor.
    if (
      !person ||
      person.membershipStatus !== "visitor" ||
      person.isDeceased ||
      person.importBatchId
    )
      return;
    await startRuns(
      (trigger) => trigger.kind === "visitorRecorded",
      event.params.personId,
      {
        personId: event.params.personId,
        householdId: person.householdId || "",
      },
      person.updatedBy || "system",
    );
  },
);
// Reception means a new communicant or baptized status, not the initial roll entry or a return from non-resident.
export const workflowMembershipReceived = onDocumentCreated(
  {
    document: "people/{personId}/membershipEvents/{eventId}",
    secrets: [privateKeys],
  },
  async (event) => {
    const change = event.data?.data();
    if (
      !change ||
      change.importBatchId ||
      change.method === "initial" ||
      change.fromStatus === change.toStatus ||
      ["communicant", "nonResident"].includes(change.fromStatus)
    )
      return;
    const person = await db.doc(`people/${event.params.personId}`).get();
    if (!person.exists || person.get("isDeceased")) return;
    await startRuns(
      (trigger) =>
        trigger.kind === "membershipReceived" &&
        (trigger.statuses as string[]).includes(change.toStatus),
      event.params.eventId,
      {
        personId: event.params.personId,
        householdId: person.get("householdId") || "",
      },
      person.get("updatedBy") || "system",
    );
  },
);
export const workflowRequestApproved = onDocumentUpdated(
  { document: "mercyRequests/{requestId}", secrets: [privateKeys] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (before?.status !== "new" || after?.status !== "approved") return;
    // A household request is about its first living member when no one was named.
    let personId = (after.personId as string) || "";
    if (!personId) {
      const members = await db
        .collection("people")
        .where("householdId", "==", after.householdId)
        .get();
      personId =
        members.docs
          .filter((row) => !row.get("isDeceased"))
          .map((row) => row.id)
          .sort()[0] || "";
    }
    await startRuns(
      (trigger) =>
        trigger.kind === "requestApproved" &&
        (!trigger.categories.length ||
          (trigger.categories as string[]).includes(after.category)),
      event.params.requestId,
      {
        personId,
        householdId: after.householdId,
        requestId: event.params.requestId,
      },
      after.approvedBy || "system",
    );
  },
);
