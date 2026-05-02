import { useEffect, RefObject } from "react";

export function useButtonClickFeedback(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest(
        "button:not([disabled]), [role='button']:not([aria-disabled='true'])"
      ) as HTMLElement | null;
      if (!target) return;
      if (target.hasAttribute("data-no-flash")) return;

      target.classList.remove("btn-click-flash");
      void target.offsetWidth;
      target.classList.add("btn-click-flash");

      const cleanup = () => target.classList.remove("btn-click-flash");
      target.addEventListener("animationend", cleanup, { once: true });
    }

    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [containerRef]);
}
