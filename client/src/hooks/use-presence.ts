import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

// How often to send a keepalive heartbeat while the user is idle on a page.
const HEARTBEAT_INTERVAL = 120000; // 2 minutes

// Minimum gap between consecutive route-change heartbeats to prevent
// rapid navigation from flooding the DB.
const ROUTE_DEBOUNCE_MS = 10000; // 10 seconds

export function usePresence() {
  const [location] = useLocation();
  const lastRouteRef = useRef(location);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const lastSentAtRef = useRef<number>(0);

  const sendHeartbeat = useCallback((route: string) => {
    fetch("/api/user-presence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ route }),
    }).catch(() => {
      // Presence is non-critical; swallow all errors silently.
    });
  }, []);

  // Send a heartbeat on route changes, debounced to avoid bursts.
  useEffect(() => {
    const now = Date.now();
    lastRouteRef.current = location;

    if (now - lastSentAtRef.current >= ROUTE_DEBOUNCE_MS) {
      lastSentAtRef.current = now;
      sendHeartbeat(location);
    }
  }, [location, sendHeartbeat]);

  useEffect(() => {
    isMountedRef.current = true;

    // Periodic keepalive.
    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        sendHeartbeat(lastRouteRef.current);
        lastSentAtRef.current = Date.now();
      }
    }, HEARTBEAT_INTERVAL);

    // Re-send when the tab becomes visible (user switches back).
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isMountedRef.current) {
        sendHeartbeat(lastRouteRef.current);
        lastSentAtRef.current = Date.now();
      }
    };

    // sendBeacon on page close — more reliable than fetch in unload handlers.
    // The server-side leave endpoint responds 204 immediately so sendBeacon
    // always completes within the browser's short unload window.
    const handleBeforeUnload = () => {
      navigator.sendBeacon(
        "/api/user-presence/leave",
        new Blob([JSON.stringify({ action: "leave" })], { type: "application/json" })
      );
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // NOTE: No DELETE on unmount here. The hook lives at the App root so it
      // only unmounts when the page itself unloads, which is already covered by
      // the beforeunload sendBeacon above. A redundant DELETE would double the
      // DB writes and hold a pool connection during the most congested moment.
    };
  }, [sendHeartbeat]);
}
