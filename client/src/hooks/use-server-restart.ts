import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 8_000;

export function useServerRestart() {
  const knownBootId = useRef<string | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      if (reloading.current) return;
      try {
        const res = await fetch("/api/boot", { credentials: "omit" });
        if (!res.ok) return;
        const { bootId } = await res.json();
        if (knownBootId.current === null) {
          knownBootId.current = bootId;
        } else if (knownBootId.current !== bootId) {
          reloading.current = true;
          window.location.reload();
          return;
        }
      } catch {
        // server not yet ready — try again next tick
      }
      timer = setTimeout(check, POLL_INTERVAL_MS);
    }

    timer = setTimeout(check, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, []);
}
