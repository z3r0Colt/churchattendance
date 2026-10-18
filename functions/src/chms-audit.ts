import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin.js";
function audit(path: string) {
  return onDocumentWrittenWithAuthContext(path, async (event) => {
    if (!event.data) return;
    const before = event.data.before.data() ?? null,
      after = event.data.after.data() ?? null;
    await db
      .doc(`auditLog/${event.id}`)
      .set({
        uid:
          event.authType === "service_account"
            ? (after?.updatedBy ?? event.authId ?? null)
            : (event.authId ?? after?.updatedBy ?? null),
        collection: event.data.after.ref.parent.path,
        docId: event.params.docId,
        action: !before ? "create" : !after ? "delete" : "update",
        before,
        after,
        at: Timestamp.fromDate(new Date(event.time)),
      });
  });
}
export const auditGroupMeetings = audit("groups/{groupId}/meetings/{docId}");
export const auditEventRsvps = audit("events/{eventId}/rsvps/{docId}");
export const auditSacraments = audit("people/{personId}/sacraments/{docId}");
