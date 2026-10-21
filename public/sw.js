/*
 * KiranaMitra - sw.js - tiny service worker so the app opens with no internet.
 * Strategy: try the network first (so updates show up), fall back to the cache.
 * The /api/ calls are never cached.
 */
var CACHE = 'kiranamitra-v3';
var ASSETS = ['./', 'index.html', 'style.css', 'stock.js', 'dataset.js', 'app.js', 'icon.svg'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/api/') === 0) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); });
      })
  );
});
