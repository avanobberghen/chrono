// Service worker: keeps the app available offline and delivers updates.
// The browser re-checks this file and the three imported files below every time the app is opened.
// When one of them changes, the new version is downloaded in the background and the app offers to reload.
importScripts('version.js', 'config.js', 'settings.js');
const CACHE = 'chrono-' + (self.CHRONO_VERSION || '0');
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.97.0';
const S = self.CHRONO_SETTINGS || {};
const OWN = ['./', 'index.html', 'styles.css', 'app.js', 'version.js', 'config.js', 'settings.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']
  .concat(S.logo ? [S.logo] : [], (S.languages || []).map(c => 'lang/' + c + '.js'));

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache so the new version really is the new version
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(
    OWN.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})).concat(c.add(CDN).catch(() => {}))
  )).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('chrono') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const own = url.origin === self.location.origin, cdn = req.url.startsWith('https://cdn.jsdelivr.net/');
  if (!own && !cdn) return;                       // Supabase: always live
  // Serve the cached copy at once and refresh it in the background.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: own });
    const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
