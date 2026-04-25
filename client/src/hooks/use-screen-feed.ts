import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

// How often to check if a Developer is watching us (cheap GET, no canvas)
const POLL_INTERVAL_MS    = 3000;
// How often to capture + upload a frame while being watched
const CAPTURE_INTERVAL_MS = 2000;
// Max time to wait for html2canvas before giving up
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

async function captureAndUpload() {
  try {
    const canvas = await Promise.race([
      html2canvas(document.body, {
        scale:                  0.35,
        useCORS:                true,
        logging:                false,
        allowTaint:             true,
        foreignObjectRendering: true,
        x:           window.scrollX,
        y:           window.scrollY,
        width:       window.innerWidth,
        height:      window.innerHeight,
        scrollX:    -window.scrollX,
        scrollY:    -window.scrollY,
        windowWidth:  window.innerWidth,
        windowHeight: window.innerHeight,
        imageTimeout: 500,
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
    // html2canvas timed out or failed — silently skip
  }
}

export function useScreenFeed() {
  const busyRef    = useRef(false);
  const watchedRef = useRef(false);
  const captureRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startCapturing = () => {
      if (captureRef.current) return; // already running
      // Capture immediately, then on interval
      if (!busyRef.current) {
        busyRef.current = true;
        captureAndUpload().finally(() => { busyRef.current = false; });
      }
      captureRef.current = setInterval(async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        await captureAndUpload().finally(() => { busyRef.current = false; });
      }, CAPTURE_INTERVAL_MS);
    };

    const stopCapturing = () => {
      if (captureRef.current) {
        clearInterval(captureRef.current);
        captureRef.current = null;
      }
    };

    const pollWatcherStatus = async () => {
      try {
        const res  = await fetch("/api/screen-feed/being-watched", { credentials: "include" });
        const data = await res.json();
        const nowWatched = Boolean(data?.watched);

        if (nowWatched && !watchedRef.current) {
          watchedRef.current = true;
          startCapturing();
        } else if (!nowWatched && watchedRef.current) {
          watchedRef.current = false;
          stopCapturing();
        }
      } catch {
        // Network error — stop capturing if was running
        if (watchedRef.current) {
          watchedRef.current = false;
          stopCapturing();
        }
      }
    };

    // Check immediately, then every POLL_INTERVAL_MS
    pollWatcherStatus();
    const pollId = setInterval(pollWatcherStatus, POLL_INTERVAL_MS);

    return () => {
      clearInterval(pollId);
      stopCapturing();
    };
  }, []);
}
