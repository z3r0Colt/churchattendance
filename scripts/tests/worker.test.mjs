import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
function worker() {
  const handlers = {}, sent = [], cacheWrites = [], waits = [];
  let activated = 0;
  const clients = ["staff", "member"].map((id) => ({ id, postMessage: (data) => sent.push({ id, data }) }));
  const self = { location: { origin: "https://church.example" }, clients: { matchAll: async () => clients, claim: async () => {} }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => { activated++; } };
  const caches = { open: async () => ({ addAll: async (paths) => cacheWrites.push(...paths), match: async () => undefined }), keys: async () => [], delete: async () => {} };
  const source = readFileSync("apps/pwa/service-worker.js", "utf8").replace('"__PWA_VERSION__"', '"fictional-v1"').replace("const ASSETS = __PWA_ASSETS__;", 'const ASSETS = ["/assets/app-12345678.js"];');
  runInNewContext(source, { self, caches, URL, Response, crypto: { randomUUID: () => "test-token" }, setTimeout: () => 1, fetch: async () => { throw new Error("offline"); } });
  return { handlers, sent, cacheWrites, clients, activated: () => activated, event: (data, source) => ({ data, source, waitUntil: (promise) => waits.push(promise) }), flush: async () => { await Promise.all(waits.splice(0)); } };
}
test("worker caches exact public hashes and bypasses private and dynamic responses", async () => {
  const w = worker(); w.handlers.install(w.event()); await w.flush();
  assert.deepEqual(w.cacheWrites, ["/assets/app-12345678.js"]);
  for (const path of ["/calendar/public.ics?token=secret", "/app-icon.png", "/manifest.webmanifest", "/photos/a", "/exports/private.pdf", "/api", "/assets/app-12345678.js?token=secret"]) {
    let intercepted = false;
    w.handlers.fetch({ request: { method: "GET", url: `https://church.example${path}`, mode: "cors" }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});
test("updates require every tab to freeze successfully; one pending tab cancels activation", async () => {
  const w = worker(); w.handlers.message(w.event({ type: "REQUEST_UPDATE" })); await w.flush();
  assert.equal(w.sent.length, 2);
  w.handlers.message(w.event({ type: "UPDATE_VOTE", token: "test-token", ready: true }, w.clients[0]));
  assert.equal(w.activated(), 0);
  w.handlers.message(w.event({ type: "UPDATE_VOTE", token: "test-token", ready: false }, w.clients[1]));
  assert.equal(w.activated(), 0);
  assert.equal(w.sent.filter((row) => row.data.type === "UPDATE_CANCELLED").length, 2);
  w.handlers.message(w.event({ type: "REQUEST_UPDATE" })); await w.flush();
  for (const client of w.clients) w.handlers.message(w.event({ type: "UPDATE_VOTE", token: "test-token", ready: true }, client));
  await w.flush(); assert.equal(w.activated(), 1);
});
