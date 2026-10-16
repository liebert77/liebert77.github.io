/* Liebert77 Blog Service Worker v3
 * 策略：导航请求 network-first，其他同源 GET 走 stale-while-revalidate
 * 仅缓存同源 GET 请求，图床（跨域）不干预
 * v3: 导航请求改 network-first，避免用户看到缓存的旧文章 */
const CACHE_NAME = 'liebert77-blog-v3';
const PRECACHE = ['/', '/manifest.json'];

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
  // 导航请求（HTML 页面）走 network-first，避免用户看到缓存的旧文章
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (c) { return c.put(req, clone); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('/'); });
      })
    );
    return;
  }

  // 其他同源 GET 请求走 stale-while-revalidate
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
