/**
 * Pure helpers and lookup tables for the PropertiesDashboard page.
 *
 * Extracted from PropertiesDashboard.tsx during the Phase 4 god-file split.
 */

export const PROPS_CUSTOM_NET_HIDDEN_KEY = "props_custom_net_hidden";

export function loadPropsCustomViewHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(PROPS_CUSTOM_NET_HIDDEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function savePropsCustomViewHidden(keys: Set<string>) {
  localStorage.setItem(PROPS_CUSTOM_NET_HIDDEN_KEY, JSON.stringify(Array.from(keys)));
}
