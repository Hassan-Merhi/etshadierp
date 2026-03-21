import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Global handler: catches dynamic import failures that happen before React renders
// (e.g. Suspense boundaries that aren't yet inside an ErrorBoundary).
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;

  // Collect all text fields we can inspect
  const candidates: string[] = [];
  if (typeof reason === "string") {
    candidates.push(reason);
  } else if (reason && typeof reason === "object") {
    if (reason.message) candidates.push(String(reason.message));
    if (reason.stack)   candidates.push(String(reason.stack));
    if (reason.name)    candidates.push(String(reason.name));
    try { candidates.push(reason.toString()); } catch { /* ignore */ }
  }
  const combined = candidates.join(" ");

  const isChunk =
    combined.includes("dynamically imported module") ||
    combined.includes("Loading chunk") ||
    combined.includes("Importing a module script failed") ||
    combined.includes("Unable to preload CSS") ||
    combined.includes("ChunkLoadError") ||
    reason?.name === "ChunkLoadError" ||
    /\/assets\/[^/]+-[A-Za-z0-9_-]+\.js/.test(combined);
  // NOTE: bare "Failed to fetch" intentionally excluded — it also matches API failures.

  if (isChunk) {
    const path = window.location.pathname;
    const key = "chunkReload:" + path;
    try {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.href = path + "?_r=" + Date.now();
      }
    } catch { /* ignore */ }
  }
});

createRoot(document.getElementById("root")!).render(<App />);
