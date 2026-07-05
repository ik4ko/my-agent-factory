// App-shell-only service worker. Deliberately conservative: trading state
// and every control endpoint (arm/kill/halt, loop CRUD, orders) must ALWAYS
// hit the network live — a stale cached "kill switch engaged" (or worse,
// stale "disarmed") reading would be actively dangerous. Only the static
// shell (icons, manifest, the offline fallback) is ever cached.
const CACHE_NAME = 'agent-factory-shell-v1';
const SHELL_ASSETS = ['/offline.html', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept mutations

  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // network-only — no interception, ever

  if (req.mode === 'navigate') {
    // Network-first; only fall back to the offline shell when truly unreachable.
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
