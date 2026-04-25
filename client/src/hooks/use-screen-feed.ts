import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

const CAPTURE_INTERVAL_MS = 1500;
const CAPTURE_TIMEOUT_MS  = 4000; // abort if html2canvas hangs
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
        // Race html2canvas against a timeout so it can't hang indefinitely
        const canvas = await Promise.race([
          html2canvas(document.body, {
            scale:      0.5,
            useCORS:    true,
            logging:    false,
            allowTaint: true,
            ignoreElements: (el) =>
              el.getAttribute("data-screenfeed-ignore") === "true",
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("html2canvas timeout")), CAPTURE_TIMEOUT_MS)
          ),
        ]);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.4);
        const cutoff  = Date.now() - CLICK_RETAIN_MS;
        const clicks  = clickBuffer.filter(c => c.ts >= cutoff);

        fetch("/api/screen-feed", {
          method:      "POST",
          headers:     { "Content-Type": "application/json" },
          credentials: "include",
          body:        JSON.stringify({ dataUrl, clicks }),
        }).catch(() => {});
      } catch {
        // html2canvas failed or timed out — try again next interval
      } finally {
        busyRef.current = false;
      }
    };

    const id = setInterval(capture, CAPTURE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
