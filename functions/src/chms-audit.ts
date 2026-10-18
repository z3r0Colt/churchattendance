import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin.js";
import { protectRecord, privateKeys } from "./security/encryption.js";
import { securityEvent } from "./security/audit.js";
function audit(path: string) {
  return onDocumentWrittenWithAuthContext(
    { document: path, secrets: [privateKeys] },
    async (event) => {
      if (!event.data) return;
      const before = event.data.before.data() ?? null,
        after = event.data.after.data() ?? null;
      await db.doc(`auditLog/${event.id}`).set(
        protectRecord("auditLog", `auditLog/${event.id}`, {
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
        }),
      );
      await securityEvent(
        event.authId || "system",
        "record.change",
        "success",
        "security",
        event.data.after.ref.path,
      );
    },
  );
}
export const auditGroupMeetings = audit("groups/{groupId}/meetings/{docId}");
export const auditEventRsvps = audit("events/{eventId}/rsvps/{docId}");
export const auditSacraments = audit("people/{personId}/sacraments/{docId}");
