// 离线缓存：打包好的文件（带版本号）直接用手机里的；页面本身优先联网拿最新的，太慢就先用缓存
const CACHE = "qisuo-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // /assets/ 下的文件名带版本号，内容不会变：缓存优先
  if (url.pathname.includes("/assets/")) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // 页面和其他文件：联网优先，4 秒没回应或者断网就用缓存
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const network = fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      });
      const timeout = new Promise(r => setTimeout(r, 4000));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch { /* 断网 */ }
      return (await c.match(req)) || (await c.match("./")) || network;
    }),
  );
});
