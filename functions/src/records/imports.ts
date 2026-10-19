import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import {
  EDITOR_ROLES,
  IMPORT_ROW_LIMIT,
  importCandidates,
  importChanges,
  importFields,
  importHouseholdId,
  importPersonId,
  importProcessSchema,
  importStartSchema,
  membershipEventSchema,
  personInputSchema,
  previewImport,
  toRoster,
  type ImportDecision,
  type ImportValue,
  type Person,
} from "@sycamore/shared";
import { db } from "../admin.js";
import { parse, requireRoles } from "../access.js";

async function roll() {
  const people = await db.collection("people").get();
  return people.docs.map((row) => ({ ...row.data(), id: row.id }) as Person);
}
const previewSchema = z
  .object({
    rows: z
      .array(z.partialRecord(z.enum(importFields), z.string().max(1000)))
      .min(1)
      .max(IMPORT_ROW_LIMIT),
    defaults: z
      .object({
        status: z.union([
          z.enum([
            "communicant",
            "baptized",
            "nonResident",
            "adherent",
            "visitor",
            "former",
          ]),
          z.literal(""),
        ]),
        statusDate: z.iso.date(),
      })
      .strict(),
  })
  .strict();
// A dry run. It reads the roll to find possible matches and writes nothing.
export const previewPeopleImport = onCall(async (request) => {
  await requireRoles(request, EDITOR_ROLES);
  const input = parse(previewSchema, request.data);
  const people = await roll();
  return {
    rows: previewImport(input.rows, people, input.defaults),
    people: Object.fromEntries(
      people.map((row) => [
        row.id,
        {
          name: `${row.firstName} ${row.lastName}`,
          preferredName: row.preferredName || "",
          email: row.email || "",
          mobilePhone: row.mobilePhone || "",
          birthDate: row.birthDate || "",
        },
      ]),
    ),
  };
});
// Records the reviewed rows and decisions as a batch. Rows are applied later, one transaction each.
export const startPeopleImport = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const input = parse(importStartSchema, request.data);
  const batch = db.doc(`importBatches/${input.batchId}`);
  if ((await batch.get()).exists) return { batchId: input.batchId };
  // Matches are checked again here, so a new record is never created past an unreviewed match.
  const people = await roll();
  for (const row of input.rows) {
    const candidates = row.value ? importCandidates(row.value, people) : [];
    if (
      row.decision.action === "create" &&
      candidates.length &&
      !row.decision.confirmed
    )
      throw new HttpsError(
        "failed-precondition",
        `Row ${row.row} may match someone already on the roll. Choose skip, update or add as new.`,
      );
    if (
      row.decision.action === "update" &&
      !people.some(
        (person) =>
          person.id ===
          (row.decision as Extract<ImportDecision, { action: "update" }>)
            .personId,
      )
    )
      throw new HttpsError(
        "invalid-argument",
        `Row ${row.row} points to a person who is not on the roll.`,
      );
  }
  for (let start = 0; start < input.rows.length; start += 400) {
    const writes = db.batch();
    for (const row of input.rows.slice(start, start + 400))
      writes.set(
        batch.collection("rows").doc(String(row.row).padStart(4, "0")),
        {
          row: row.row,
          value: row.value,
          decision: row.decision,
          outcome: "pending",
          personId: "",
          message: row.problems.join("; "),
        },
      );
    await writes.commit();
  }
  // The batch record comes last, so a retry after a partial start rewrites the same pending rows.
  await batch.create({
    fileName: input.fileName,
    createdBy: actor.uid,
    createdAt: Timestamp.now(),
    consentReviewed: input.consentReviewed,
    consentSource: input.consentSource,
    total: input.rows.length,
    pending: input.rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    conflict: 0,
    failed: 0,
  });
  return { batchId: input.batchId };
});
type Row = {
  row: number;
  value: ImportValue;
  decision: ImportDecision;
  outcome: string;
  message: string;
};
// Applies up to 25 pending rows. Each row and its outcome commit together, so a retry never repeats one.
export const processPeopleImport = onCall(async (request) => {
  const actor = await requireRoles(request, EDITOR_ROLES);
  const { batchId } = parse(importProcessSchema, request.data);
  const batch = db.doc(`importBatches/${batchId}`);
  const meta = await batch.get();
  if (!meta.exists)
    throw new HttpsError("not-found", "This import was not found.");
  const pending = await batch
    .collection("rows")
    .where("outcome", "==", "pending")
    .limit(25)
    .get();
  const consent = !!meta.get("consentReviewed");
  const source = String(meta.get("consentSource") || "");
  for (const document of pending.docs) {
    try {
      await db.runTransaction((transaction) =>
        applyRow(
          transaction,
          document.ref,
          batch,
          batchId,
          actor.uid,
          consent,
          source,
        ),
      );
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const row = await transaction.get(document.ref);
        if (row.get("outcome") !== "pending") return;
        transaction.update(document.ref, {
          outcome: "failed",
          message:
            error instanceof HttpsError || error instanceof Error
              ? error.message.slice(0, 300)
              : "The row could not be saved.",
        });
        transaction.update(batch, {
          pending: FieldValue.increment(-1),
          failed: FieldValue.increment(1),
        });
      });
    }
  }
  const left = await batch.get();
  return { remaining: Number(left.get("pending") || 0) };
});
async function applyRow(
  transaction: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  batch: FirebaseFirestore.DocumentReference,
  batchId: string,
  uid: string,
  consent: boolean,
  source: string,
) {
  const snapshot = await transaction.get(ref);
  const row = snapshot.data() as Row;
  if (row.outcome !== "pending") return;
  const finish = (outcome: string, personId: string, message: string) => {
    transaction.update(ref, { outcome, personId, message });
    transaction.update(batch, {
      pending: FieldValue.increment(-1),
      [outcome]: FieldValue.increment(1),
    });
  };
  const decision = row.decision;
  if (decision.action === "skip") return finish("skipped", "", row.message);
  const now = Timestamp.now();
  if (decision.action === "update") {
    const person = db.doc(`people/${decision.personId}`);
    const current = await transaction.get(person);
    if (!current.exists) return finish("failed", "", "The person was removed.");
    // A field someone changed after the preview is left alone and reported.
    const stale = Object.entries(decision.expected).filter(
      ([key, value]) => String(current.get(key) ?? "") !== value,
    );
    if (stale.length)
      return finish(
        "conflict",
        decision.personId,
        `Changed since the preview: ${stale.map(([key]) => key).join(", ")}`,
      );
    const changes: Record<string, unknown> = importChanges(
      row.value,
      decision.expected,
    );
    if (!Object.keys(changes).length)
      return finish("skipped", decision.personId, "Nothing to change");
    // Text consent belongs to a number, so a new mobile number turns texts off.
    if (changes.mobilePhone && current.get("smsOptIn")) {
      changes.smsOptIn = false;
      transaction.create(db.collection("consentEvents").doc(), {
        personId: decision.personId,
        channel: "sms",
        optedIn: false,
        source: `Mobile number changed by import ${batchId}`,
        actor: uid,
        at: now,
      });
    }
    transaction.update(person, { ...changes, updatedBy: uid, updatedAt: now });
    if (changes.preferredName)
      transaction.update(db.doc(`attendanceRoster/${decision.personId}`), {
        preferredName: changes.preferredName,
      });
    return finish("updated", decision.personId, "");
  }
  const value = row.value;
  const id = importPersonId(batchId, row.row);
  const householdRef = db.doc(
    `households/${importHouseholdId(batchId, value.householdKey)}`,
  );
  const [person, household] = await Promise.all([
    transaction.get(db.doc(`people/${id}`)),
    transaction.get(householdRef),
  ]);
  if (person.exists) return finish("created", id, "");
  if (!household.exists)
    transaction.create(householdRef, {
      name: value.householdName,
      address: value.address,
      homePhone: value.homePhone,
      revision: 1,
      importBatchId: batchId,
      updatedBy: uid,
      updatedAt: now,
    });
  const householdName = household.exists
    ? String(household.get("name"))
    : value.householdName;
  // New contacts are opted out unless staff reviewed consent evidence for this file.
  const emailOptIn = consent && value.emailConsent && !!value.email;
  const smsOptIn = consent && value.smsConsent && !!value.mobilePhone;
  const data = personInputSchema.parse({
    firstName: value.firstName,
    lastName: value.lastName,
    preferredName: value.preferredName,
    householdId: householdRef.id,
    membershipStatus: value.membershipStatus,
    email: value.email,
    mobilePhone: value.mobilePhone,
    birthDate: value.birthDate,
    emailOptIn,
    smsOptIn,
    isDeceased: false,
    elderDistrictId: "",
  });
  const personRef = db.doc(`people/${id}`);
  transaction.create(personRef, {
    ...data,
    importBatchId: batchId,
    updatedBy: uid,
    updatedAt: now,
  });
  transaction.create(
    db.doc(`attendanceRoster/${id}`),
    toRoster(id, data, householdName),
  );
  transaction.create(personRef.collection("membershipEvents").doc("import"), {
    ...membershipEventSchema.parse({
      date: value.statusDate,
      fromStatus: null,
      toStatus: value.membershipStatus,
      method: value.method,
      reason: `Imported from a file (batch ${batchId})`,
    }),
    importBatchId: batchId,
  });
  for (const [channel, optedIn] of [
    ["email", emailOptIn],
    ["sms", smsOptIn],
  ] as const)
    if (optedIn)
      transaction.create(db.collection("consentEvents").doc(), {
        personId: id,
        channel,
        optedIn: true,
        source: `Import ${batchId}: ${source}`,
        actor: uid,
        at: now,
      });
  return finish("created", id, "");
}
