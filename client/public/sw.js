const CACHE_VERSION = "erp-v10";
const CACHE_PREFIX = "erp-";
const APP_SHELL = ["/", "/manifest.json"];
const MAX_STATIC_CACHE_ENTRIES = 200;
const HASHED_ASSET_RE =
  /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg|ico)$/i;
const LABEL_PREVIEW_RE = /^\/labels\/previews\/[^/]+-preview\.webp$/i;

// ── Install: cache the latest app shell ───────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))
    )
  );
});

// ── Activate: prune old ERP caches and take control of all tabs ──────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    deleteErpCachesExcept(CACHE_VERSION)
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: "window" }).then((clients) =>
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED", version: CACHE_VERSION }))
        )
      )
  );
});

// Allow the page to request one controlled cache reset after a stale-chunk
// failure. IndexedDB/offline mutation queues are intentionally untouched.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_APP_CACHES") {
    event.waitUntil(
      deleteAllErpCaches().then(() => {
        event.ports?.[0]?.postMessage({ type: "APP_CACHES_CLEARED", version: CACHE_VERSION });
      })
    );
  }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests. Range responses must stay on the
  // network because a cached partial response can corrupt later downloads.
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // API responses contain company-scoped and user-scoped data. They are
    // already protected by the in-memory request guards and server microcache;
    // persisting multi-megabyte JSON in shared Cache Storage would create stale
    // cross-login data and unbounded device storage. Always use the network.
    event.respondWith(networkOnlyApi(request));
  } else if (request.mode === "navigate") {
    // Navigation requests: network first, fall back to the single cached SPA shell.
    event.respondWith(navigationHandler(request));
  } else if (HASHED_ASSET_RE.test(url.pathname)) {
    // Content-hashed production assets are immutable and safe for cache-first.
    event.respondWith(cacheFirstHashedAsset(request));
  } else if (isVersionedLabelAsset(url)) {
    // Label previews are immutable defaults; custom banners carry a stable
    // ?t=<updatedAt> version. Both can avoid repeat downloads safely.
    event.respondWith(cacheFirstVersionedAsset(request));
  } else if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/node_modules/.vite/") ||
    url.pathname.startsWith("/src/")
  ) {
    // Unhashed/dev assets remain network-first so edits are immediately visible.
    event.respondWith(networkFirstAsset(request));
  } else {
    // Other small static assets use stale-while-revalidate with a bounded cache.
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ── Cache helpers ──────────────────────────────────────────────────────────────

function isVersionedLabelAsset(url) {
  if (LABEL_PREVIEW_RE.test(url.pathname)) return true;
  return url.pathname.startsWith("/labels/") && url.searchParams.has("t");
}

async function deleteErpCachesExcept(keepName) {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== keepName).map((key) => caches.delete(key))
  );
}

async function deleteAllErpCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)));
}

async function putBounded(cache, request, response) {
  await cache.put(request, response);
  const keys = await cache.keys();
  const overflow = keys.length - MAX_STATIC_CACHE_ENTRIES;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

function rejectHtmlAssetResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return null;
  return new Response("Asset response was HTML", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

// ── Strategies ────────────────────────────────────────────────────────────────

async function networkOnlyApi(request) {
  try {
    return await fetch(request.clone(), { cache: "no-store" });
  } catch {
    return new Response(JSON.stringify({ error: "Offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function navigationHandler(request) {
  try {
    // Bypass the browser HTTP cache so deployments cannot pair stale HTML with
    // newly hashed JavaScript files. Cache only one canonical SPA shell.
    const response = await fetch(request.clone(), { cache: "no-store" });
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        const cache = await caches.open(CACHE_VERSION);
        await cache.put("/", response.clone());
      }
      return response;
    }
    throw new Error("Network response not ok");
  } catch {
    const cached = await caches.match("/");
    if (cached) return cached;
    return new Response("Offline — please check your connection.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// Cache-first is safe only for Vite content-hashed production files. Their URL
// changes whenever the content changes, and the server marks them immutable.
async function cacheFirstHashedAsset(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request.clone());
    const invalidResponse = rejectHtmlAssetResponse(response);
    if (invalidResponse) return invalidResponse;
    if (response.ok) await putBounded(cache, request, response.clone());
    return response;
  } catch {
    return new Response("Asset unavailable offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirstVersionedAsset(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request.clone());
    const invalidResponse = rejectHtmlAssetResponse(response);
    if (invalidResponse) return invalidResponse;
    if (response.ok) await putBounded(cache, request, response.clone());
    return response;
  } catch {
    return new Response("Asset unavailable offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// Network-first for unhashed Vite/development content. Never return HTML as a
// script or stylesheet; that produces misleading MIME errors on mobile browsers.
async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request.clone(), { cache: "no-store" });
    const invalidResponse = rejectHtmlAssetResponse(response);
    if (invalidResponse) return invalidResponse;
    if (response.ok) await putBounded(cache, request, response.clone());
    return response;
  } catch {
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
    .then(async (response) => {
      if (response.ok) {
        // Never cache HTML under a non-navigation URL — prevents MIME corruption.
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) {
          await putBounded(cache, request, response.clone());
        }
      }
      return response;
    })
    .catch(() => null);

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
    // Ignore malformed push payloads.
  }
});
