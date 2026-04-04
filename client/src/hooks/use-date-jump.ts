import { useEffect, useRef } from "react";

export function useDateJump(callback: (date: string) => void) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const handler = (e: Event) => {
      const { date } = (e as CustomEvent<{ date: string }>).detail;
      cbRef.current(date);
    };
    window.addEventListener("erp-date-jump", handler);
    return () => window.removeEventListener("erp-date-jump", handler);
  }, []);
}

export function dispatchDateJump(date: string) {
  window.dispatchEvent(new CustomEvent("erp-date-jump", { detail: { date } }));
}
