import { useEffect, useState } from "react";
import {
  mercyAssignmentSchema,
  mercyNoteSchema,
  mercyProgressSchema,
  mercyRequestSchema,
  mercySettingsSchema,
  mercyShareSchema,
  mercyTaskSchema,
  mercyTriageSchema,
  type MercyAssignment,
  type MercyNote,
  type MercyRequest,
  type MercySettings,
  type MercyTask,
  type MercyViewer,
} from "@sycamore/shared";
import { chmsCall } from "./chms";

export type MercyWorkspace = {
  viewer: MercyViewer & { triage: boolean };
  zone: string;
  settings: MercySettings | null;
  deacons: { uid: string; name: string }[];
  assignments: MercyAssignment[];
  requests: MercyRequest[];
  notes: MercyNote[];
  tasks: MercyTask[];
};
// Mercy records stay in component memory from one audited call, never the attendance cache.
export function useMercyWorkspace(enabled: boolean) {
  const [state, setState] = useState<{
    data: MercyWorkspace | null;
    error: string;
  }>({ data: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = () =>
      enabled &&
      void chmsCall<MercyWorkspace>("getMercyWorkspace", {})
        .then((data) => active && setState({ data, error: "" }))
        .catch(
          () =>
            active &&
            setState({
              data: null,
              error:
                "Mercy ministry records could not be loaded. Check your connection and staff access.",
            }),
        );
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("private-records-changed", load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("private-records-changed", load);
    };
  }, [enabled]);
  return state;
}
export const saveMercySettings = (value: unknown) =>
  chmsCall("saveMercySettings", mercySettingsSchema.parse(value));
export const saveMercyAssignment = (value: unknown) =>
  chmsCall("saveMercyAssignment", mercyAssignmentSchema.parse(value));
export const saveMercyRequest = (value: unknown) =>
  chmsCall("saveMercyRequest", mercyRequestSchema.parse(value));
export const triageMercyRequest = (value: unknown) =>
  chmsCall("triageMercyRequest", mercyTriageSchema.parse(value));
export const progressMercyRequest = (value: unknown) =>
  chmsCall("progressMercyRequest", mercyProgressSchema.parse(value));
export const saveMercyNote = (value: unknown) =>
  chmsCall("saveMercyNote", mercyNoteSchema.parse(value));
export const shareMercyNote = (value: unknown) =>
  chmsCall("shareMercyNote", mercyShareSchema.parse(value));
export const saveMercyTask = (value: unknown) =>
  chmsCall("saveMercyTask", mercyTaskSchema.parse(value));
