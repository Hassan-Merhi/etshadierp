/**
 * Pure helpers and lookup tables for the CreateProformaV5Drawer page.
 *
 * Extracted from CreateProformaV5Drawer.tsx during the Phase 4 god-file split.
 */

import type { Draft } from "./types";

export const DRAFT_KEY = "create-proforma-v5-draft";

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    // Storage is unavailable in private mode and can throw on quota; the value is a convenience, not state we need.
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage is unavailable in private mode and can throw on quota; the value is a convenience, not state we need.
  }
}
