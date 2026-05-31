/**
 * Capacitor environment utilities.
 *
 * These variables are empty/absent in standard web builds — every code path
 * falls back to existing behavior automatically. They are only set when
 * building a Capacitor iOS/Android binary.
 *
 * VITE_API_BASE_URL  — absolute server URL, e.g. "https://your-server.com"
 *                      Prefixed onto all relative /api/* fetch calls so the
 *                      Capacitor WebView reaches the remote server instead of
 *                      resolving against capacitor://localhost (iOS) or
 *                      http://localhost (Android).
 *
 * VITE_WS_URL        — WebSocket URL, e.g. "wss://your-server.com/ws"
 *                      Used by useWsInvalidation when window.location cannot
 *                      be used to derive the correct host.
 */

export const CAPACITOR_API_BASE: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE_URL) || "";

export const CAPACITOR_WS_URL: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_WS_URL) || "";

/**
 * Returns true when the app is running inside a Capacitor WebView.
 * Safe to call anywhere — returns false in Node / SSR / regular browser.
 */
export function isCapacitor(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.protocol === "capacitor:" ||
      !!(window as any).Capacitor)
  );
}
