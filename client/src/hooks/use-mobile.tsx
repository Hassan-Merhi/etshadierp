import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const updateFromWidth = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    // Very old mobile/tablet browsers may not expose matchMedia. Keep a resize
    // fallback so the app shell still renders instead of crashing on startup.
    if (typeof window.matchMedia !== "function") {
      updateFromWidth();
      window.addEventListener("resize", updateFromWidth);
      return () => window.removeEventListener("resize", updateFromWidth);
    }

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    setIsMobile(mql.matches);

    // Modern browsers use addEventListener. Older Safari and tablet browsers
    // only implement the legacy addListener/removeListener API.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }

    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return !!isMobile;
}
