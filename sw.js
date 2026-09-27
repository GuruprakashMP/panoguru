// Minimal service worker: makes the site installable as an app. It only
// touches same-origin GET requests and passes them straight to the network
// (no caching), so every visit gets the latest deployed version. Requests to
// Google's servers are never intercepted.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
