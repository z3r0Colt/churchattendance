import { useEffect, useState } from "react";
import {
  SESSION_ROLES,
  completeVisitSchema,
  contactPolicySchema,
  hasRole,
  visitRoundSchema,
  visitSchema,
  type CareNote,
  type ContactEvent,
  type ContactPolicy,
  type PastoralVisit,
  type Role,
  type VisitLogistics,
  type VisitRound,
} from "@sycamore/shared";
import { chmsCall, useCollection, usePublicChms, type Assignee } from "./chms";
import { usePrivateRecords } from "./private";

// Visit plans stay in component memory through the audited private API, never the attendance cache.
export function useShepherdingData(roles: Role[]) {
  const session = hasRole(roles, SESSION_ROLES);
  const publicData = usePublicChms();
  const visits = usePrivateRecords<PastoralVisit>("pastoralVisits", session);
  const rounds = usePrivateRecords<VisitRound>("visitRounds", session);
  const notes = usePrivateRecords<CareNote>("careNotes", session, "report");
  const districts = useCollection<{
    id: string;
    name: string;
    archived?: boolean;
  }>("elderDistricts");
  const [users, setUsers] = useState<Assignee[]>([]);
  useEffect(() => {
    if (session)
      void chmsCall<Assignee[]>("getCareAssignees", {})
        .then(setUsers)
        .catch(() => setUsers([]));
  }, [session]);
  return {
    ...publicData,
    visits: visits.rows,
    rounds: rounds.rows,
    visitNotes: notes.rows.filter((row) => row.kind === "visit"),
    users,
    districts: districts.rows,
    loaded: visits.loaded && rounds.loaded,
    error:
      publicData.error || visits.error || rounds.error || notes.error || "",
  };
}
export function useVisitLogistics(enabled: boolean) {
  const [state, setState] = useState<{
    visits: VisitLogistics[];
    zone: string;
    error: string;
  }>({ visits: [], zone: "America/Indiana/Indianapolis", error: "" });
  useEffect(() => {
    let active = true;
    const load = () =>
      enabled &&
      void chmsCall<{ visits: VisitLogistics[]; zone: string }>(
        "getVisitLogistics",
        {},
      )
        .then((value) => active && setState({ ...value, error: "" }))
        .catch(
          () =>
            active &&
            setState((before) => ({
              ...before,
              visits: [],
              error:
                "Visit schedules could not be loaded. Check your connection.",
            })),
        );
    load();
    window.addEventListener("private-records-changed", load);
    return () => {
      active = false;
      window.removeEventListener("private-records-changed", load);
    };
  }, [enabled]);
  return state;
}
export const saveVisitRound = (value: unknown) =>
  chmsCall("saveVisitRound", visitRoundSchema.parse(value));
export const saveVisit = (value: unknown) =>
  chmsCall("saveVisit", visitSchema.parse(value));
export const completeVisit = (value: unknown) =>
  chmsCall("completeVisit", completeVisitSchema.parse(value));
export type ContactHistory = {
  policy: ContactPolicy | null;
  events: ContactEvent[];
  rollEntry: Record<string, string>;
  today: string;
};
// Contact history is dates and sources only, reloaded after private saves.
export function useContactHistory(enabled: boolean) {
  const [state, setState] = useState<{
    history: ContactHistory | null;
    error: string;
  }>({ history: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = () =>
      enabled &&
      void chmsCall<ContactHistory>("getContactHistory", {})
        .then((history) => active && setState({ history, error: "" }))
        .catch(
          () =>
            active &&
            setState({
              history: null,
              error:
                "Contact history could not be loaded. Check your connection.",
            }),
        );
    load();
    window.addEventListener("private-records-changed", load);
    return () => {
      active = false;
      window.removeEventListener("private-records-changed", load);
    };
  }, [enabled]);
  return state;
}
export const saveContactPolicy = (value: unknown) =>
  chmsCall("saveContactPolicy", contactPolicySchema.parse(value));
