import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const HEARTBEAT_INTERVAL = 30000;

export function usePresence() {
  const [location] = useLocation();
  const lastRouteRef = useRef(location);

  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await fetch("/api/user-presence", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ route: location }),
        });
        lastRouteRef.current = location;
      } catch (error) {
      }
    };

    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    const handleBeforeUnload = async () => {
      try {
        navigator.sendBeacon("/api/user-presence", JSON.stringify({ action: "leave" }));
      } catch {
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [location]);
}
