import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { operations } from "./operations";
export const useOperations = () => useSyncExternalStore(operations.subscribe, operations.getSnapshot);
let probe: (() => Promise<unknown>) | undefined;
let checking: Promise<void> | undefined;
export function confirmConnection() {
  if (!checking) checking = (async () => {
    if (!navigator.onLine || !probe) { operations.connection(false); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([probe(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Connection timed out")), 5000); })]);
      operations.connection(navigator.onLine);
    } catch (error) {
      // A structured server denial proves reachability, without granting any record access.
      const code = String((error as { code?: string })?.code || "");
      operations.connection(navigator.onLine && /functions\/(failed-precondition|permission-denied|unauthenticated|not-found)$/.test(code));
    }
    finally { clearTimeout(timer); }
  })().finally(() => { checking = undefined; });
  return checking;
}
export function isReadCall(name: string) { return /^(?:get|list|my)/.test(name) || /^(?:portalPublicEvents|portalPublicCalendar|portalMemberEvents|portalMe|portalDirectory|portalPhoto|staffSecurityStatus)$/.test(name); }
export async function connectedOperation<T>(action: () => Promise<T>, readOnly = false) {
  // Recheck before side effects, including when a browser reports a stale online state.
  await confirmConnection();
  return operations.run(action, readOnly);
}
const dirty = new Set<Element>();
function hasEdits() {
  for (const element of dirty) if (!element.isConnected) dirty.delete(element);
  return dirty.size > 0;
}
export function ConnectionControls({ children }: { children: ReactNode }) {
  const state = useOperations();
  return <div inert={!state.connected || state.frozen}>{children}</div>;
}
export function ServiceRuntime({ check }: { check: () => Promise<unknown> }) {
  const state = useOperations();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    probe = check;
    void confirmConnection();
    const online = () => { void confirmConnection(); };
    const offline = () => operations.connection(false);
    let securityCleared = false;
    const cleared = () => { securityCleared = true; dirty.clear(); };
    window.addEventListener("church-security-cleared", cleared);
    const leave = (event: BeforeUnloadEvent) => {
      if (!securityCleared && (operations.getSnapshot().pending || operations.getSnapshot().uncertain || hasEdits())) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    const edited = (event: Event) => {
      if (event.target instanceof Element && event.target.matches("input, textarea, select, [contenteditable=true]")) dirty.add(event.target);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("input", edited);
    document.addEventListener("change", edited);
    const timer = setInterval(online, 20000);
    return () => {
      clearInterval(timer); probe = undefined;
      window.removeEventListener("church-security-cleared", cleared);
      window.removeEventListener("online", online); window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("input", edited); document.removeEventListener("change", edited);
    };
  }, [check]);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let live = true;
    let registration: ServiceWorkerRegistration | undefined;
    const installed = () => { if (live) setWaiting(registration?.waiting || null); };
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" }).then((value) => {
      registration = value; installed();
      value.addEventListener("updatefound", () => value.installing?.addEventListener("statechange", installed));
    }).catch(() => { if (live) setNotice("Updates could not be checked. You can keep using this version."); });
    const message = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "PREPARE_UPDATE") {
        const ready = !hasEdits() && operations.freeze();
        event.source?.postMessage({ type: "UPDATE_VOTE", token: data.token, ready });
        if (!ready) setNotice("Finish or close edits in every church tab before restarting.");
      }
      if (data?.type === "UPDATE_CANCELLED") { operations.resume(); setNotice("Update postponed. Finish work in every church tab, then try again."); }
    };
    const changed = () => {
      if (operations.getSnapshot().frozen) location.reload();
    };
    navigator.serviceWorker.addEventListener("message", message);
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    return () => { live = false; navigator.serviceWorker.removeEventListener("message", message); navigator.serviceWorker.removeEventListener("controllerchange", changed); };
  }, []);
  return <aside aria-label="Connection and updates" role="status" style={{ padding: "8px 16px" }}>
    {!state.connected && <span>Connection required. New changes are paused. <button onClick={() => void confirmConnection()}>Reconnect</button> </span>}
    {state.pending > 0 && <span>Waiting for server confirmation. Keep this tab open. </span>}
    {state.uncertain && <span>A result is unconfirmed. Reconnect and review the records before retrying. <button disabled={!state.connected || state.pending > 0} onClick={() => operations.reconcile()}>I reviewed the results</button> </span>}
    {(state.pending > 0 || state.uncertain) && <span>Closing the app or a security lock may lose unconfirmed work. </span>}
    {waiting && <span>An update is ready. <button disabled={state.pending > 0 || state.uncertain || state.frozen} onClick={() => {
      if (hasEdits() && !window.confirm("Discard unsaved form edits and restart? Finish saving first if you need these changes.")) return;
      dirty.clear(); waiting.postMessage({ type: "REQUEST_UPDATE" });
    }}>Restart to update</button> </span>}
    {notice}
  </aside>;
}
