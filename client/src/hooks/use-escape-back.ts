import { useEffect, useCallback } from "react";

let activeEscapeHandlerCount = 0;
export function hasActiveEscapeHandler(): boolean {
  return activeEscapeHandlerCount > 0;
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

export function useEscapeBack(onBack: (() => void) | null) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!onBack) return;

      // Run in capture phase so we check dialog state BEFORE Radix closes it.
      if (hasAnyOpenDialog()) return;

      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        (activeEl as HTMLElement).blur();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      onBack();
    },
    [onBack]
  );

  useEffect(() => {
    if (!onBack) return;
    activeEscapeHandlerCount += 1;
    // Capture phase: fires before Radix dialog Escape handling,
    // so data-state is still "open" when we check.
    document.addEventListener("keydown", handler, { capture: true });
    return () => {
      activeEscapeHandlerCount -= 1;
      document.removeEventListener("keydown", handler, { capture: true });
    };
  }, [handler, onBack]);
}

export { hasAnyOpenDialog };
