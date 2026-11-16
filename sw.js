// Service Worker: hält die App-Dateien auf dem Gerät vor, damit sie auch ohne
// Netz startet. Daten und GitHub-Aufrufe fasst er nicht an.
// Bei jeder neuen App-Version die Nummer hochzählen.
const VERSION = 'rs-mobil-1.0.0';
const DATEIEN = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/zustand.js', 'js/sync.js', 'js/github.js', 'js/krypto.js', 'js/db.js', 'js/format.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const bereich = new URL(self.registration.scope).pathname;
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(bereich) || url.pathname.startsWith(bereich + 'api/')) return;
  // Erst aus dem Vorrat antworten, im Hintergrund auffrischen.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const vorrat = await c.match(e.request, { ignoreSearch: true });
    const frisch = fetch(e.request).then((r) => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }).catch(() => vorrat);
    return vorrat || frisch;
  }));
});
