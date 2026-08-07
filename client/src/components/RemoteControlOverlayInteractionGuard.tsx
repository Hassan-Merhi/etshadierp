import { useEffect } from "react";

const OVERLAY_SELECTOR =
  "[data-testid='remote-mouse-controller-overlay'], [data-testid='remote-keyboard-controller-overlay']";
const ENABLE_BUTTON_SELECTOR =
  "[data-testid='button-enable-remote-mouse'], [data-testid='button-enable-remote-keyboard']";

function pointInside(element: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function makeOverlaysInteractive(): void {
  for (const overlay of document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
    overlay.style.setProperty("pointer-events", "auto", "important");
    overlay.style.setProperty("touch-action", "auto", "important");
    for (const element of overlay.querySelectorAll<HTMLElement>("button, input")) {
      element.style.setProperty("pointer-events", "auto", "important");
    }
  }
}

export function RemoteControlOverlayInteractionGuard() {
  useEffect(() => {
    makeOverlaysInteractive();
    const observer = new MutationObserver(makeOverlaysInteractive);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    let forwarding = false;
    const recoverInterceptedPointerUp = (event: PointerEvent) => {
      if (forwarding || event.button !== 0) return;
      if ((event.target as Element | null)?.closest(ENABLE_BUTTON_SELECTOR)) return;

      const button = Array.from(document.querySelectorAll<HTMLButtonElement>(ENABLE_BUTTON_SELECTOR)).find(
        (candidate) => !candidate.disabled && pointInside(candidate, event.clientX, event.clientY)
      );
      if (!button) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      forwarding = true;
      try {
        button.click();
      } finally {
        forwarding = false;
      }
    };

    document.addEventListener("pointerup", recoverInterceptedPointerUp, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerup", recoverInterceptedPointerUp, true);
    };
  }, []);

  return null;
}
