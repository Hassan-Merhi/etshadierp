/**
 * sessionStorage persistence for the Factory Daybook filter state.
 *
 * Both helpers swallow storage errors on purpose: a browser with storage
 * disabled must still render the page, just without restoring filters.
 */
import type { FactoryDaybookUIState } from "./types";

export const FACTORY_DAYBOOK_STATE_KEY = "factory-daybook-ui-state";

export function loadFactoryDaybookState(): FactoryDaybookUIState | null {
  try {
    const raw = sessionStorage.getItem(FACTORY_DAYBOOK_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FactoryDaybookUIState;
  } catch {
    return null;
  }
}

export function saveFactoryDaybookState(state: FactoryDaybookUIState): void {
  try {
    sessionStorage.setItem(FACTORY_DAYBOOK_STATE_KEY, JSON.stringify(state));
  } catch {}
}
