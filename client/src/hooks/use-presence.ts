import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

const HEARTBEAT_INTERVAL = 120000; // 2 minutes
const ROUTE_DEBOUNCE_MS  = 10000;  // 10 seconds

type PresenceType = "route_change" | "heartbeat";

export function usePresence() {
  const [location] = useLocation();
  const lastRouteRef   = useRef(location);
  const intervalRef    = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef   = useRef(true);
  const lastSentAtRef  = useRef<number>(0);

  const sendHeartbeat = useCallback((route: string, type: PresenceType) => {
    fetch("/api/user-presence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ route, type }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const now = Date.now();
    lastRouteRef.current = location;

    if (now - lastSentAtRef.current >= ROUTE_DEBOUNCE_MS) {
      lastSentAtRef.current = now;
      sendHeartbeat(location, "route_change");
    }
  }, [location, sendHeartbeat]);

  useEffect(() => {
    isMountedRef.current = true;

    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        sendHeartbeat(lastRouteRef.current, "heartbeat");
        lastSentAtRef.current = Date.now();
      }
    }, HEARTBEAT_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isMountedRef.current) {
        sendHeartbeat(lastRouteRef.current, "route_change");
        lastSentAtRef.current = Date.now();
      }
    };

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
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [sendHeartbeat]);
}
