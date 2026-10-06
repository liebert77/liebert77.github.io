/* Liebert77 Blog Service Worker v1
 * 策略：stale-while-revalidate（缓存命中先返回，同时后台更新）
 * 仅缓存同源 GET 请求，图床（跨域）不干预 */
const CACHE_NAME = 'liebert77-blog-v1';
const PRECACHE = ['/', '/manifest.json', '/img/head.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var scope = self.registration.scope;
  if (url.origin !== scope.slice(0, -1)) return; // 仅处理同源
  e.respondWith(
    caches.match(req).then(function (hit) {
      var refresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (c) { return c.put(req, clone); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || refresh;
    })
  );
});
