import { createServer } from "vite";

export default async function setup() {
  const response = await fetch("http://127.0.0.1:5001/demo-sycamore/us-central1/getPublicBranding", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }),
  });
  const payload = await response.json();
  if (!response.ok || payload.result?.projectId !== "demo-sycamore" || payload.result?.churchId !== "demo-church")
    throw new Error(`The seeded public branding fixture is unavailable: ${JSON.stringify(payload)}`);

  // Own the server directly so teardown closes its sockets on Windows as well as Linux.
  const server = await createServer({
    configFile: "apps/desktop/vite.config.ts",
    define: { __STAFF_WEB__: "true" },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await server.listen();
  const portal = await createServer({
    configFile: "apps/portal/vite.config.ts",
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  });
  await portal.listen();
  const staffWeb = await createServer({
    configFile: "apps/desktop/vite.web.config.ts",
    server: { host: "127.0.0.1", port: 5175, strictPort: true },
  });
  await staffWeb.listen();
  return async () => {
    await server.close();
    await portal.close();
    await staffWeb.close();
  };
}

