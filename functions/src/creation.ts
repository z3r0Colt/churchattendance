import { createHash } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin.js";
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
// Receipt and created records commit together. No names, contact details or request bodies enter the receipt.
export async function createOnce<T extends { id: string }>(uid: string, kind: string, input: { requestId?: string }, action: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.runTransaction(async (tx) => {
    if (!input.requestId) return action(tx); // Compatibility for retained legacy clients.
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const ref = db.doc(`creationReceipts/${hash(`${uid}:${kind}:${input.requestId}`)}`);
    const body = hash(stable(input));
    const previous = await tx.get(ref);
    if (previous.exists) {
      if (previous.get("inputHash") !== body) throw new HttpsError("already-exists", "This request was already used. Review the created record before starting a new entry.");
      return previous.get("result") as T;
    }
    const result = await action(tx);
    tx.create(ref, { uid, kind, inputHash: body, result, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}
