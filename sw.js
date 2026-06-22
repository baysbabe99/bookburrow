/* Bookburrow service worker — offline support for the single-file app.
   Strategy: cache the app shell on install; serve navigations cache-first
   with a background refresh (stale-while-revalidate) so the app opens
   instantly and offline, while still picking up new deploys. */

const CACHE = 'bookburrow-v3.12.1';
// Scope-relative so it works under GitHub Pages' /bookburrow/ path.
const SHELL = ['./', './index.html', './sw.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs; let everything else hit the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to whatever we cached

      // Cache-first for speed/offline, with the network update in the background.
      return cached || network;
    })
  );
});
