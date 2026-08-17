import { useCallback, useEffect, useState } from "react";

type HubQueryStateOptions<T extends string> = {
  key: "section" | "tab";
  allowedValues: readonly T[];
  defaultValue: T;
  clearKeys?: readonly string[];
  omitDefault?: boolean;
};

function readValue<T extends string>({
  key,
  allowedValues,
  defaultValue,
}: HubQueryStateOptions<T>): T {
  if (typeof window === "undefined") return defaultValue;

  const value = new URLSearchParams(window.location.search).get(key);
  return value && allowedValues.includes(value as T) ? (value as T) : defaultValue;
}

function canonicalizeLocation<T extends string>(options: HubQueryStateOptions<T>): T {
  const nextValue = readValue(options);
  const url = new URL(window.location.href);
  const rawValue = url.searchParams.get(options.key);
  const isValid = rawValue ? options.allowedValues.includes(rawValue as T) : true;

  if (!isValid) {
    if (options.omitDefault && nextValue === options.defaultValue) {
      url.searchParams.delete(options.key);
    } else {
      url.searchParams.set(options.key, nextValue);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return nextValue;
}

export function useHubQueryState<T extends string>(options: HubQueryStateOptions<T>) {
  const [value, setValue] = useState<T>(() => readValue(options));

  // Use a stable string key derived from the allowed values instead of the array
  // reference itself. Arrays created inline (e.g. via .map()) produce a new
  // reference on every render, which would cause this effect to re-fire every
  // render cycle even though the logical set of allowed values hasn't changed.
  const allowedValuesKey = options.allowedValues.join(",");

  useEffect(() => {
    const syncFromLocation = () => setValue(canonicalizeLocation(options));
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
    
  }, [options.key, options.defaultValue, allowedValuesKey, options.omitDefault, options]);

  const _clearKeysKey = (options.clearKeys ?? []).join(",");

  const updateValue = useCallback(
    (nextValue: T) => {
      setValue(nextValue);

      const url = new URL(window.location.href);
      if (options.omitDefault && nextValue === options.defaultValue) {
        url.searchParams.delete(options.key);
      } else {
        url.searchParams.set(options.key, nextValue);
      }

      for (const key of options.clearKeys ?? []) {
        url.searchParams.delete(key);
      }

      // Hub sections are view state, not separate navigation destinations.
      // Replacing keeps browser Back focused on meaningful page transitions.
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    },
    
    [options.omitDefault, options.defaultValue, options.key, options.clearKeys],
  );

  return [value, updateValue] as const;
}
