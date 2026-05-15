import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

export interface RecentNavEntry {
  url: string;
  title: string;
  visitedAt: number;
}

const STORAGE_KEY = "recent-nav-v1";
const MAX_ITEMS = 5;

function loadFromStorage(): RecentNavEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: RecentNavEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

interface NavItemLike {
  url: string;
  title: string;
}

export function useRecentNav(allNavItems: NavItemLike[]) {
  const [location] = useLocation();
  const [recent, setRecent] = useState<RecentNavEntry[]>(loadFromStorage);

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
      const next = [
        { url: location, title, visitedAt: Date.now() },
        ...filtered,
      ].slice(0, MAX_ITEMS);
      saveToStorage(next);
      return next;
    });
  }, [location, titleMap]);

  return recent;
}
