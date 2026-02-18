import { useEffect, useCallback } from "react";

export function useEscapeBack(onBack: (() => void) | null) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!onBack) return;

      const hasOpenDialog =
        document.querySelector('[data-state="open"][role="dialog"]') ||
        document.querySelector('[data-state="open"][role="alertdialog"]') ||
        document.querySelector(".radix-dialog-overlay[data-state='open']") ||
        document.querySelector('[data-radix-popper-content-wrapper]') ||
        document.querySelector('[role="listbox"]') ||
        document.querySelector('[data-state="open"].fixed');

      if (hasOpenDialog) return;

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
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handler, onBack]);
}
