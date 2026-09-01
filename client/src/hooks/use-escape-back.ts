import { useCallback, useEffect, useRef } from "react";
import { goBackToPreviousErpLocation } from "@/lib/erp-navigation-history";

type EscapeHandler = () => void;

const escapeHandlers: EscapeHandler[] = [];
let listenerAttached = false;

export function hasActiveEscapeHandler(): boolean {
  return escapeHandlers.length > 0;
}

function hasAnyOpenDialog(): boolean {
  return !!(
    document.querySelector('[data-state="open"][role="dialog"]') ||
    document.querySelector('[data-state="open"][role="alertdialog"]') ||
    document.querySelector("[data-radix-popper-content-wrapper]") ||
    document.querySelector('[role="listbox"]') ||
    document.querySelector('[data-state="open"].fixed') ||
    document.querySelector('[data-state="open"][role="menu"]') ||
    document.querySelector('[data-state="open"][role="combobox"]') ||
    document.querySelector("[data-radix-select-viewport]") ||
    document.querySelector("[cmdk-dialog]")
  );
}

function handleDocumentEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;

  // Radix and other layered controls own the first Escape press. Because this
  // listener runs in capture phase, their open state is still observable here.
  if (hasAnyOpenDialog()) return;

  // A tracked ERP browser entry is the canonical Back action. Resolve it
  // before page-specific Escape callbacks or editable-field blur behavior so
  // Esc returns to the exact same URL/state as the visible Back control.
  if (goBackToPreviousErpLocation()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const activeElement = document.activeElement as HTMLElement | null;
  if (
    activeElement &&
    (activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.tagName === "SELECT" ||
      activeElement.isContentEditable)
  ) {
    activeElement.blur();
    event.preventDefault();
    return;
  }

  const activeHandler = escapeHandlers[escapeHandlers.length - 1];
  if (!activeHandler) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  activeHandler();
}

function attachListener() {
  if (listenerAttached || typeof document === "undefined") return;
  document.addEventListener("keydown", handleDocumentEscape, { capture: true });
  listenerAttached = true;
}

function detachListenerWhenUnused() {
  if (!listenerAttached || escapeHandlers.length > 0 || typeof document === "undefined") return;
  document.removeEventListener("keydown", handleDocumentEscape, { capture: true });
  listenerAttached = false;
}

/**
 * Registers one Escape action for the current page or inline layer.
 *
 * Escape priority is global and deterministic:
 * 1. Open dialog, menu, select, command palette, or drawer handles Escape.
 * 2. Tracked ERP history uses the exact same browser Back entry as the UI Back control.
 * 3. Focused editable field is blurred when there is no tracked ERP Back entry.
 * 4. The most recently mounted page/inline handler runs as the fallback.
 *
 * A single document listener prevents nested page hooks from navigating twice.
 */
export function useEscapeBack(onBack: (() => void) | null) {
  const callbackRef = useRef(onBack);
  callbackRef.current = onBack;

  const stableHandler = useCallback(() => {
    callbackRef.current?.();
  }, []);

  useEffect(() => {
    if (!onBack) return;

    escapeHandlers.push(stableHandler);
    attachListener();

    return () => {
      const index = escapeHandlers.lastIndexOf(stableHandler);
      if (index >= 0) escapeHandlers.splice(index, 1);
      detachListenerWhenUnused();
    };
  }, [onBack, stableHandler]);
}

export { hasAnyOpenDialog };
