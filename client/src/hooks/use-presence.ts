import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

const HEARTBEAT_INTERVAL = 60000;

export function usePresence() {
  const [location] = useLocation();
  const lastRouteRef = useRef(location);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const sendHeartbeat = useCallback(async (route: string) => {
    try {
      await fetch("/api/user-presence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ route }),
      });
    } catch {
    }
  }, []);

  useEffect(() => {
    lastRouteRef.current = location;
    sendHeartbeat(location);
  }, [location, sendHeartbeat]);

  useEffect(() => {
    isMountedRef.current = true;

    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        sendHeartbeat(lastRouteRef.current);
      }
    }, HEARTBEAT_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isMountedRef.current) {
        sendHeartbeat(lastRouteRef.current);
      }
    };

    const handleBeforeUnload = () => {
      const data = new Blob([JSON.stringify({ action: "leave" })], { type: "application/json" });
      navigator.sendBeacon("/api/user-presence/leave", data);
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
      fetch("/api/user-presence", {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    };
  }, [sendHeartbeat]);
}
