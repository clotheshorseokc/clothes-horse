// Keeps the app shell available offline. Bump VERSION when files change.
const VERSION = 'ch-v7';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'cloud.js', 'firebase-config.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))); self.clients.claim(); });
// Network first so updates show up right away; fall back to the cached copy when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Firebase library files never change for a given version, so keep a copy and use it first.
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // cache: 'no-cache' asks the server for the newest copy instead of the browser's saved one, so updates show up on the next open.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
