/* global __PWA_ASSETS__ */
/* Replaced at build time. Only exact versioned application assets enter this cache. */
const VERSION = "__PWA_VERSION__";
const ASSETS = __PWA_ASSETS__;
const CACHE = `church-app-${VERSION}`;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("church-app-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search) return;
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(request)) || fetch(request)));
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => new Response(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Foldkeeper · Connection required</title><main><h1>Connection required</h1><p>Connect to the internet to open the church app. Unconfirmed work in a closed tab may be lost.</p><p>Powered by Foldkeeper</p><a href="/launch">Try again</a></main></html>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" } },
    )));
  }
  // No API, Auth, Firestore, calendar, Storage, photo or export response is cached.
});
let ballot;
self.addEventListener("message", (event) => {
  if (event.data?.type === "REQUEST_UPDATE" && !ballot) {
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const token = crypto.randomUUID();
      ballot = { token, ids: new Set(clients.map((client) => client.id)), clients };
      for (const client of clients) client.postMessage({ type: "PREPARE_UPDATE", token });
      setTimeout(() => cancel(token), 5000);
    })());
  }
  if (event.data?.type === "UPDATE_VOTE" && ballot?.token === event.data.token && ballot.ids.has(event.source?.id)) {
    if (!event.data.ready) { cancel(); return; }
    ballot.ids.delete(event.source.id);
    if (!ballot.ids.size) { ballot = undefined; event.waitUntil(self.skipWaiting()); }
  }
});
function cancel(token) {
  if (!ballot || (token && ballot.token !== token)) return;
  for (const client of ballot.clients) client.postMessage({ type: "UPDATE_CANCELLED" });
  ballot = undefined;
}
