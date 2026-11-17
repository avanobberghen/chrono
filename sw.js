// Service worker : garde l'appli disponible sans réseau.
// Changez le numéro de version à chaque mise à jour des fichiers pour forcer le rafraîchissement.
const CACHE = 'chrono-v1';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.97.0';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', CDN];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const own = url.origin === self.location.origin, cdn = req.url.startsWith('https://cdn.jsdelivr.net/');
  if (!own && !cdn) return;                       // Supabase : toujours en direct
  // On sert la copie en cache tout de suite et on la rafraîchit en arrière-plan.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: own });
    const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
