const CACHE = "gate-control-v18";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/gate-icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

async function fetchWithTimeout(request, milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(request, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate") {
    event.respondWith(fetchWithTimeout(event.request, 5000).then((response) => {
      if (!response.ok) throw new Error("App server unavailable");
      caches.open(CACHE).then((cache) => cache.put("/", response.clone()));
      return response;
    }).catch(() => caches.match("/offline.html")));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: "App server unavailable." }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } })));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || "A gate schedule needs attention." }; }
  event.waitUntil(self.registration.showNotification(data.title || "Gate Control schedule warning", {
    body: data.body || "A gate did not reach its scheduled state.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "gate-schedule-warning",
    renotify: true,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.focus(); existing.navigate?.(url); return; }
    await self.clients.openWindow(url);
  }));
});
