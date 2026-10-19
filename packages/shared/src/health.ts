import { z } from "zod";
import { DateTime } from "luxon";
import { dateSchema, idSchema } from "./domain.js";
import type { ContactFlag } from "./contact.js";

export const assessmentLabelSchema = z
  .object({ id: idSchema, name: z.string().trim().min(1).max(40) })
  .strict();
// Offered as an optional starting set. The Session decides whether to adopt or change it.
export const SUGGESTED_ASSESSMENT_LABELS = [
  { id: "healthy", name: "Healthy" },
  { id: "weak", name: "Weak" },
  { id: "stray", name: "Stray" },
  { id: "lost", name: "Lost" },
];
export const healthIndicatorKeys = [
  "attendance",
  "involvement",
  "contact",
  "visit",
  "communion",
  "relationships",
] as const;
export type HealthIndicatorKey = (typeof healthIndicatorKeys)[number];
export const healthIndicatorLabels: Record<HealthIndicatorKey, string> = {
  attendance: "Attendance",
  involvement: "Involvement",
  contact: "Contact",
  visit: "Household visit",
  communion: "Communion",
  relationships: "Relationships",
};
export const healthSettingsSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().default(0),
    indicators: z
      .array(z.enum(healthIndicatorKeys))
      .max(6)
      .default([...healthIndicatorKeys]),
    attendanceWeeks: z.number().int().min(4).max(52).default(12),
    attendanceBelowPercent: z.number().int().min(0).max(100).default(50),
    visitWithinDays: z.number().int().min(30).max(1095).default(365),
    labels: z
      .array(assessmentLabelSchema)
      .max(12)
      .refine(
        (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
        "Use each label once",
      )
      .default([]),
  })
  .strict();
export type HealthSettings = Omit<
  z.infer<typeof healthSettingsSchema>,
  "expectedRevision"
> & { revision: number };
export const assessmentSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().nonnegative().default(0),
    personId: idSchema,
    labelId: z.union([idSchema, z.literal("")]).default(""),
    reasons: z.string().trim().min(1).max(4000),
    assessedOn: dateSchema,
    reviewOn: dateSchema,
  })
  .strict()
  .refine(
    (row) => row.reviewOn >= row.assessedOn,
    "Set the review date on or after the assessment",
  );
export type Assessment = Omit<
  z.infer<typeof assessmentSchema>,
  "expectedRevision"
> & { revision: number; authorUid: string };

export type IndicatorState = "within" | "below" | "info" | "unknown";
export const indicatorStateLabels: Record<IndicatorState, string> = {
  within: "Within policy",
  below: "Below policy",
  info: "Recorded",
  unknown: "Unknown",
};
export type HealthIndicator = {
  key: HealthIndicatorKey;
  state: IndicatorState;
  explanation: string;
};
export type HealthInputs = {
  // The Phase 6 shepherding row value: a percentage or a review message.
  attendancePercent: number | string | undefined;
  groups: number;
  serving: number;
  involvementRecorded: boolean;
  contact: ContactFlag | undefined;
  lastVisit: string;
  visitRecordsSince: string;
  // Recorded communion services in the last 12 months and how many the person partook at.
  communion?: { services: number; partook: number };
  // Recorded family links, as counts by kind. Names and private care facts are not included.
  family?: { spouse: number; parents: number; children: number; other: number };
};
// Indicators restate recorded facts for pastoral review. They never judge a person's spiritual condition.
export function healthIndicators(
  inputs: HealthInputs,
  settings: Pick<
    HealthSettings,
    | "indicators"
    | "attendanceWeeks"
    | "attendanceBelowPercent"
    | "visitWithinDays"
  >,
  today: string,
): HealthIndicator[] {
  const days = (from: string) =>
    Math.floor(
      DateTime.fromISO(today, { zone: "utc" }).diff(
        DateTime.fromISO(from, { zone: "utc" }),
        "days",
      ).days,
    );
  const build: Record<HealthIndicatorKey, () => HealthIndicator> = {
    attendance: () =>
      typeof inputs.attendancePercent === "number"
        ? {
            key: "attendance",
            state:
              inputs.attendancePercent < settings.attendanceBelowPercent
                ? "below"
                : "within",
            explanation: `${inputs.attendancePercent}% of recorded services in the last ${settings.attendanceWeeks} weeks. Policy is ${settings.attendanceBelowPercent}% or more.`,
          }
        : {
            key: "attendance",
            state: "unknown",
            explanation:
              inputs.attendancePercent === "Review history"
                ? "Membership history needs review before attendance can be measured."
                : "No recorded services to measure in this period.",
          },
    involvement: () =>
      inputs.involvementRecorded
        ? {
            key: "involvement",
            state: "info",
            explanation: `In ${inputs.groups} active group${inputs.groups === 1 ? "" : "s"}. Served ${inputs.serving} time${inputs.serving === 1 ? "" : "s"} in the last 90 days.`,
          }
        : {
            key: "involvement",
            state: "unknown",
            explanation: "No groups or serving schedule are recorded yet.",
          },
    contact: () => {
      const flag = inputs.contact;
      if (!flag)
        return {
          key: "contact",
          state: "unknown",
          explanation:
            "Not tracked. Set a contact policy that includes this status.",
        };
      return {
        key: "contact",
        state:
          flag.state === "gap"
            ? "below"
            : flag.state === "unknown"
              ? "unknown"
              : "within",
        explanation:
          flag.state === "gap"
            ? `No qualifying contact for ${flag.thresholdDays + flag.daysPastDue} days. Policy is ${flag.thresholdDays} days.`
            : flag.state === "unknown"
              ? "Contact records are too recent to judge."
              : flag.lastContact
                ? `Last contact ${flag.lastContact.date}.`
                : "Recently added. Not yet due for contact.",
      };
    },
    visit: () => {
      if (inputs.lastVisit) {
        const since = days(inputs.lastVisit);
        return {
          key: "visit",
          state: since > settings.visitWithinDays ? "below" : "within",
          explanation: `Household last visited ${inputs.lastVisit}, ${since} days ago. Policy is ${settings.visitWithinDays} days.`,
        };
      }
      return inputs.visitRecordsSince &&
        days(inputs.visitRecordsSince) > settings.visitWithinDays
        ? {
            key: "visit",
            state: "below",
            explanation: `No completed household visit since records began ${inputs.visitRecordsSince}.`,
          }
        : {
            key: "visit",
            state: "unknown",
            explanation: "Visit records are too recent to judge.",
          };
    },
    communion: () =>
      inputs.communion?.services
        ? {
            key: "communion",
            state: "info",
            explanation: `Partook at ${inputs.communion.partook} of ${inputs.communion.services} recorded communion service${inputs.communion.services === 1 ? "" : "s"} in the last 12 months.`,
          }
        : {
            key: "communion",
            state: "unknown",
            explanation:
              "No communion participation recorded in the last 12 months.",
          },
    relationships: () => {
      const family = inputs.family;
      const parts = family
        ? [
            family.spouse ? "a spouse" : "",
            family.parents
              ? `${family.parents} parent${family.parents === 1 ? "" : "s"}`
              : "",
            family.children
              ? `${family.children} child${family.children === 1 ? "" : "ren"}`
              : "",
            family.other
              ? `${family.other} other relative${family.other === 1 ? "" : "s"}`
              : "",
          ].filter(Boolean)
        : [];
      return parts.length
        ? {
            key: "relationships",
            state: "info",
            explanation: `Family links recorded: ${parts.join(", ")}.`,
          }
        : {
            key: "relationships",
            state: "unknown",
            explanation: "No family links recorded.",
          };
    },
  };
  return healthIndicatorKeys
    .filter((key) => settings.indicators.includes(key))
    .map((key) => build[key]());
}
