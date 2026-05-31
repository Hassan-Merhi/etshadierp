import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration.
 *
 * webDir — points to the Vite build output (matches vite.config.ts build.outDir
 *          which is dist/public relative to the project root).
 *
 * androidScheme — "https" makes Android WebView treat the app as running from
 *                 https://localhost, matching iOS behaviour and avoiding
 *                 mixed-content blocks when talking to an HTTPS API server.
 *
 * server.url — intentionally absent for production builds. The app loads its
 *              bundled assets from dist/public. Only set during local development
 *              (e.g. "http://10.0.2.2:5000" for the Android emulator) — never
 *              commit a server.url value.
 */
const config: CapacitorConfig = {
  appId: "com.erp.warehouse",
  appName: "ERP Warehouse",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
};

export default config;
