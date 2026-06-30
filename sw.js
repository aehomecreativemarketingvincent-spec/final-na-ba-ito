// ─── AE Home POS — Service Worker v5 ────────────────────────────────────────
// v5: Production hardened — Vercel/Netlify compatible, proper cache busting
const CACHE_VERSION = 'ae-pos-v6';
const SW_BASE = self.location.pathname.replace(/\/sw\.js$/, '') || '';

const PRECACHE_URLS = [
  SW_BASE + '/',
  SW_BASE + '/index.html',
  SW_BASE + '/style.css',
  SW_BASE + '/app.js',
  SW_BASE + '/manifest.json',
  SW_BASE + '/icon-192.png',
  SW_BASE + '/icon-512.png',
];

// ── Install: pre-cache critical assets ────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache =>
        Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(() => {}))
        )
      )
      .then(() => self.skipWaiting()) // activate immediately on all clients
  );
});

// ── Activate: purge ALL old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── Message handler: force refresh from app ───────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});

// ── Fetch: network-first for HTML, cache-first for assets ─────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // Passthrough: non-GET, GAS, external CDNs, analytics
  if (req.method !== 'GET') return;
  if (url.includes('script.google.com'))    return;
  if (url.includes('fonts.googleapis.com')) return;
  if (url.includes('fonts.gstatic.com'))    return;
  if (url.includes('cdnjs.cloudflare.com')) return;
  if (url.includes('cdn.jsdelivr.net'))     return;

  // HTML navigation: always network-first → fallback to cached index.html
  // This ensures fresh app loads and prevents 404 on route refreshes
  const isNavigate =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigate) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .catch(() =>
          caches.match(SW_BASE + '/index.html')
            .then(r => r || caches.match(SW_BASE + '/'))
        )
    );
    return;
  }

  // Static assets: cache-first, update cache in background (stale-while-revalidate)
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(response => {
        if (
          response &&
          response.status === 200 &&
          (response.type === 'basic' || response.type === 'cors')
        ) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, clone));
        }
        return response;
      }).catch(() => cached); // network failed → return cached copy

      // Return cached immediately, but revalidate in background
      return cached || networkFetch;
    })
  );
});
