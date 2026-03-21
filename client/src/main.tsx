import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Global handler: catches dynamic import failures that happen before React renders
// (e.g. Suspense boundaries that aren't yet inside an ErrorBoundary).
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg =
    reason?.message || reason?.toString?.() || String(reason ?? "");

  const isChunk =
    msg.includes("dynamically imported module") ||
    msg.includes("Failed to fetch") ||
    msg.includes("Loading chunk") ||
    msg.includes("Importing a module script failed") ||
    /\/assets\/[^/]+-[A-Za-z0-9_-]+\.js/.test(msg);

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
