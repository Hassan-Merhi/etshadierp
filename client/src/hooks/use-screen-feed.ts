import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

// How often to check if a Developer is watching us (cheap GET, no canvas)
const POLL_INTERVAL_MS    = 2000;
// How often to capture + upload a frame while being watched
const CAPTURE_INTERVAL_MS = 4000;
// Max time to wait for html2canvas before giving up on a frame
const CAPTURE_TIMEOUT_MS  = 6000;
const CLICK_RETAIN_MS     = 8000;
// Max dataUrl size we'll bother uploading (~1.2 MB as a base64 string)
const MAX_DATA_URL_LEN    = 1_300_000;

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

function runWhenIdle(fn: () => void): void {
  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

const html2canvasBaseOpts = {
  scale:                  0.3,
  useCORS:                true,
  logging:                false,
  allowTaint:             true,
  foreignObjectRendering: false,
  imageTimeout:           500,
  ignoreElements: (el: Element) =>
    el.getAttribute("data-screenfeed-ignore") === "true",
} as const;

async function tryCapture(opts: Record<string, any>): Promise<HTMLCanvasElement> {
  return Promise.race([
    html2canvas(document.body, {
      ...opts,
      x:           window.scrollX,
      y:           window.scrollY,
      width:       window.innerWidth,
      height:      window.innerHeight,
      scrollX:    -window.scrollX,
      scrollY:    -window.scrollY,
      windowWidth:  window.innerWidth,
      windowHeight: window.innerHeight,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), CAPTURE_TIMEOUT_MS)
    ),
  ]);
}

async function captureAndUpload() {
  // Skip if page is hidden (background tab / minimised)
  if (document.hidden) return;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await tryCapture(html2canvasBaseOpts);
  } catch {
    // Retry once with the most conservative settings possible
    try {
      canvas = await tryCapture({
        ...html2canvasBaseOpts,
        scale:       0.2,
        imageTimeout: 200,
      });
    } catch {
      // Both attempts failed — silently skip this frame
      return;
    }
  }

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.4);
  } catch {
    return;
  }

  if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_DATA_URL_LEN) return;

  const cutoff  = Date.now() - CLICK_RETAIN_MS;
  const clicks  = clickBuffer.filter(c => c.ts >= cutoff);

  fetch("/api/screen-feed", {
    method:      "POST",
    headers:     { "Content-Type": "application/json" },
    credentials: "include",
    body:        JSON.stringify({ dataUrl, clicks }),
  }).catch(() => {});
}

export function useScreenFeed() {
  const busyRef      = useRef(false);
  const watchedRef   = useRef(false);
  const captureRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startCapturing = () => {
      if (captureRef.current) return; // already running

      // Trigger one immediate capture via idle callback
      if (!busyRef.current) {
        busyRef.current = true;
        runWhenIdle(() => {
          captureAndUpload().finally(() => { busyRef.current = false; });
        });
      }

      captureRef.current = setInterval(() => {
        if (busyRef.current || document.hidden) return;
        busyRef.current = true;
        runWhenIdle(() => {
          captureAndUpload().finally(() => { busyRef.current = false; });
        });
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
        if (!res.ok) {
          // Session expired or other auth error — stop capturing to avoid ghost uploads
          if (watchedRef.current) {
            watchedRef.current = false;
            stopCapturing();
          }
          return;
        }
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

    // Handle tab visibility: resume capture if we come back to foreground while watched
    const onVisibilityChange = () => {
      if (!document.hidden && watchedRef.current && !captureRef.current) {
        startCapturing();
      } else if (document.hidden && captureRef.current) {
        // Pause the capture interval while hidden (poll still runs)
        stopCapturing();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Check immediately, then on interval
    pollWatcherStatus();
    const pollId = setInterval(pollWatcherStatus, POLL_INTERVAL_MS);

    return () => {
      clearInterval(pollId);
      stopCapturing();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}
