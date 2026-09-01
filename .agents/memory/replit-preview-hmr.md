---
name: Replit preview HMR
description: Preview-specific Vite websocket behavior and development service-worker isolation
---

Replit's preview proxy may reject Vite HMR websocket upgrades even when the application is served correctly on port 5000. A service worker that remains installed can also cache `/src` and Vite prebundled modules across HMR generations, producing duplicate-React invalid-hook warnings.

**Why:** The preview is proxied rather than a direct local browser connection, so websocket and cached-module behavior differs from ordinary local development.

**How to apply:** Disable Vite HMR only when `REPL_ID` is present, retain HMR for local development, and do not register the production service worker in dev. Unregister legacy preview workers and clear their app caches once so an existing worker cannot keep intercepting development modules.