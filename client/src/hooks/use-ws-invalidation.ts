import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWsInvalidation() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function handleInvalidate() {
      // Debounce: if multiple WS messages arrive rapidly, only run one invalidation
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) {
          // Only refetch queries that are currently active (mounted) and stale.
          // Exclude the auth session query — its staleTime is Infinity on purpose;
          // re-checking auth on every WS event causes spurious login redirects.
          queryClient.invalidateQueries({
            refetchType: "active",
            predicate: (query) => {
              const key = query.queryKey[0];
              return typeof key !== "string" || !key.includes("/api/auth/me");
            },
          });
        }
      }, 800);
    }

    function connect() {
      if (unmountedRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "invalidate") {
            handleInvalidate();
          }
        } catch {
        }
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
