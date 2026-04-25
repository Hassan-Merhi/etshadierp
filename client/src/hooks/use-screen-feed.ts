import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

const CAPTURE_INTERVAL_MS = 2000;
const CAPTURE_TIMEOUT_MS  = 8000;
const CLICK_RETAIN_MS     = 8000;

export interface ClickEvent {
  x:     number;
  y:     number;
  label: string;
  ts:    number;
}

const clickBuffer: ClickEvent[] = [];

function trimLabel(el: HTMLElement): string {
  const txt = el.getAttribute("aria-label")
    || el.getAttribute("placeholder")
    || el.getAttribute("title")
    || el.textContent?.trim()
    || el.tagName.toLowerCase();
  return txt.slice(0, 60);
}

if (typeof window !== "undefined") {
  window.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-screenfeed-ignore='true']")) return;
    clickBuffer.push({
      x:     e.clientX / window.innerWidth,
      y:     e.clientY / window.innerHeight,
      label: trimLabel(target),
      ts:    Date.now(),
    });
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
        // Capture only the visible viewport using SVG-based rendering (much faster)
        const canvas = await Promise.race([
          html2canvas(document.body, {
            scale:                 0.35,   // lower scale = faster + smaller payload
            useCORS:               true,
            logging:               false,
            allowTaint:            true,
            foreignObjectRendering: true,  // SVG path: dramatically faster for complex UIs
            x:           window.scrollX,
            y:           window.scrollY,
            width:       window.innerWidth,
            height:      window.innerHeight,
            scrollX:    -window.scrollX,
            scrollY:    -window.scrollY,
            windowWidth:  window.innerWidth,
            windowHeight: window.innerHeight,
            imageTimeout: 500,            // don't wait long for images
            ignoreElements: (el) =>
              el.getAttribute("data-screenfeed-ignore") === "true",
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), CAPTURE_TIMEOUT_MS)
          ),
        ]);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.45);
        const cutoff  = Date.now() - CLICK_RETAIN_MS;
        const clicks  = clickBuffer.filter(c => c.ts >= cutoff);

        fetch("/api/screen-feed", {
          method:      "POST",
          headers:     { "Content-Type": "application/json" },
          credentials: "include",
          body:        JSON.stringify({ dataUrl, clicks }),
        }).catch(() => {});
      } catch {
        // Capture failed or timed out — reset and retry next interval
      } finally {
        busyRef.current = false;
      }
    };

    // Delay the first capture by 2 seconds to let the page fully settle
    const firstTimer = setTimeout(capture, 2000);
    const id = setInterval(capture, CAPTURE_INTERVAL_MS);
    return () => { clearTimeout(firstTimer); clearInterval(id); };
  }, []);
}
