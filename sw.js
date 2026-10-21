/* Liebert77 Blog Service Worker v5
 * 策略：
 *   - 导航请求(HTML)：network-first，保证看到最新文章；离线时回退缓存，
 *     再回退专用离线页（source/offline/index.md，layout: false 自包含页面）
 *   - 同源静态资源：stale-while-revalidate（search.xml 不缓存：1.7MB 且只在主动搜索时才需要）
 *   - 仅处理同源 GET，图床（跨域）不干预
 *
 * v4 修复（2026-10-21）：
 *   1. 缓存写入不再是无等待的游离 Promise，改为 return 进事件链，
 *      否则 SW 可能在 caches.put 完成前被浏览器回收 -> 离线缓存写入丢失
 *   2. 无缓存且网络失败时原先返回 undefined，respondWith(undefined) 会抛
 *      TypeError 导致资源加载失败，现在返回明确的 504 Response
 *   3. 页面缓存加 LRU 上限(30 条)，避免 Cache Storage 无限增长被整体回收
 *   4. install 阶段由 addAll 改为逐个 add + catch，单个资源失败不会让 SW 安装失败
 *
 * v5 修复（2026-10-21）：
 *   5. 导航分支漏改：caches.match 未命中时 resolve 的是 undefined（不是 rejected），
 *      最终仍会 respondWith(undefined) 抛 TypeError。现在保证所有分支都返回 Response
 *   6. 不再用首页 '/' 做离线兜底——那会让 /posts/xxx/ 显示首页内容，URL 与内容不符。
 *      改为专用离线页 /offline/，再兜底一个内联 503 Response
 *   7. STATIC_CACHE 之前完全没有裁剪（只给 PAGE_CACHE 加了 LRU），
 *      且会把 1.7MB 的 search.xml 反复重写。现在：search.xml 直接放行不拦截，
 *      STATIC_CACHE 也加 LRU 上限(60 条)
 */
const VERSION = 'v5';
const STATIC_CACHE = 'liebert77-static-' + VERSION;
const PAGE_CACHE = 'liebert77-pages-' + VERSION;
const OFFLINE_URL = '/offline/';
const PRECACHE = ['/', '/offline/', '/manifest.json'];
const PAGE_CACHE_MAX = 30;
const STATIC_CACHE_MAX = 60;

/** 不进缓存的同源路径：体积大且只在用户主动操作时才需要 */
const NO_CACHE_PATHS = ['/search.xml'];

/** 离线兜底页（最后一道防线，保证 respondWith 永远拿到 Response） */
function offlineResponse(reason) {
  var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>离线 - Liebert77 Blog</title></head>' +
    '<body style="font-family:system-ui,-apple-system,sans-serif;display:flex;' +
    'align-items:center;justify-content:center;min-height:100vh;margin:0;' +
    'background:#f5f5f5;color:#333">' +
    '<div style="text-align:center;padding:24px">' +
    '<h1 style="font-size:20px;font-weight:500">当前处于离线状态</h1>' +
    '<p style="font-size:14px;color:#666">' + reason + '</p>' +
    '<p style="font-size:14px;color:#666">已访问过的页面仍可从缓存中打开。</p>' +
    '</div></body></html>';
  return new Response(html, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/** 写缓存并返回 Promise（必须被事件链 await，否则可能写不进去） */
function putSafe(cacheName, req, res) {
  return caches.open(cacheName)
    .then(function (c) { return c.put(req, res.clone()); })
    .catch(function () { /* 配额不足等，忽略即可，不影响页面正常返回 */ });
}

/** 通用 LRU 裁剪：超出上限时删掉最旧的（Cache.keys() 顺序即写入顺序） */
function trimCache(cacheName, max) {
  return caches.open(cacheName)
    .then(function (c) {
      return c.keys().then(function (keys) {
        if (keys.length <= max) return;
        return Promise.all(keys.slice(0, keys.length - max).map(function (k) {
          return c.delete(k);
        }));
      });
    })
    .catch(function () {});
}

function trimPageCache() {
  return trimCache(PAGE_CACHE, PAGE_CACHE_MAX);
}

function trimStaticCache() {
  return trimCache(STATIC_CACHE, STATIC_CACHE_MAX);
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function (c) {
        // 逐个 add：任一失败不影响整体安装（addAll 是"全成功才成功"）
        return Promise.all(PRECACHE.map(function (u) {
          return c.add(u).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k !== STATIC_CACHE && k !== PAGE_CACHE;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 仅处理同源

  // search.xml：1.7MB，且只在用户主动点搜索时才需要，不进缓存
  if (NO_CACHE_PATHS.indexOf(url.pathname) !== -1) return;

  // 导航请求（HTML 页面）：network-first
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          return putSafe(PAGE_CACHE, req, res)
            .then(trimPageCache)
            .then(function () { return res; });
        }
        return res;
      }).catch(function () {
        // 注意：caches.match() 未命中时 resolve 的是 undefined，不是 rejected，
        // 所以每一层都要显式兜底，绝不能把 undefined 交给 respondWith()
        return caches.match(req)
          .then(function (hit) {
            if (hit) return hit;
            // 不用 '/' 兜底：那会让文章 URL 渲染出首页内容
            return caches.match(OFFLINE_URL);
          })
          .then(function (r) {
            return r || offlineResponse('该页面尚未缓存，恢复网络后即可访问。');
          });
      })
    );
    return;
  }

  // 其他同源 GET：stale-while-revalidate
  e.respondWith(
    caches.match(req).then(function (hit) {
      var refresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          return putSafe(STATIC_CACHE, req, res)
            .then(trimStaticCache)
            .then(function () { return res; });
        }
        return res;
      }).catch(function () { return null; });

      // 命中缓存：立即返回，后台静默更新
      if (hit) return hit;
      // 未命中：等网络；网络也失败时返回明确状态，绝不能返回 undefined
      return refresh.then(function (r) {
        return r || new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
