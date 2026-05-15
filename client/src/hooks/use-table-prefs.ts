import { useState, useCallback } from "react";

export interface TablePrefs {
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: Record<string, any>;
  pageSize?: number;
}

export function useTablePrefs(pageKey: string) {
  const storageKey = `table-prefs:${pageKey}`;

  const [prefs, setPrefsState] = useState<TablePrefs>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const setPrefs = useCallback(
    (update: Partial<TablePrefs> | ((prev: TablePrefs) => TablePrefs)) => {
      setPrefsState((prev) => {
        const next =
          typeof update === "function"
            ? update(prev)
            : { ...prev, ...update };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [storageKey],
  );

  const clearPrefs = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setPrefsState({});
  }, [storageKey]);

  return { prefs, setPrefs, clearPrefs };
}
