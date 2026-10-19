import {
  SESSION_ROLES,
  disciplineOn,
  hasRole,
  quorumMeetingSchema,
  quorumPolicySchema,
  type QuorumMeeting,
  type QuorumPolicy,
  officeRemoveSchema,
  officeSchema,
  officerDecisionSchema,
  officerPolicySchema,
  type OfficerDecision,
  type OfficerPolicy,
  type Role,
} from "@sycamore/shared";
import { chmsCall, useReportData, type PrivateRecord } from "./chms";
import { usePrivateRecords } from "./private";

// Office history is staff-readable. Policies, decisions and discipline flags come from the audited Session API.
export function useOfficerData(roles: Role[]) {
  const session = hasRole(roles, SESSION_ROLES);
  const report = useReportData();
  const policies = usePrivateRecords<OfficerPolicy>("officerPolicies", session);
  const decisions = usePrivateRecords<OfficerDecision>(
    "officerDecisions",
    session,
  );
  const discipline = usePrivateRecords<PrivateRecord>(
    "sessionPrivate",
    session,
  );
  const quorumPolicies = usePrivateRecords<QuorumPolicy>(
    "quorumPolicies",
    session,
  );
  const meetings = usePrivateRecords<QuorumMeeting>("quorumMeetings", session);
  return {
    ...report,
    policies: policies.rows,
    decisions: decisions.rows,
    disciplinedOn: (personId: string, date: string) =>
      disciplineOn(
        discipline.rows.find((row) => row.id === personId),
        date,
      ),
    quorumPolicies: quorumPolicies.rows,
    meetings: meetings.rows,
    error:
      report.error ||
      policies.error ||
      decisions.error ||
      discipline.error ||
      quorumPolicies.error ||
      meetings.error,
  };
}
export const saveOffice = (value: unknown) =>
  chmsCall("saveOffice", officeSchema.parse(value));
export const removeOffice = (value: unknown) =>
  chmsCall("removeOffice", officeRemoveSchema.parse(value));
export const saveOfficerPolicy = (value: unknown) =>
  chmsCall("saveOfficerPolicy", officerPolicySchema.parse(value));
export const saveOfficerDecision = (value: unknown) =>
  chmsCall("saveOfficerDecision", officerDecisionSchema.parse(value));
export const saveQuorumPolicy = (value: unknown) =>
  chmsCall("saveQuorumPolicy", quorumPolicySchema.parse(value));
export const saveQuorumMeeting = (value: unknown) =>
  chmsCall("saveQuorumMeeting", quorumMeetingSchema.parse(value));
export type OfficerData = ReturnType<typeof useOfficerData>;
