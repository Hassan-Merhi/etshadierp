import "./lib/requestStormGuard";
import "./lib/v5AllocationPaginationClient";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Clear stale chunk-retry/reload counters from sessionStorage on every fresh page load.
// These keys are written before a hard-reload attempt; if a reload succeeds the keys are
// never cleaned up, leaving the browser permanently "retry-exhausted" until the session ends.
try {
  const toDelete: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && (k.startsWith("chunkRetry:") || k.startsWith("chunkReload:"))) {
      toDelete.push(k);
    }
  }
  toDelete.forEach((k) => sessionStorage.removeItem(k));
} catch {
  /* ignore — sessionStorage may be blocked in some contexts */
}

// Global handler: catches dynamic import failures that happen before React renders
// (e.g. Suspense boundaries that aren't yet inside an ErrorBoundary).
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;

  // Collect only message and name — deliberately omit stack traces because
  // production JS files have hashed paths that could appear in any stack,
  // causing legitimate runtime errors to be mis-classified as chunk errors
  // and triggering a spurious reload loop.
  const candidates: string[] = [];
  if (typeof reason === "string") {
    candidates.push(reason);
  } else if (reason && typeof reason === "object") {
    if (reason.message) candidates.push(String(reason.message));
    if (reason.name) candidates.push(String(reason.name));
    try {
      candidates.push(reason.toString());
    } catch {
      /* ignore */
    }
  }
  const combined = candidates.join(" ");

  const isChunk =
    combined.includes("dynamically imported module") ||
    combined.includes("Loading chunk") ||
    combined.includes("Importing a module script failed") ||
    combined.includes("Unable to preload CSS") ||
    combined.includes("ChunkLoadError") ||
    reason?.name === "ChunkLoadError";
  // NOTE: bare "Failed to fetch" intentionally excluded — it also matches API failures.
  // NOTE: stack-trace path regex intentionally excluded — hashed filenames like /assets/Foo-ABC123.js
  //       appear in ALL runtime error stacks and cause false positives → infinite reload loop.

  if (isChunk) {
    // In development, Vite's HMR already handles reconnection and module reloading.
    // Auto-reloading here would fight with Vite's own recovery mechanism and create
    // a loop whenever the dev server restarts.
    if (import.meta.env.DEV) return;

    const path = window.location.pathname;
    const key = "chunkReload:" + path;
    try {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.href = path + "?_r=" + Date.now();
      }
    } catch {
      /* ignore */
    }
  }
});

// Listen for service-worker messages
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event?.data?.type === "SW_UPDATED") {
      // New SW has activated and claimed this tab — reload so the fresh
      // JS bundles are used (prevents null-React / stale-chunk crashes).
      window.location.reload();
    } else if (event?.data?.type === "TRIGGER_SYNC") {
      import("./lib/featureFlags").then(({ OFFLINE_MODE_ENABLED }) => {
        if (OFFLINE_MODE_ENABLED) {
          import("./lib/syncEngine").then(({ runSync }) => runSync()).catch(() => {});
        }
      });
    }
  });

  // On every app startup, trigger an update check on any existing SW registration.
  // This ensures users pick up the new SW (and fresh cache) as fast as possible
  // after a production deployment — without waiting for the next manual offline-prep run.
  navigator.serviceWorker.getRegistration("/").then((reg) => {
    if (reg) reg.update().catch(() => {});
  }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
