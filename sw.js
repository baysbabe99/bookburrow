/* Bookburrow service worker — offline support for the single-file app.

   Strategy (v3.84.0): NETWORK-FIRST for navigations with a cache fallback, and
   cache-first for everything else. The old build served navigations cache-first,
   which meant freshly-deployed HTML was only written for the *next* load — so
   every user ran a full deploy behind, and an installed PWA that gets resumed
   rather than re-navigated could sit on old code for days. That reads exactly
   like "the deploy silently didn't go out".

   The page also listens for `controllerchange` and reloads once, so someone
   already looking at the app picks up a new version instead of waiting. */

const CACHE = 'bookburrow-v3.93.0';   // working-tree copy; the deploy script bumps this forward from the LIVE value on each publish
// Scope-relative so it works under GitHub Pages' /bookburrow/ path.
// './index.html' and './sw.js' were dropped: './' already covers the navigation,
// a worker's own script never routes through its fetch handler, and locally
// (where the file is Bookburrow.html) './index.html' 404'd — which made the
// ATOMIC addAll reject, so offline support silently never worked in testing.
const SHELL = ['./'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // `cache: 'reload'` bypasses the HTTP cache. GitHub Pages serves HTML with
      // max-age=600, so a plain fetch could store the PRE-deploy bytes under the
      // new cache name — a "fresh" cache holding the old build.
      .then((cache) => Promise.all(
        SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // never let one failed URL block activation
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // CacheStorage is ORIGIN-wide, and this origin also hosts other GitHub
        // Pages projects. The old predicate kept exactly one name and deleted
        // every other cache on the origin — including other apps' shells.
        keys.filter((k) => k.startsWith('bookburrow-') && k !== CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs; let everything else hit the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  const isNavigation = req.mode === 'navigate';

  event.respondWith((async () => {
    if (isNavigation) {
      // Network-first: always try for the newest build, fall back to cache offline.
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          // A quota rejection here used to be unhandled, which left the stale
          // entry in place permanently — the app could never update again.
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch (e) {
        const cached = (await caches.match(req)) || (await caches.match('./'));
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Bookburrow</title>' +
          '<body style="font-family:system-ui;padding:40px;text-align:center;color:#3D5A80;background:#FFF8F0">' +
          '<div style="font-size:40px">\u{1F409}</div><h1 style="font-family:Georgia,serif">You\'re offline</h1>' +
          '<p>Bookburrow couldn\'t load. Reconnect and try again — your books are safe on this device.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        );
      }
    }

    // Everything else: cache-first with a background refresh.
    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      // The old code returned the (undefined) `cached` value here, so
      // respondWith threw "Failed to convert value to 'Response'" and the user
      // got a raw browser error page instead of anything the app controls.
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
