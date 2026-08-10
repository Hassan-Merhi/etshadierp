import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

export interface RecentNavEntry {
  url: string;
  title: string;
  visitedAt: number;
}

const MAX_ITEMS = 5;

function storageKey(companyId: number | undefined) {
  return companyId ? `recent-nav-v1-company-${companyId}` : "recent-nav-v1-global";
}

function loadFromStorage(companyId: number | undefined): RecentNavEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: RecentNavEntry[], companyId: number | undefined) {
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(entries));
  } catch {
    // Storage is unavailable in private mode and can throw on quota; the value is a convenience, not state we need.
  }
}

interface NavItemLike {
  url: string;
  title: string;
}

export function useRecentNav(allNavItems: NavItemLike[], companyId?: number) {
  const [location] = useLocation();
  const [recent, setRecent] = useState<RecentNavEntry[]>(() => loadFromStorage(companyId));

  useEffect(() => {
    setRecent(loadFromStorage(companyId));
  }, [companyId]);

  const titleMap = useMemo(() => {
    const map: Record<string, string> = {};
    allNavItems.forEach((item) => {
      map[item.url] = item.title;
    });
    return map;
  }, [allNavItems]);

  useEffect(() => {
    const title = titleMap[location];
    if (!title) return;
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.url !== location);
      const next = [{ url: location, title, visitedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      saveToStorage(next, companyId);
      return next;
    });
  }, [location, titleMap, companyId]);

  return recent;
}
