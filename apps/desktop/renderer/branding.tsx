import { ServiceRuntime } from "../../pwa/runtime";
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { brandPalettes, publicBrandingSchema, type PublicBranding } from "@sycamore/shared";

let activeBranding: PublicBranding | null = null;
export function currentBranding() {
  if (!activeBranding) throw new Error("Church branding is required before exporting records. Ask an administrator to publish it in Settings.");
  return activeBranding;
}
const Context = createContext<{ value: PublicBranding | null; reload: () => void }>({ value: null, reload: () => {} });
export const useBranding = () => useContext(Context);
export function refreshBranding() { window.dispatchEvent(new Event("church-branding-changed")); }
export function BrandingProvider({ load, children }: { load: () => Promise<unknown>; children: ReactNode }) {
  const [value, setValue] = useState<PublicBranding | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((v) => v + 1);
    window.addEventListener("church-branding-changed", update);
    return () => window.removeEventListener("church-branding-changed", update);
  }, []);
  useEffect(() => {
    let live = true;
    void load().then((data) => {
      const branding = publicBrandingSchema.parse(data);
      const expected = import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-sycamore";
      const church = import.meta.env.VITE_CHURCH_ID || "demo-church";
      if (branding.projectId !== expected || branding.churchId !== church)
        throw new Error("Church deployment mismatch");
      if (live) { activeBranding = branding; setValue(branding); setError(""); }
    }).catch(() => {
      if (live) { activeBranding = null; setValue(null); setError("Church branding could not be loaded. Check your connection. An administrator can publish branding in Settings."); }
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [load, revision]);
  useEffect(() => { document.title = value?.appName || "Church configuration required"; }, [value]);
  const palette = brandPalettes[value?.palette || "forest"];
  return <Context.Provider value={{ value, reload: () => setRevision((v) => v + 1) }}>
    <div className="church-branding" style={{ "--church-brand": palette.light, "--church-brand-dark": palette.dark } as CSSProperties}>
      <ServiceRuntime check={load} />
      {error && <div role="alert" className="branding-error">{error} <button onClick={() => setRevision((v) => v + 1)}>Retry branding</button></div>}
      {loading ? <p role="status">Loading church configuration</p> : children}
    </div>
  </Context.Provider>;
}
export function ChurchWordmark() {
  const { value } = useBranding();
  return <div className="wordmark church-wordmark">
    {value?.logo && <img src={value.logo} alt="" width="40" height="40" />}
    <div>{value?.appName || "Church setup required"}{value?.subtitle && <span>{value.subtitle}</span>}</div>
  </div>;
}
