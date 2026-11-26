// Offline support: the app shell is cached so it opens instantly (and without signal on
// the mountain); live data is always fetched fresh and only falls back to the cache.
// Also shows the notifications the scheduled job sends (powder tips, watched lifts).
const CACHE = 'ski-tracker-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'map.js', 'resorts.js', 'push-config.js', 'holidays.json',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // weather, map tiles etc. go straight to the network

  const fresh = fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });

  if (url.pathname.includes('/data/')) {
    event.respondWith(fresh.catch(() => caches.match(req)));               // network first
  } else {
    event.respondWith(caches.match(req).then((hit) => {                     // cache first, refresh behind
      if (hit) { fresh.catch(() => {}); return hit; }
      return fresh;
    }));
  }
});

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data.json(); } catch { /* a push without readable content still has to show something */ }
  event.waitUntil(self.registration.showNotification(msg.title || 'Ski Tracker', {
    body: msg.body || 'Open the app for the latest conditions.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: msg.tag || 'ski-tracker',
    data: { url: msg.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});
