import { useEffect, RefObject } from "react";

export function useButtonClickFeedback(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastHighlighted: HTMLElement | null = null;

    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest(
        "button:not([disabled]), [role='button']:not([aria-disabled='true'])"
      ) as HTMLElement | null;
      if (!target) return;
      if (target.hasAttribute("data-no-flash")) return;

      if (lastHighlighted && lastHighlighted !== target) {
        lastHighlighted.classList.remove("btn-click-flash");
      }
      target.classList.add("btn-click-flash");
      lastHighlighted = target;
    }

    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [containerRef]);
}
