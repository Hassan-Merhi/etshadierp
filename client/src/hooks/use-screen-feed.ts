import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

const CAPTURE_INTERVAL_MS = 1500; // faster refresh
const CLICK_RETAIN_MS     = 8000; // keep clicks for 8 seconds

export interface ClickEvent {
  x:     number; // fraction of viewport width (0-1)
  y:     number; // fraction of viewport height (0-1)
  label: string; // text / tag of clicked element
  ts:    number; // epoch ms
}

// Shared click buffer — populated by the event listener, drained on each upload
const clickBuffer: ClickEvent[] = [];

function trimLabel(el: HTMLElement): string {
  const txt = el.getAttribute("aria-label")
    || el.getAttribute("placeholder")
    || el.getAttribute("title")
    || el.textContent?.trim()
    || el.tagName.toLowerCase();
  return txt.slice(0, 60);
}

// Attach click listener once (at module level so it survives hook unmounts)
if (typeof window !== "undefined") {
  window.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // Ignore clicks inside the Watch dialog itself
    if (target.closest("[data-screenfeed-ignore='true']")) return;
    clickBuffer.push({
      x:     e.clientX / window.innerWidth,
      y:     e.clientY / window.innerHeight,
      label: trimLabel(target),
      ts:    Date.now(),
    });
    // Cap buffer size
    if (clickBuffer.length > 50) clickBuffer.shift();
  }, { capture: true });
}

export function useScreenFeed() {
  const busyRef = useRef(false);

  useEffect(() => {
    const capture = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const canvas = await html2canvas(document.body, {
          scale:      0.5,
          useCORS:    true,
          logging:    false,
          allowTaint: true,
          ignoreElements: (el) =>
            el.getAttribute("data-screenfeed-ignore") === "true",
        });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.4);

        // Flush recent clicks (last CLICK_RETAIN_MS)
        const cutoff = Date.now() - CLICK_RETAIN_MS;
        const clicks = clickBuffer.filter(c => c.ts >= cutoff);

        fetch("/api/screen-feed", {
          method:      "POST",
          headers:     { "Content-Type": "application/json" },
          credentials: "include",
          body:        JSON.stringify({ dataUrl, clicks }),
        }).catch(() => {});
      } catch {
        // Silently ignore capture errors
      } finally {
        busyRef.current = false;
      }
    };

    const id = setInterval(capture, CAPTURE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
