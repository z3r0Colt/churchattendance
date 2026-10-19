import { describe, expect, it } from "vitest";
import {
  ancestors,
  familyOf,
  familyTree,
  relationshipProblem,
  relationshipSchema,
  type Relationship,
} from "./index.js";

const link = (
  id: string,
  personId: string,
  relatedPersonId: string,
  kind: Relationship["kind"],
  extra: Partial<Relationship> = {},
): Relationship => ({
  id,
  personId,
  relatedPersonId,
  kind,
  label: "",
  startDate: "",
  endDate: "",
  revision: 1,
  ...extra,
});
// Fictional family: Abe and Bea are parents of Cal and Dot. Cal is parent of Eve.
const links = [
  link("s1", "abe", "bea", "spouse", { startDate: "1980-06-01" }),
  link("p1", "abe", "cal", "parent"),
  link("p2", "bea", "cal", "parent"),
  link("p3", "abe", "dot", "parent"),
  link("p4", "cal", "eve", "parent"),
];
const draft = (
  personId: string,
  relatedPersonId: string,
  kind: Relationship["kind"],
  endDate = "",
) => ({ id: "new", personId, relatedPersonId, kind, endDate });

describe("family links", () => {
  it("rejects self links, missing labels and an anniversary without a wedding date", () => {
    const base = {
      id: "x",
      personId: "abe",
      relatedPersonId: "bea",
      kind: "spouse",
    };
    expect(relationshipSchema.safeParse(base).success).toBe(true);
    expect(
      relationshipSchema.safeParse({ ...base, relatedPersonId: "abe" }).success,
    ).toBe(false);
    expect(
      relationshipSchema.safeParse({ ...base, kind: "other" }).success,
    ).toBe(false);
    expect(
      relationshipSchema.safeParse({ ...base, addAnniversary: true }).success,
    ).toBe(false);
    expect(
      relationshipSchema.safeParse({
        ...base,
        addAnniversary: true,
        startDate: "1980-06-01",
      }).success,
    ).toBe(true);
  });
  it("refuses ancestry cycles and more than two parents", () => {
    expect([...ancestors("eve", links)].sort()).toEqual(["abe", "bea", "cal"]);
    expect(relationshipProblem(draft("eve", "abe", "parent"), links)).toBe(
      "That would make someone their own ancestor.",
    );
    expect(
      relationshipProblem(draft("dot", "eve", "parent"), links),
    ).toBeNull();
    expect(relationshipProblem(draft("dot", "cal", "parent"), links)).toBe(
      "Two parents are already recorded. Record others as a guardian.",
    );
  });
  it("allows one current spouse and one current link per pair", () => {
    expect(relationshipProblem(draft("abe", "fay", "spouse"), links)).toBe(
      "One of them already has a current spouse recorded. End that link first.",
    );
    expect(relationshipProblem(draft("bea", "abe", "sibling"), links)).toBe(
      "These two people already have a current family link. End or change it first.",
    );
    const ended = [
      ...links.filter((row) => row.id !== "s1"),
      link("s1", "abe", "bea", "spouse", { endDate: "2020-01-01" }),
    ];
    // Abe is Dot's parent, so that pair already has a current link.
    expect(relationshipProblem(draft("abe", "dot", "spouse"), ended)).toBe(
      "These two people already have a current family link. End or change it first.",
    );
    expect(
      relationshipProblem(draft("abe", "fay", "spouse"), ended),
    ).toBeNull();
  });
  it("lists family with siblings from a shared parent and marks the late", () => {
    const family = familyOf("cal", links, [{ id: "abe", isDeceased: true }]);
    expect(family.parents.map((row) => [row.personId, row.late])).toEqual([
      ["abe", true],
      ["bea", false],
    ]);
    expect(family.children.map((row) => row.personId)).toEqual(["eve"]);
    expect(family.siblings.map((row) => row.personId)).toEqual(["dot"]);
    expect(familyTree("eve", links)).toEqual({
      grandparents: ["abe", "bea"],
      parents: ["cal"],
      spouses: [],
      children: [],
      grandchildren: [],
    });
  });
});
