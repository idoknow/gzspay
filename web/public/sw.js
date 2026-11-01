/* gzspay Service Worker：静态资源 cache-first、导航请求 network-first 回退缓存。
 * 只在生产环境注册（见 src/main.tsx）。版本变化时清理旧缓存。
 */
const CACHE_VERSION = "gzspay-v4";
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/logo.svg",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/nunito-latin.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 逐个添加，避免某个资源缺失导致整个预缓存失败
      await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/** 是否是静态资源（脚本、样式、字体、图片、manifest） */
function isStaticAsset(url) {
  return (
    /\.(?:js|mjs|css|woff2?|ttf|png|jpe?g|svg|webp|gif|ico|webmanifest)$/i.test(url.pathname) ||
    url.pathname.startsWith("/assets/")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口与 SSE 一律走网络，不缓存
  if (url.pathname.startsWith("/api/")) return;

  // 页面导航：network-first，失败回退缓存首页
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put("/", response.clone());
          return response;
        } catch (error) {
          const cached = await caches.match("/", { ignoreSearch: true });
          if (cached) return cached;
          throw error;
        }
      })(),
    );
    return;
  }

  if (!isStaticAsset(url)) return;

  // 静态资源：cache-first，未命中再走网络并回填缓存
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request, { ignoreSearch: false });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && (response.type === "basic" || response.type === "default")) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const fallback = await cache.match(request, { ignoreSearch: true });
        if (fallback) return fallback;
        throw error;
      }
    })(),
  );
});
