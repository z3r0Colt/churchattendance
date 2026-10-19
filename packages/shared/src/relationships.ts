import { z } from "zod";
import { dateSchema, idSchema, type Person } from "./domain.js";

// parent and guardian read "personId is the parent (or guardian) of relatedPersonId".
export const relationshipKinds = [
  "spouse",
  "parent",
  "guardian",
  "sibling",
  "other",
] as const;
export type RelationshipKind = (typeof relationshipKinds)[number];
const optionalDate = z.union([dateSchema, z.literal("")]).default("");
export const relationshipSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    personId: idSchema,
    relatedPersonId: idSchema,
    kind: z.enum(relationshipKinds),
    label: z.string().trim().max(60).default(""),
    // For a spouse the start date is the wedding date.
    startDate: optionalDate,
    endDate: optionalDate,
    addAnniversary: z.boolean().default(false),
  })
  .strict()
  .refine((row) => row.personId !== row.relatedPersonId, {
    message: "Choose two different people",
    path: ["relatedPersonId"],
  })
  .refine(
    (row) => !row.startDate || !row.endDate || row.endDate >= row.startDate,
    {
      message: "The end cannot be before the start",
      path: ["endDate"],
    },
  )
  .refine((row) => row.kind !== "other" || !!row.label, {
    message: "Name the relationship",
    path: ["label"],
  })
  .refine(
    (row) => !row.addAnniversary || (row.kind === "spouse" && !!row.startDate),
    {
      message: "A wedding anniversary needs a spouse and a wedding date",
      path: ["addAnniversary"],
    },
  );
export type RelationshipInput = z.infer<typeof relationshipSchema>;
export type Relationship = Omit<
  RelationshipInput,
  "expectedRevision" | "addAnniversary"
> & { revision: number };
export const relationshipRemoveSchema = z
  .object({ id: idSchema, expectedRevision: z.number().int().positive() })
  .strict();

const current = (row: Pick<Relationship, "endDate">) => !row.endDate;
// Everyone above a person through parent links, nearest first.
export function ancestors(personId: string, links: Relationship[]) {
  const found = new Set<string>();
  const queue = [personId];
  while (queue.length) {
    const child = queue.shift()!;
    for (const row of links)
      if (
        row.kind === "parent" &&
        row.relatedPersonId === child &&
        !found.has(row.personId)
      ) {
        found.add(row.personId);
        queue.push(row.personId);
      }
  }
  return found;
}
// Why a new or changed link cannot be saved, or null when it can.
export function relationshipProblem(
  input: Pick<
    RelationshipInput,
    "id" | "personId" | "relatedPersonId" | "kind" | "endDate"
  >,
  existing: Relationship[],
): string | null {
  const others = existing.filter((row) => row.id !== input.id);
  const samePair = (row: Relationship) =>
    (row.personId === input.personId &&
      row.relatedPersonId === input.relatedPersonId) ||
    (row.personId === input.relatedPersonId &&
      row.relatedPersonId === input.personId);
  // Two people have at most one current link, whatever its kind.
  if (current(input) && others.some((row) => samePair(row) && current(row)))
    return "These two people already have a current family link. End or change it first.";
  if (input.kind === "spouse" && current(input))
    for (const id of [input.personId, input.relatedPersonId])
      if (
        others.some(
          (row) =>
            row.kind === "spouse" &&
            current(row) &&
            (row.personId === id || row.relatedPersonId === id),
        )
      )
        return "One of them already has a current spouse recorded. End that link first.";
  if (input.kind === "parent") {
    const parents = [input.personId, ...ancestors(input.personId, others)];
    if (parents.includes(input.relatedPersonId))
      return "That would make someone their own ancestor.";
    if (
      others.filter(
        (row) =>
          row.kind === "parent" &&
          row.relatedPersonId === input.relatedPersonId,
      ).length >= 2
    )
      return "Two parents are already recorded. Record others as a guardian.";
  }
  return null;
}
export type FamilyMember = {
  linkId: string;
  personId: string;
  role: string;
  since: string;
  ended: string;
  late: boolean;
};
// A person's family, from explicit links. Siblings also come from a shared recorded parent.
export function familyOf(
  personId: string,
  links: Relationship[],
  people: Pick<Person, "id" | "isDeceased">[],
) {
  const late = (id: string) => !!people.find((p) => p.id === id)?.isDeceased;
  const member = (
    row: Relationship,
    other: string,
    role: string,
  ): FamilyMember => ({
    linkId: row.id,
    personId: other,
    role,
    since: row.startDate,
    ended: row.endDate,
    late: late(other),
  });
  const mine = links.filter(
    (row) => row.personId === personId || row.relatedPersonId === personId,
  );
  const other = (row: Relationship) =>
    row.personId === personId ? row.relatedPersonId : row.personId;
  const family = {
    spouses: mine
      .filter((row) => row.kind === "spouse")
      .map((row) => member(row, other(row), "Spouse")),
    parents: mine
      .filter(
        (row) => row.kind === "parent" && row.relatedPersonId === personId,
      )
      .map((row) => member(row, row.personId, "Parent")),
    children: mine
      .filter((row) => row.kind === "parent" && row.personId === personId)
      .map((row) => member(row, row.relatedPersonId, "Child")),
    guardians: mine
      .filter(
        (row) => row.kind === "guardian" && row.relatedPersonId === personId,
      )
      .map((row) => member(row, row.personId, "Guardian")),
    wards: mine
      .filter((row) => row.kind === "guardian" && row.personId === personId)
      .map((row) => member(row, row.relatedPersonId, "In their care")),
    siblings: mine
      .filter((row) => row.kind === "sibling")
      .map((row) => member(row, other(row), "Sibling")),
    other: mine
      .filter((row) => row.kind === "other")
      .map((row) => member(row, other(row), row.label)),
  };
  const parentIds = family.parents.map((row) => row.personId);
  for (const row of links)
    if (
      row.kind === "parent" &&
      parentIds.includes(row.personId) &&
      row.relatedPersonId !== personId &&
      !family.siblings.some((s) => s.personId === row.relatedPersonId)
    )
      family.siblings.push({
        ...member(row, row.relatedPersonId, "Sibling"),
        linkId: "",
      });
  return family;
}
// Three generations either side, as person IDs, for the family tree view.
export function familyTree(personId: string, links: Relationship[]) {
  const parentsOf = (id: string) =>
    links
      .filter((row) => row.kind === "parent" && row.relatedPersonId === id)
      .map((row) => row.personId);
  const childrenOf = (id: string) =>
    links
      .filter((row) => row.kind === "parent" && row.personId === id)
      .map((row) => row.relatedPersonId);
  const unique = (ids: string[]) => [...new Set(ids)];
  const parents = parentsOf(personId);
  const children = childrenOf(personId);
  return {
    grandparents: unique(parents.flatMap(parentsOf)),
    parents,
    spouses: links
      .filter(
        (row) =>
          row.kind === "spouse" &&
          current(row) &&
          (row.personId === personId || row.relatedPersonId === personId),
      )
      .map((row) =>
        row.personId === personId ? row.relatedPersonId : row.personId,
      ),
    children,
    grandchildren: unique(children.flatMap(childrenOf)),
  };
}
