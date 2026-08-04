import { useEffect, useState } from "react";

/** Returns the latest value after it has remained unchanged for the delay. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), Math.max(0, delayMs));
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
