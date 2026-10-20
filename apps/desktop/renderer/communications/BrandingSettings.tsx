import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, MessageBar, Select } from "@fluentui/react-components";
import { brandingFieldsSchema, saveBrandingSchema, type PublicBranding } from "@sycamore/shared";
import { chmsCall } from "../data/chms";
import { refreshBranding } from "../branding";
import { friendlyError } from "../chms/Common";

type Settings = { branding: PublicBranding | null; revision: number };
export function BrandingSettings({ legacyName }: { legacyName: string }) {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [draft, setDraft] = useState(brandingFieldsSchema.parse({ churchName: legacyName || "Church name", appName: legacyName || "Church app" }));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void chmsCall<Settings>("getBrandingSettings", {}).then((result) => {
      if (!live) return;
      setLoaded(result);
      if (result.branding) {
        const { churchId: _churchId, projectId: _projectId, ...fields } = result.branding;
        void _churchId; void _projectId;
        setDraft(brandingFieldsSchema.parse(fields));
      }
      setError("");
    }).catch((err) => { if (live) setError(friendlyError(err)); });
    return () => { live = false; };
  }, [attempt]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!loaded) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await chmsCall("savePublicBranding", saveBrandingSchema.parse({ ...draft, expectedRevision: loaded.revision }));
      setLoaded({ branding: null, revision: loaded.revision + 1 });
      refreshBranding(); setNotice("Branding published. Other open tabs use it when they reload.");
    } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function logo(file: File) {
    setBusy(true); setError("");
    try {
      if (file.type !== "image/png" || file.size > 1000000) throw new Error("Choose a PNG logo up to 1 MB.");
      const image = await createImageBitmap(file);
      try {
        if (image.width > 4096 || image.height > 4096) throw new Error("Choose a logo up to 4096 pixels.");
        const scale = Math.min(1, 256 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
        const value = canvas.toDataURL("image/png");
        brandingFieldsSchema.shape.logo.parse(value);
        setDraft((before) => ({ ...before, logo: value }));
      } finally { image.close(); }
    } catch (err) { setError(err instanceof Error ? err.message : "The logo could not be read."); }
    finally { setBusy(false); }
  }
  return <section className="surface communication-panel" aria-label="Public church branding">
    <h2>Public church branding</h2>
    <p>These details are public on sign-in and member pages. Use public office contact details. Operational settings, staff contacts and provider status stay protected.</p>
    {loaded && !loaded.branding && loaded.revision === 0 && <p>No public branding is published. Review the legacy church name below, then publish explicitly. Existing records and communication templates are preserved.</p>}
    {error && <MessageBar intent="error">{error} <Button onClick={() => setAttempt((v) => v + 1)}>Reload branding</Button></MessageBar>}
    {notice && <MessageBar intent="success">{notice}</MessageBar>}
    <form onSubmit={(event) => void save(event)}>
      {([['churchName', 'Public church name'], ['appName', 'App name'], ['subtitle', 'Optional subtitle'], ['website', 'Public website (HTTPS)'], ['contactEmail', 'Public office email'], ['contactPhone', 'Public office phone']] as const).map(([key, label]) => <Field key={key} label={label} required={key === 'churchName' || key === 'appName'}>
        <Input value={draft[key]} disabled={busy || !loaded} maxLength={key === 'website' ? 500 : 254} onChange={(_, data) => setDraft({ ...draft, [key]: data.value })} />
      </Field>)}
      <Field label="Accessible brand palette"><Select value={draft.palette} disabled={busy || !loaded} onChange={(_, data) => setDraft({ ...draft, palette: data.value as typeof draft.palette })}>
        <option value="forest">Forest</option><option value="navy">Navy</option><option value="plum">Plum</option>
      </Select></Field>
      <Field label="Public logo (PNG)"><input type="file" accept="image/png" disabled={busy || !loaded} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void logo(file); event.currentTarget.value = ""; }} /></Field>
      {draft.logo && <div><img src={draft.logo} alt="Public logo preview" width="80" height="80" style={{ objectFit: 'contain' }} /><Button disabled={busy} onClick={() => setDraft({ ...draft, logo: '' })}>Remove logo</Button></div>}
      <p>Publishing changes public identity and report headers. Review existing email footers and bulletin templates separately before enabling delivery.</p>
      <Button type="submit" appearance="primary" disabled={busy || !loaded}>{busy ? 'Publishing' : 'Publish public branding'}</Button>
    </form>
  </section>;
}
