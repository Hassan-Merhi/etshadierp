import "./lib/requestStormGuard";
import "./lib/v5AllocationPaginationClient";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./mobile-browser-compat.css";

const ASSET_RECOVERY_PREFIX = "assetRecovery:";
const SW_RELOAD_PREFIX = "swReload:";
const RECOVERY_STABLE_MS = 10_000;
let assetRecoveryInFlight = false;

function pathScopedKey(prefix: string) {
  return `${prefix}${window.location.pathname}`;
}

function removeRecoveryMarkersAfterStableLoad() {
  window.setTimeout(() => {
    try {
      const toDelete: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith(ASSET_RECOVERY_PREFIX) || key.startsWith(SW_RELOAD_PREFIX))) {
          toDelete.push(key);
        }
      }
      toDelete.forEach((key) => sessionStorage.removeItem(key));
    } catch {
      /* sessionStorage may be blocked */
    }

    const url = new URL(window.location.href);
    const hadRecoveryParam = url.searchParams.delete("_asset_recovery");
    const hadServiceWorkerParam = url.searchParams.delete("_sw");
    if (hadRecoveryParam || hadServiceWorkerParam) {
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, RECOVERY_STABLE_MS);
}

function showStaleAssetRecoveryMessage() {
  if (document.getElementById("stale-asset-recovery")) return;

  const panel = document.createElement("div");
  panel.id = "stale-asset-recovery";
  panel.setAttribute("role", "alert");
  panel.style.position = "fixed";
  panel.style.inset = "0";
  panel.style.zIndex = "2147483647";
  panel.style.display = "flex";
  panel.style.alignItems = "center";
  panel.style.justifyContent = "center";
  panel.style.padding = "24px";
  panel.style.background = "rgba(15, 23, 42, 0.96)";
  panel.style.color = "white";
  panel.style.fontFamily = "system-ui, sans-serif";
  panel.style.textAlign = "center";

  const content = document.createElement("div");
  content.style.maxWidth = "460px";

  const title = document.createElement("h1");
  title.textContent = "Application update required";
  title.style.fontSize = "22px";
  title.style.fontWeight = "700";
  title.style.margin = "0 0 12px";

  const description = document.createElement("p");
  description.textContent =
    "The browser could not load the latest application files. Refresh once after checking your connection.";
  description.style.fontSize = "16px";
  description.style.lineHeight = "1.5";
  description.style.margin = "0 0 20px";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Refresh application";
  button.style.minHeight = "44px";
  button.style.padding = "10px 18px";
  button.style.border = "0";
  button.style.borderRadius = "8px";
  button.style.fontSize = "16px";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(pathScopedKey(ASSET_RECOVERY_PREFIX));
    } catch {
      /* sessionStorage may be blocked */
    }
    window.location.reload();
  });

  content.append(title, description, button);
  panel.append(content);
  document.body.append(panel);
}

async function clearErpCachesForRecovery() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
  await registration?.update().catch(() => undefined);

  const controller = navigator.serviceWorker.controller;
  if (controller) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(resolve, 1500);
      channel.port1.onmessage = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      controller.postMessage({ type: "CLEAR_APP_CACHES" }, [channel.port2]);
    });
    return;
  }

  // A first-load page may not be controlled yet. Clear only ERP-owned caches;
  // IndexedDB and offline mutation queues remain untouched.
  if ("caches" in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.filter((key) => key.startsWith("erp-")).map((key) => caches.delete(key)));
  }
}

async function recoverFromStaleAssets() {
  if (assetRecoveryInFlight || import.meta.env.DEV) return;

  const currentUrl = new URL(window.location.href);
  const recoveryKey = pathScopedKey(ASSET_RECOVERY_PREFIX);
  let alreadyAttempted = currentUrl.searchParams.has("_asset_recovery");

  try {
    alreadyAttempted = alreadyAttempted || !!sessionStorage.getItem(recoveryKey);
  } catch {
    /* the URL marker still prevents loops when storage is blocked */
  }

  if (alreadyAttempted) {
    showStaleAssetRecoveryMessage();
    return;
  }

  assetRecoveryInFlight = true;
  try {
    sessionStorage.setItem(recoveryKey, String(Date.now()));
  } catch {
    /* continue with the URL marker */
  }

  await clearErpCachesForRecovery().catch(() => undefined);
  currentUrl.searchParams.set("_asset_recovery", String(Date.now()));
  window.location.replace(currentUrl.toString());
}

// Catch dynamic import failures that occur before or outside React error boundaries.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
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
  const isChunkFailure =
    combined.includes("dynamically imported module") ||
    combined.includes("Loading chunk") ||
    combined.includes("Importing a module script failed") ||
    combined.includes("Unable to preload CSS") ||
    combined.includes("ChunkLoadError") ||
    reason?.name === "ChunkLoadError";

  // Bare "Failed to fetch" is intentionally excluded because it also matches API failures.
  if (isChunkFailure) {
    event.preventDefault();
    void recoverFromStaleAssets();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event?.data?.type === "SW_UPDATED") {
      if (assetRecoveryInFlight) return;

      const version = String(event.data.version || "unknown");
      const reloadKey = pathScopedKey(`${SW_RELOAD_PREFIX}${version}:`);
      const url = new URL(window.location.href);
      let alreadyReloaded = url.searchParams.get("_sw") === version;

      try {
        alreadyReloaded = alreadyReloaded || !!sessionStorage.getItem(reloadKey);
      } catch {
        /* URL marker remains available */
      }

      if (!alreadyReloaded) {
        try {
          sessionStorage.setItem(reloadKey, "1");
        } catch {
          /* URL marker remains available */
        }
        url.searchParams.set("_sw", version);
        window.location.replace(url.toString());
      }
    } else if (event?.data?.type === "TRIGGER_SYNC") {
      import("./lib/featureFlags").then(({ OFFLINE_MODE_ENABLED }) => {
        if (OFFLINE_MODE_ENABLED) {
          import("./lib/syncEngine").then(({ runSync }) => runSync()).catch(() => {});
        }
      });
    }
  });

  // Explicitly bypass HTTP caching when checking the service-worker script.
  navigator.serviceWorker.getRegistration("/").then((registration) => {
    if (registration) registration.update().catch(() => {});
  }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
removeRecoveryMarkersAfterStableLoad();
