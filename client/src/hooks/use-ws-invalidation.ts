import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Heavy analytical queries that are intentionally excluded from blanket WS invalidation.
// These are expensive to compute, have a manual Refresh button, and should not jump
// around every time any write happens anywhere in the system.
const STABLE_QUERY_PREFIXES = [
  "/api/auth/me", // staleTime=Infinity on purpose — spurious auth re-checks cause login redirects
  "/api/stats/net-profit", // full balance-sheet computation; user refreshes manually
  "/api/reports/net-profit-statement", // P&L report; heavy computation
  "/api/balance-sheet", // balance sheet; heavy computation
];

export function useWsInvalidation() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Track whether we had a successful connection before, so we know a reconnect
  // may have missed broadcasts that fired while the socket was down.
  const hadSuccessfulConnectionRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function handleInvalidate() {
      // Debounce: if multiple WS messages arrive rapidly, only run one invalidation
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) {
          queryClient.invalidateQueries({
            refetchType: "active",
            predicate: (query) => {
              const key = query.queryKey[0];
              if (typeof key !== "string") return true;
              return !STABLE_QUERY_PREFIXES.some((prefix) => key.startsWith(prefix));
            },
          });
        }
      }, 800);
    }

    // Capacitor builds set VITE_WS_URL explicitly; web builds derive it from window.location.
    const _CAPACITOR_WS_URL: string = ((import.meta as any).env?.VITE_WS_URL as string) || "";

    function connect() {
      if (unmountedRef.current) return;

      let _wsTarget: string;
      if (_CAPACITOR_WS_URL) {
        _wsTarget = _CAPACITOR_WS_URL; // Capacitor build — env var set at build time
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        _wsTarget = `${protocol}//${window.location.host}/ws`; // Web — existing logic unchanged
      }
      const ws = new WebSocket(_wsTarget);
      wsRef.current = ws;

      ws.onopen = () => {
        // If this is a reconnect (not the initial connect), we may have missed
        // invalidation broadcasts while the socket was down — flush stale data now.
        if (hadSuccessfulConnectionRef.current && !unmountedRef.current) {
          handleInvalidate();
        }
        hadSuccessfulConnectionRef.current = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "invalidate") {
            handleInvalidate();
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!unmountedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      wsRef.current?.close();
    };
  }, [queryClient]);
}
