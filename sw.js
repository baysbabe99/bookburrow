/* Bookburrow service worker — offline support (added 2026-06-21).
   Network-first for the app shell (fresh when online, cached when offline),
   cache-first for Google Fonts, pass-through for book-search/cover APIs.
   Bump VERSION on each deploy so old caches are purged. */
const VERSION = 'bookburrow-v3.18.13';
const CORE = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  // App shell / same-origin: network-first, fall back to cache when offline.
  if (req.mode === 'navigate' || sameOrigin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && sameOrigin) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req)
            .then((hit) => hit || caches.match('./index.html'))
            .then((hit) => hit || caches.match('./'))
        )
    );
    return;
  }

  // Google Fonts: cache-first so they work offline after the first load.
  if (isFonts) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
    return;
  }

  // Everything else (book search / cover APIs, etc.): straight to the network.
});
