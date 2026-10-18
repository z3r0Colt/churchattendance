import { useEffect, useState } from "react";
import {
  approvalDecisionSchema,
  runControlSchema,
  workflowControlSchema,
  workflowDraftSchema,
  workflowPreviewSchema,
  workflowPublishSchema,
  type Workflow,
  type WorkflowRun,
  type WorkflowVersion,
} from "@sycamore/shared";
import { chmsCall } from "./chms";

export type WorkflowData = {
  workflows: Workflow[];
  versions: WorkflowVersion[];
  runs: WorkflowRun[];
};
export type WorkflowPreview = {
  revision: number;
  trigger: string;
  enrollment: string;
  upcoming: {
    personId: string;
    name: string;
    startsOn: string;
    date: string;
  }[];
  steps: string[];
  messages: {
    stepId: string;
    channel: string;
    subject: string;
    body: string;
  }[];
  problems: string[];
};
// Workflow definitions and runs are Session only and held in component memory.
export function useWorkflowData(enabled: boolean) {
  const [state, setState] = useState<{
    data: WorkflowData | null;
    error: string;
  }>({ data: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = () =>
      enabled &&
      void chmsCall<WorkflowData>("getWorkflowData", {})
        .then((data) => active && setState({ data, error: "" }))
        .catch(
          () =>
            active &&
            setState((before) => ({
              ...before,
              error:
                "Care workflows could not be loaded. Check your connection and staff access.",
            })),
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
export const saveWorkflowDraft = (value: unknown) =>
  chmsCall("saveWorkflowDraft", workflowDraftSchema.parse(value));
export const previewWorkflow = (id: string) =>
  chmsCall<WorkflowPreview>(
    "previewWorkflow",
    workflowPreviewSchema.parse({ id }),
  );
export const publishWorkflow = (value: unknown) =>
  chmsCall("publishWorkflow", workflowPublishSchema.parse(value));
export const controlWorkflow = (value: unknown) =>
  chmsCall("controlWorkflow", workflowControlSchema.parse(value));
export const controlWorkflowRun = (value: unknown) =>
  chmsCall("controlWorkflowRun", runControlSchema.parse(value));
export const decideWorkflowApproval = (value: unknown) =>
  chmsCall("decideWorkflowApproval", approvalDecisionSchema.parse(value));
