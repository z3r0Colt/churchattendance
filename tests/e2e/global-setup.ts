import { createServer } from "vite";

export default async function setup() {
  // Own the server directly so teardown closes its sockets on Windows as well as Linux.
  const server = await createServer({
    configFile: "apps/desktop/vite.config.ts",
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await server.listen();
  return async () => {
    await server.close();
  };
}
