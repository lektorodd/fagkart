// Service worker for the published maps (dist/sw.js): after the first visit a page opens offline.
// Same-origin GET requests are answered from the cache "fagkart" when they are there, and fetched again in the background
// (stale-while-revalidate). Not in the cache: the network, and the answer is kept. The version files (<KODE>.versjon.json) always go to the network,
// since a stale answer would hide the very news they carry. The service for shared rooms (/innspel/) is never answered from the cache: what it
// gives is private and changes all the time, and the cache key leaves the query out. The page asks for a fresh copy with { type: 'fagkart:oppdater', url }.
const CACHE = 'fagkart';

// The page is the same file whatever the query string says (?vising=elev ...), so the cache key leaves the query and the hash out
const keyOf = (url) => { const u = new URL(url); return u.origin + u.pathname; };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function keep(key, response) {
  // A redirected answer cannot be served to a navigation, and only whole, good answers are worth keeping
  if (!response || response.status !== 200 || response.redirected) return;
  const cache = await caches.open(CACHE);
  await cache.put(key, response.clone());
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the version files, the service and its page, and the data files the page reads (kart.json, <sti>/<KODE>.json) always go to the net
  if (url.origin !== self.location.origin || url.pathname.endsWith('.json') || url.pathname.includes('/innspel/')) return;
  const key = keyOf(req.url);
  e.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(key);
    const fresh = fetch(req, { cache: 'no-cache' }).then(async (r) => { await keep(key, r); return r; });
    if (!cached) return fresh;
    e.waitUntil(fresh.catch(() => {})); // offline: the cached copy is the answer
    return cached;
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'fagkart:oppdater' || typeof d.url !== 'string') return;
  let target;
  try { target = new URL(d.url, self.location.href); } catch (err) { return; }
  if (target.origin !== self.location.origin) return;
  const client = e.source;
  e.waitUntil(fetch(target.href, { cache: 'reload' })
    .then((r) => keep(keyOf(target.href), r))
    .catch(() => {})
    .then(() => client && client.postMessage({ type: 'fagkart:oppdatert' })));
});
