const CACHE_VERSION = "erp-v6";
const APP_SHELL = ["/", "/manifest.json"];

// ── Install: cache app shell ──────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
});

// ── Activate: prune old caches and take control of all tabs ───────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: "window" }).then((clients) =>
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }))
        )
      )
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // Network-first for API calls; offline JSON fallback
    event.respondWith(networkFirstApi(request));
  } else if (request.mode === "navigate") {
    // Navigation requests: network first, fall back to cached shell (SPA)
    event.respondWith(navigationHandler(request));
  } else if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/node_modules/.vite/") ||
    url.pathname.startsWith("/src/")
  ) {
    // Vite bundles + pre-bundled deps + source files: always network-first
    // so a stale service-worker cache never poisons JS/CSS and causes React
    // hook crashes (duplicate-React / null-dispatcher errors).
    event.respondWith(networkFirstAsset(request));
  } else {
    // Other static assets (fonts, images, sw.js itself): stale-while-revalidate
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function networkFirstApi(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "Offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function navigationHandler(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
      return response;
    }
    throw new Error("Network response not ok");
  } catch {
    // Fall back to the cached root (SPA shell) so the app loads offline
    const cached =
      (await caches.match(request)) ||
      (await caches.match("/"));
    if (cached) return cached;
    return new Response("Offline — please check your connection.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// Network-first for /assets/* (Vite content-hashed bundles).
// Never serve a cached HTML response as JavaScript — if the server returns
// HTML (e.g. during a deployment transition), skip caching it entirely.
async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const ct = response.headers.get("content-type") || "";
      if (!ct.includes("text/html")) {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch {
    // Offline: serve from cache if available
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("Asset unavailable offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request.clone())
    .then((response) => {
      if (response.ok) {
        // Never cache HTML under a non-navigation URL — prevents MIME corruption
        const ct = response.headers.get("content-type") || "";
        if (!ct.includes("text/html")) {
          cache.put(request, response.clone());
        }
      }
      return response;
    })
    .catch(() => null);

  // If there is no cached version, await the network. Guard against the network
  // returning null (offline failure) — return a proper 503 so the browser sees
  // a meaningful failure rather than an invalid null Response.
  if (cached) return cached;
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;
  return new Response("Asset unavailable", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

// ── Background sync (triggered by ConnectivityContext) ────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "erp-sync") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "TRIGGER_SYNC" }));
      })
    );
  }
});

// ── Push notifications (future-proof hook) ───────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || "ERP Notification", {
        body: data.body || "",
        icon: "/favicon.png",
        tag: data.tag || "erp-notification",
      })
    );
  } catch {
    // Ignore malformed push payloads
  }
});
