import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
void import("./App").then(async ({ App }) => {
  const [{ BrandingProvider }, { functions }, { httpsCallable }] = await Promise.all([
    import("./branding"), import("./data/firebase"), import("firebase/functions"),
  ]);
  const load = async () => (await httpsCallable(functions, "getPublicBranding")()).data;
  root.render(<React.StrictMode><BrandingProvider load={load}><App /></BrandingProvider></React.StrictMode>);
}).catch(() => root.render(<main role="alert"><h1>Church configuration required</h1><p>This app could not open its approved church deployment. Contact the service operator.</p></main>));
