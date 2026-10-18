import {
  SESSION_ROLES,
  hasRole,
  type Role,
  type ElderDistrict,
  type FollowUp,
  type CareNote,
} from "@sycamore/shared";
import { useCollection, useReportData } from "./chms";
import { usePrivateRecords } from "./private";
export function useAttendanceReports(roles: Role[]) {
  const data = useReportData(),
    session = hasRole(roles, SESSION_ROLES);
  const districts = useCollection<ElderDistrict>("elderDistricts");
  const followUps = usePrivateRecords<FollowUp>("followUps", session, "report");
  const notes = usePrivateRecords<CareNote>("careNotes", session, "report");
  return {
    ...data,
    districts: districts.rows,
    session,
    careReady: !session || (followUps.loaded && notes.loaded),
    careError: followUps.error || notes.error,
    followUps: session ? followUps.rows : undefined,
    careNotes: session ? notes.rows : undefined,
    error: data.error || districts.error,
    loaded: data.loaded && districts.loaded,
  };
}
