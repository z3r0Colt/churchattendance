import { z } from "zod";
import { DateTime } from "luxon";
import {
  dateSchema,
  idSchema,
  membershipEventSchema,
  membershipStatuses,
  statusLabels,
  type MembershipStatus,
  type Person,
} from "./domain.js";
import { normalizeEmail, normalizePhone } from "./communication.js";

export const IMPORT_ROW_LIMIT = 1000;
export const IMPORT_FILE_BYTES = 2_000_000;
export const importFields = [
  "firstName",
  "lastName",
  "preferredName",
  "email",
  "mobilePhone",
  "birthDate",
  "membershipStatus",
  "household",
  "address",
  "homePhone",
  "statusDate",
  "method",
  "emailConsent",
  "smsConsent",
] as const;
export type ImportField = (typeof importFields)[number];
export const importFieldLabels: Record<ImportField, string> = {
  firstName: "First name",
  lastName: "Last name",
  preferredName: "Preferred name",
  email: "Email",
  mobilePhone: "Mobile phone",
  birthDate: "Birth date",
  membershipStatus: "Membership status",
  household: "Household",
  address: "Address",
  homePhone: "Home phone",
  statusDate: "Date received",
  method: "How received",
  emailConsent: "Email consent",
  smsConsent: "Text consent",
};
const synonyms: Record<ImportField, string[]> = {
  firstName: ["first name", "first", "given name", "firstname"],
  lastName: ["last name", "last", "surname", "family name", "lastname"],
  preferredName: ["preferred name", "nickname", "goes by"],
  email: ["email", "e-mail", "email address"],
  mobilePhone: ["mobile", "mobile phone", "cell", "cell phone", "phone"],
  birthDate: ["birth date", "birthdate", "birthday", "date of birth", "dob"],
  membershipStatus: ["status", "membership", "membership status"],
  household: ["household", "household name", "household id", "family"],
  address: ["address", "street address", "mailing address", "home address"],
  homePhone: ["home phone", "home", "landline"],
  statusDate: ["date received", "received on", "member since", "status date"],
  method: ["how received", "received by", "method"],
  emailConsent: ["email consent", "email opt in", "email ok"],
  smsConsent: ["text consent", "sms consent", "sms opt in", "texts ok"],
};
const tidy = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");
// Suggested columns from header names. Staff confirm or change every choice.
export function guessMapping(headers: string[]) {
  const used = new Set<ImportField>();
  return headers.map((header) => {
    const field = importFields.find(
      (key) => !used.has(key) && synonyms[key].includes(tidy(header)),
    );
    if (field) used.add(field);
    return field ?? "";
  });
}
// Calendar dates arrive as ISO or US month/day/year. Two-digit years are refused as ambiguous.
export function parseImportDate(value: string): string | null {
  const text = value.trim();
  if (!text) return "";
  const iso = DateTime.fromISO(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return iso.isValid ? text : null;
  const us = DateTime.fromFormat(text, "M/d/yyyy");
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text) && us.isValid
    ? us.toISODate()
    : null;
}
export function parseImportStatus(value: string): MembershipStatus | null {
  const text = tidy(value).replace(/-/g, " ");
  if (!text) return null;
  for (const status of membershipStatuses)
    if (
      text === status.toLowerCase() ||
      text === statusLabels[status].toLowerCase()
    )
      return status;
  const words: Record<string, MembershipStatus> = {
    communicant: "communicant",
    baptized: "baptized",
    baptised: "baptized",
    "baptised member": "baptized",
    "non resident": "nonResident",
    nonresident: "nonResident",
    "non resident member": "nonResident",
  };
  return words[text] ?? null;
}
const methods = membershipEventSchema.shape.method.options;
type Method = (typeof methods)[number];
function parseYes(value: string): boolean | null {
  const text = value.trim().toLowerCase();
  if (["", "no", "n", "false", "0"].includes(text)) return false;
  if (["yes", "y", "true", "1", "x"].includes(text)) return true;
  return null;
}
// A cell that a spreadsheet would treat as a formula is never evaluated and is refused as data.
export const looksLikeFormula = (value: string) =>
  /^[=+\-@]/.test(value.trim()) && !/^[+-]?\d/.test(value.trim());

export const importValueSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    preferredName: z.string().trim().max(100),
    email: z.union([z.email(), z.literal("")]),
    mobilePhone: z.string().max(20),
    birthDate: z.union([dateSchema, z.literal("")]),
    membershipStatus: z.enum(membershipStatuses),
    householdKey: z.string().max(200),
    householdName: z.string().trim().min(1).max(100),
    address: z.string().max(500),
    homePhone: z.string().max(40),
    statusDate: dateSchema,
    method: z.enum(methods),
    emailConsent: z.boolean(),
    smsConsent: z.boolean(),
  })
  .strict();
export type ImportValue = z.infer<typeof importValueSchema>;
export type ImportDefaults = {
  status: MembershipStatus | "";
  statusDate: string;
};
export function normalizeImportRow(
  raw: Partial<Record<ImportField, string>>,
  defaults: ImportDefaults,
  rowNumber: number,
): { value?: ImportValue; errors: string[] } {
  const errors: string[] = [];
  const cell = (key: ImportField) => String(raw[key] ?? "").trim();
  for (const key of importFields)
    if (looksLikeFormula(cell(key)))
      errors.push(`${importFieldLabels[key]} looks like a spreadsheet formula`);
  if (!cell("firstName")) errors.push("First name is missing");
  if (!cell("lastName")) errors.push("Last name is missing");
  let email = "";
  if (cell("email")) {
    email = normalizeEmail(cell("email"));
    if (!z.email().safeParse(email).success) errors.push("Email is not valid");
  }
  let mobilePhone = "";
  try {
    mobilePhone = normalizePhone(cell("mobilePhone"));
  } catch {
    errors.push("Mobile phone is not a valid number");
  }
  const birthDate = parseImportDate(cell("birthDate"));
  if (birthDate === null) errors.push("Birth date is not a date");
  const status = cell("membershipStatus")
    ? parseImportStatus(cell("membershipStatus"))
    : defaults.status || null;
  if (!status) errors.push("Membership status is missing or not recognized");
  const statusDate = parseImportDate(cell("statusDate"));
  if (statusDate === null) errors.push("Date received is not a date");
  const method = (cell("method").toLowerCase() || "initial") as Method;
  if (!methods.includes(method))
    errors.push(`How received must be one of: ${methods.join(", ")}`);
  const emailConsent = parseYes(cell("emailConsent"));
  const smsConsent = parseYes(cell("smsConsent"));
  if (emailConsent === null) errors.push("Email consent must be yes or no");
  if (smsConsent === null) errors.push("Text consent must be yes or no");
  if (errors.length) return { errors };
  const address = cell("address");
  // Rows share a household by its name or ID, or else by last name and address.
  const householdKey = (
    cell("household") ||
    (address ? `${cell("lastName")}|${address}` : `row ${rowNumber}`)
  ).toLowerCase();
  const parsed = importValueSchema.safeParse({
    firstName: cell("firstName"),
    lastName: cell("lastName"),
    preferredName: cell("preferredName"),
    email,
    mobilePhone,
    birthDate,
    membershipStatus: status,
    householdKey,
    householdName: cell("household") || cell("lastName"),
    address,
    homePhone: cell("homePhone"),
    statusDate: statusDate || defaults.statusDate,
    method,
    emailConsent,
    smsConsent,
  });
  return parsed.success
    ? { value: parsed.data, errors: [] }
    : { errors: parsed.error.issues.map((issue) => issue.message) };
}
export type ImportCandidate = { personId: string; reason: string };
// Possible existing matches, strongest first. A match is a question for staff, never an automatic update.
export function importCandidates(
  value: Pick<
    ImportValue,
    "firstName" | "lastName" | "email" | "mobilePhone" | "birthDate"
  >,
  people: Pick<
    Person,
    "id" | "firstName" | "lastName" | "email" | "mobilePhone" | "birthDate"
  >[],
): ImportCandidate[] {
  const same = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  const found = new Map<string, string>();
  for (const person of people) {
    const name =
      same(person.firstName, value.firstName) &&
      same(person.lastName, value.lastName);
    const reason =
      value.email && same(person.email, value.email)
        ? "Same email"
        : value.mobilePhone && person.mobilePhone === value.mobilePhone
          ? "Same mobile phone"
          : name && value.birthDate && person.birthDate === value.birthDate
            ? "Same name and birth date"
            : name
              ? "Same name"
              : "";
    if (reason && !found.has(person.id)) found.set(person.id, reason);
  }
  return [...found].map(([personId, reason]) => ({ personId, reason }));
}
export type PreviewRow = {
  row: number;
  value?: ImportValue;
  errors: string[];
  candidates: ImportCandidate[];
};
// Validation and duplicate review without writing anything.
export function previewImport(
  rows: Partial<Record<ImportField, string>>[],
  people: Parameters<typeof importCandidates>[1],
  defaults: ImportDefaults,
): PreviewRow[] {
  const seen: { row: number; value: ImportValue }[] = [];
  return rows.map((raw, index) => {
    const row = index + 1;
    const { value, errors } = normalizeImportRow(raw, defaults, row);
    if (!value) return { row, errors, candidates: [] };
    const earlier = seen.find(
      (other) =>
        (value.email && other.value.email === value.email) ||
        (other.value.firstName.toLowerCase() ===
          value.firstName.toLowerCase() &&
          other.value.lastName.toLowerCase() === value.lastName.toLowerCase() &&
          other.value.birthDate === value.birthDate),
    );
    seen.push({ row, value });
    if (earlier)
      return {
        row,
        value,
        errors: [`Looks like the same person as row ${earlier.row}`],
        candidates: [],
      };
    return {
      row,
      value,
      errors: [],
      candidates: importCandidates(value, people),
    };
  });
}
// Existing records may change only these fields, and only after a row decision.
export const importUpdateFields = [
  "preferredName",
  "email",
  "mobilePhone",
  "birthDate",
] as const;
export const importDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip") }).strict(),
  // confirmed is required when the row had possible matches.
  z
    .object({
      action: z.literal("create"),
      confirmed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      personId: idSchema,
      // The values the reviewer saw. A field changed since then is not overwritten.
      expected: z.partialRecord(
        z.enum(importUpdateFields),
        z.string().max(500),
      ),
    })
    .strict(),
]);
export type ImportDecision = z.infer<typeof importDecisionSchema>;
export const importStartSchema = z
  .object({
    batchId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    fileName: z.string().trim().min(1).max(200),
    consentReviewed: z.boolean(),
    consentSource: z.string().trim().max(300).default(""),
    rows: z
      .array(
        z
          .object({
            row: z.number().int().min(1).max(IMPORT_ROW_LIMIT),
            // A row that could not be read is kept as skipped, with its problems, for the batch record.
            value: importValueSchema.nullable(),
            problems: z.array(z.string().max(300)).max(30).default([]),
            decision: importDecisionSchema,
          })
          .strict()
          .refine((row) => !!row.value || row.decision.action === "skip", {
            message: "A row with problems can only be skipped",
            path: ["decision"],
          }),
      )
      .min(1)
      .max(IMPORT_ROW_LIMIT),
  })
  .strict()
  .refine((input) => !input.consentReviewed || !!input.consentSource, {
    message: "Describe the consent evidence you reviewed",
    path: ["consentSource"],
  })
  .refine(
    (input) =>
      new Set(input.rows.map((row) => row.row)).size === input.rows.length,
    "Each row appears once",
  );
export const importProcessSchema = z
  .object({ batchId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) })
  .strict();
export type ImportOutcome =
  "pending" | "created" | "updated" | "skipped" | "conflict" | "failed";
// A stable Firestore ID for a household key within one batch.
export function importHouseholdId(batchId: string, key: string) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `imp-${batchId}-h${hash.toString(36)}`;
}
export const importPersonId = (batchId: string, row: number) =>
  `imp-${batchId}-r${row}`;
// Changed fields only, compared with what the reviewer saw on the existing record.
export function importChanges(
  value: ImportValue,
  existing: Partial<Record<(typeof importUpdateFields)[number], string>>,
) {
  return Object.fromEntries(
    importUpdateFields
      .filter((key) => value[key] && value[key] !== (existing[key] ?? ""))
      .map((key) => [key, value[key]]),
  ) as Partial<Record<(typeof importUpdateFields)[number], string>>;
}
