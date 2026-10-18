import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { privatePageSchema, type privateCollections } from "@sycamore/shared";
import { auth, functions } from "./firebase";
type Collection = (typeof privateCollections)[number];
export function usePrivateRecords<T>(
  name: Collection,
  enabled: boolean,
  view: "full" | "report" = "full",
) {
  const [state, setState] = useState<{
    rows: T[];
    loaded: boolean;
    error: string;
  }>({ rows: [], loaded: false, error: "" });
  useEffect(() => {
    let active = true,
      running = false;
    const uid = auth.currentUser?.uid;
    setState({ rows: [], loaded: !enabled, error: "" });
    async function load() {
      if (!enabled || running) return;
      running = true;
      try {
        const rows: T[] = [];
        let after = "";
        do {
          const result = (
            await httpsCallable<unknown, { rows: T[]; next: string }>(
              functions,
              "getPrivateRecords",
            )(privatePageSchema.parse({ collection: name, after, view }))
          ).data;
          if (!active || auth.currentUser?.uid !== uid) return;
          rows.push(...result.rows);
          after = result.next;
        } while (after);
        if (active) setState({ rows, loaded: true, error: "" });
      } catch {
        if (active)
          setState({
            rows: [],
            loaded: false,
            error:
              "Private records could not be loaded. Check your connection and staff access.",
          });
      } finally {
        running = false;
      }
    }
    void load();
    const refresh = () => void load();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("private-records-changed", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("private-records-changed", refresh);
    };
  }, [name, enabled, view]);
  return state;
}
