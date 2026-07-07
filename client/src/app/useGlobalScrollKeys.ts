import { useEffect } from "react";
import { hasActiveEscapeHandler } from "@/hooks/use-escape-back";

/**
 * Registers a global keydown listener that:
 *  1. Intercepts Arrow / PageUp / PageDown / Home / End keys and scrolls the
 *     nearest scrollable container in the requested direction.
 *  2. Handles Escape: defers to page-level handlers (useEscapeBack), blurs
 *     inputs, and falls back to calling `handleGoBack` when no overlay is open.
 *
 * RULE: never calls e.preventDefault() unless a scrollable element exists AND
 * can actually move in the requested direction. Violating this blocks cursor
 * movement in inputs, Radix widget keyboard navigation, and native browser
 * behavior.
 */
export function useGlobalScrollKeys(handleGoBack: () => void): void {
  useEffect(() => {
    // ─── Scroll-key helpers ──────────────────────────────────────────────────

    // Returns true when the event target is an element that owns arrow-key
    // behavior: text inputs, selects, contentEditable nodes, and ARIA widgets
    // such as listboxes, menus, sliders, and comboboxes.
    function isEditableTarget(el: HTMLElement): boolean {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      const role = el.getAttribute("role");
      if (
        role &&
        [
          "listbox", "option", "combobox", "menu", "menuitem",
          "menuitemcheckbox", "menuitemradio", "slider", "spinbutton",
          "treeitem", "tree", "gridcell", "row", "columnheader",
        ].includes(role)
      )
        return true;
      if (el.hasAttribute("data-radix-scroll-area-viewport")) return true;
      return false;
    }

    // Returns true only when `el` has a scrollable overflow style AND still has
    // room to scroll in the requested direction. Both conditions must be met.
    function canScroll(el: Element, axis: "x" | "y", direction: number): boolean {
      const s = window.getComputedStyle(el);
      if (axis === "y") {
        const ov = s.overflowY;
        if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") return false;
        return direction > 0
          ? el.scrollTop < el.scrollHeight - el.clientHeight - 1
          : el.scrollTop > 0;
      } else {
        const ov = s.overflowX;
        if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") return false;
        return direction > 0
          ? el.scrollLeft < el.scrollWidth - el.clientWidth - 1
          : el.scrollLeft > 0;
      }
    }

    // Walks up the DOM from `start` and returns the first ancestor that can
    // actually scroll in the given axis and direction.
    function getScrollableAncestor(
      start: Element | null,
      axis: "x" | "y",
      direction: number,
    ): Element | null {
      let el: Element | null = start;
      while (el && el !== document.body && el !== document.documentElement) {
        if (canScroll(el, axis, direction)) return el;
        el = el.parentElement;
      }
      return null;
    }

    // Full resolution strategy — returns the best scroll target or null.
    // Null means "nothing can scroll; do not preventDefault".
    function getBestScrollTarget(
      eventTarget: HTMLElement,
      axis: "x" | "y",
      direction: number,
    ): Element | null {
      // 1. Walk up from the element that received the keydown event
      const fromTarget = getScrollableAncestor(eventTarget, axis, direction);
      if (fromTarget) return fromTarget;

      // 2. Walk up from the currently focused element (may differ from event target)
      const active = document.activeElement;
      if (active && active !== eventTarget) {
        const fromActive = getScrollableAncestor(active, axis, direction);
        if (fromActive) return fromActive;
      }

      // 3. Try <main> directly (standard non-full-height pages)
      const main = document.querySelector("main");
      if (main && canScroll(main, axis, direction)) return main;

      // 4. Scan inside <main> (or body) for Tailwind overflow class elements
      //    and elements with computed overflow:auto/scroll.
      //    Covers full-height pages (e.g. Tracking) where an inner div scrolls.
      const root = main || document.body;
      const classSelector =
        axis === "x"
          ? ".overflow-auto, .overflow-x-auto, .overflow-x-scroll, .overflow-scroll"
          : ".overflow-auto, .overflow-y-auto, .overflow-y-scroll, .overflow-scroll, .custom-scrollbar";

      // Build candidate list from class-based selector first (fast path)
      const seen = new Set<Element>();
      const candidates: HTMLElement[] = [];
      for (const c of root.querySelectorAll<HTMLElement>(classSelector)) {
        seen.add(c);
        candidates.push(c);
      }
      // Supplement with elements that have computed overflow but no matching class
      for (const c of root.querySelectorAll<HTMLElement>("*")) {
        if (seen.has(c)) continue;
        const s = window.getComputedStyle(c);
        const ov = axis === "x" ? s.overflowX : s.overflowY;
        if (ov === "auto" || ov === "scroll" || ov === "overlay") candidates.push(c);
      }

      for (const c of candidates) {
        const rect = c.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // hidden element
        if (canScroll(c, axis, direction)) return c;
      }

      // 5. Final fallback: the document scroll root (usually <html>)
      const scrollRoot = document.scrollingElement;
      if (scrollRoot && canScroll(scrollRoot, axis, direction)) return scrollRoot;

      return null; // nothing scrollable found
    }
    // ────────────────────────────────────────────────────────────────────────

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // ── Arrow / page-scroll handling ────────────────────────────────────
      // We intercept these only when we find a container that CAN scroll.
      // If nothing can scroll, we return early and let the browser / local
      // handlers handle the key (cursor movement, Radix navigation, etc.).
      const scrollKeys = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "PageUp", "PageDown", "Home", "End",
      ];
      if (scrollKeys.includes(e.key)) {
        // Always let editable elements and ARIA widgets handle their own arrows
        if (isEditableTarget(target)) return;

        const isHorizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
        const axis: "x" | "y" = isHorizontal ? "x" : "y";
        const direction =
          e.key === "ArrowDown" || e.key === "ArrowRight" ||
          e.key === "PageDown" || e.key === "End"
            ? 1
            : -1;

        const scrollTarget = getBestScrollTarget(target, axis, direction);
        if (!scrollTarget) {
          // No scrollable container found — do NOT preventDefault.
          // This preserves native browser behavior and local page handlers.
          return;
        }

        // Only now do we take ownership of the key.
        e.preventDefault();

        const step = 80;
        const pageFraction = 0.85;

        if (isHorizontal) {
          // Use "auto" (instant) so the page feels responsive to held arrow keys
          scrollTarget.scrollBy({ left: direction * step, behavior: "auto" });
        } else {
          const amount =
            e.key === "ArrowDown"
              ? step
              : e.key === "ArrowUp"
                ? -step
                : e.key === "PageDown"
                  ? window.innerHeight * pageFraction
                  : e.key === "PageUp"
                    ? -(window.innerHeight * pageFraction)
                    : e.key === "End"
                      ? 99999
                      : -99999; // Home
          scrollTarget.scrollBy({ top: amount, behavior: "auto" });
        }
        return;
      }

      // ── Escape handling (preserved exactly) ──────────────────────────────
      if (e.key !== "Escape") return;

      // If a page registered its own Esc handler (useEscapeBack), defer to it
      // entirely — including its own input/overlay guards — so we don't
      // accidentally blur an input or navigate before the page hook runs.
      if (hasActiveEscapeHandler()) return;

      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (isInput) {
        (target as HTMLInputElement).blur();
        return;
      }

      const hasOpenOverlay = document.querySelector(
        '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][data-radix-popper-content-wrapper], [data-state="open"][role="listbox"], [data-state="open"][role="menu"]',
      );
      if (hasOpenOverlay) return;

      e.preventDefault();
      handleGoBack();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleGoBack]);
}
