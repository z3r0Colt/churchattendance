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
  relationshipRemoveSchema,
  relationshipSchema,
  type Relationship,
  communionBulkSchema,
  communionDecisionSchema,
  communionRecordSchema,
  type CommunionDecision,
  type CommunionRecord,
  type OfficerDecision,
  type OfficerPolicy,
  type Role,
} from "@sycamore/shared";
import {
  chmsCall,
  useCollection,
  useReportData,
  type PrivateRecord,
} from "./chms";
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
// The approved list and participation are Session only, read through the audited private-records API.
export function useCommunionData(roles: Role[]) {
  const session = hasRole(roles, SESSION_ROLES);
  const report = useReportData();
  const decisions = usePrivateRecords<CommunionDecision>(
    "communionDecisions",
    session,
  );
  const records = usePrivateRecords<CommunionRecord>(
    "communionRecords",
    session,
  );
  return {
    ...report,
    decisions: decisions.rows,
    records: records.rows,
    error: report.error || decisions.error || records.error,
  };
}
export const saveCommunionDecision = (value: unknown) =>
  chmsCall("saveCommunionDecision", communionDecisionSchema.parse(value));
export const approveCommunicants = (value: unknown) =>
  chmsCall<{ created: number }>(
    "approveCommunicants",
    communionBulkSchema.parse(value),
  );
export const saveCommunionRecord = (value: unknown) =>
  chmsCall("saveCommunionRecord", communionRecordSchema.parse(value));
// Family links are staff-readable and grant no other access.
export const useRelationships = () =>
  useCollection<Relationship>("relationships");
export const saveRelationship = (value: unknown) =>
  chmsCall("saveRelationship", relationshipSchema.parse(value));
export const removeRelationship = (value: unknown) =>
  chmsCall("removeRelationship", relationshipRemoveSchema.parse(value));
