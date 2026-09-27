// Minimal service worker: makes the site installable as an app. Network-first,
// no caching, so every visit always gets the latest deployed version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
