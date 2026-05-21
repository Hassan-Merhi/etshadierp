import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

// How often to check if a Developer is watching us (cheap GET, no canvas)
const POLL_INTERVAL_MS    = 2000;
// How often to capture + upload a frame while being watched
const CAPTURE_INTERVAL_MS = 3000;
// Max time to wait for html2canvas before giving up on a frame.
// Two attempts × 4 s each = 8 s max, inside the 12 s watcher window.
const CAPTURE_TIMEOUT_MS  = 4000;
const CLICK_RETAIN_MS     = 8000;
// Max dataUrl size we'll bother uploading (~1.2 MB as a base64 string)
const MAX_DATA_URL_LEN    = 1_300_000;

const isDev = import.meta.env.DEV;

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
    (window as any).requestIdleCallback(fn, { timeout: 500 });
  } else {
    setTimeout(fn, 0);
  }
}

// GET-based trace: bypasses CSRF and Origin checks entirely.
// Gives us server-side visibility into what the watched user's browser is doing.
function trace(event: string, extra?: string) {
  if (!isDev) return;
  const url = `/api/screen-feed/trace/${encodeURIComponent(event)}${extra ? `?d=${encodeURIComponent(extra)}` : ""}`;
  fetch(url, { credentials: "include" }).catch(() => {});
}

// Strip elements and CSS that reliably cause "createPattern" errors in html2canvas.
// This runs on the cloned document (not the live page) so it's side-effect free.
function sanitizeClone(doc: Document) {
  // Remove <img> tags — they trigger createPattern when the src can't be
  // rendered as a canvas image in Replit's Chromium sandbox.
  doc.querySelectorAll("img").forEach(el => el.remove());
  // Remove SVG <image> elements for the same reason.
  doc.querySelectorAll("image").forEach(el => el.remove());
  // Strip background-image from every element to avoid pattern fills.
  doc.querySelectorAll<HTMLElement>("*").forEach(el => {
    try {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") el.style.backgroundImage = "none";
    } catch { /* cross-origin iframe — skip */ }
  });
}

const html2canvasBaseOpts = {
  scale:                  0.5,
  useCORS:                true,
  logging:                false,
  foreignObjectRendering: false,
  imageTimeout:           200,
  onclone:                (_doc: Document, _el: HTMLElement) => sanitizeClone(_doc),
  ignoreElements: (el: Element) =>
    el.getAttribute("data-screenfeed-ignore") === "true",
} as const;

async function tryCapture(opts: Record<string, any>): Promise<HTMLCanvasElement> {
  return Promise.race([
    html2canvas(document.body, {
      ...opts,
      x:            window.scrollX,
      y:            window.scrollY,
      width:        window.innerWidth,
      height:       window.innerHeight,
      scrollX:     -window.scrollX,
      scrollY:     -window.scrollY,
      windowWidth:  window.innerWidth,
      windowHeight: window.innerHeight,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout-${CAPTURE_TIMEOUT_MS}ms`)), CAPTURE_TIMEOUT_MS)
    ),
  ]);
}

/** Fallback: draw a simple text frame if html2canvas fails. Always succeeds. */
function buildFallbackCanvas(): HTMLCanvasElement {
  const W = 800, H = 480;
  const c   = document.createElement("canvas");
  c.width   = W;
  c.height  = H;
  const ctx = c.getContext("2d")!;
  const dark = document.documentElement.classList.contains("dark");

  ctx.fillStyle = dark ? "#1c1c1e" : "#f0f0f0";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = dark ? "#e5e5e5" : "#111";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText(document.title.slice(0, 70), 24, 48);

  ctx.fillStyle = dark ? "#aaa" : "#555";
  ctx.font = "14px monospace";
  ctx.fillText(window.location.href.slice(0, 90), 24, 80);

  ctx.fillStyle = dark ? "#888" : "#888";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(new Date().toLocaleTimeString(), 24, 110);
  ctx.fillText("(html2canvas unavailable — simplified frame)", 24, 132);

  // Rough header bar
  const headerEl = document.querySelector("header");
  if (headerEl) {
    ctx.fillStyle = dark ? "#2c2c2e" : "#ddd";
    ctx.fillRect(0, 160, W, 40);
    ctx.fillStyle = dark ? "#ccc" : "#333";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(headerEl.textContent?.trim().slice(0, 80) ?? "", 12, 186);
  }

  // List visible <h1>/<h2> text on page
  let y = 220;
  document.querySelectorAll("h1, h2, h3").forEach(el => {
    const t = el.textContent?.trim().slice(0, 80);
    if (t && y < H - 20) {
      ctx.fillStyle = dark ? "#ccc" : "#222";
      ctx.font = el.tagName === "H1" ? "bold 16px system-ui" : "14px system-ui, sans-serif";
      ctx.fillText(t, 24, y);
      y += 24;
    }
  });

  return c;
}

/**
 * Temporarily patch CanvasRenderingContext2D.createPattern so that the
 * "InvalidStateError: canvas element with a width or height of 0" that
 * html2canvas triggers in Replit's Chromium sandbox returns null instead
 * of throwing. html2canvas checks for null before applying the pattern,
 * so the render continues with a blank fill rather than crashing.
 * The original method is restored in the finally block.
 */
function withSafeCreatePattern<T>(fn: () => T): T {
  const orig = CanvasRenderingContext2D.prototype.createPattern;
  CanvasRenderingContext2D.prototype.createPattern = function (
    image: CanvasImageSource,
    repetition: string | null,
  ): CanvasPattern | null {
    try { return orig.call(this, image, repetition); } catch { return null; }
  };
  try {
    return fn();
  } finally {
    CanvasRenderingContext2D.prototype.createPattern = orig;
  }
}

async function captureAndUpload() {
  // Note: we intentionally do NOT skip on document.hidden.
  // html2canvas renders from the DOM (not the visual screen), so it works
  // even when the tab is in the background.
  trace("capture-start");

  let canvas: HTMLCanvasElement;
  try {
    canvas = await withSafeCreatePattern(() => tryCapture(html2canvasBaseOpts));
    trace("capture-ok");
  } catch (err) {
    trace("capture-fail-p1", String(err).slice(0, 80));
    // Retry once with very conservative settings
    try {
      canvas = await withSafeCreatePattern(() => tryCapture({
        ...html2canvasBaseOpts,
        scale:        0.15,
        imageTimeout: 200,
      }));
      trace("capture-ok-retry");
    } catch (err2) {
      trace("capture-fail-p2", String(err2).slice(0, 80));
      // Ultimate fallback: synthesise a simple text-based frame so the
      // Developer still gets *something* to see.
      canvas = buildFallbackCanvas();
      trace("capture-fallback");
    }
  }

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.75);
  } catch (err) {
    trace("to-data-url-failed", String(err).slice(0, 80));
    return;
  }

  if (!dataUrl.startsWith("data:image/")) {
    trace("bad-prefix");
    return;
  }
  if (dataUrl.length > MAX_DATA_URL_LEN) {
    trace("too-large", String(dataUrl.length));
    return;
  }

  trace("uploading", String(dataUrl.length));

  const cutoff  = Date.now() - CLICK_RETAIN_MS;
  const clicks  = clickBuffer.filter(c => c.ts >= cutoff);

  try {
    const res = await fetch("/api/screen-feed", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ dataUrl, clicks }),
    });
    trace("upload-done", String(res.status));
  } catch (err) {
    trace("upload-error", String(err).slice(0, 80));
  }
}

export function useScreenFeed() {
  const busyRef      = useRef(false);
  const watchedRef   = useRef(false);
  const captureRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Reset busyRef in case HMR fired mid-capture and left it stuck at true.
    busyRef.current = false;
    trace("hook-mounted");

    const startCapturing = () => {
      if (captureRef.current) return;
      trace("start-capturing");

      if (!busyRef.current) {
        busyRef.current = true;
        runWhenIdle(() => {
          captureAndUpload().finally(() => { busyRef.current = false; });
        });
      }

      captureRef.current = setInterval(() => {
        if (busyRef.current) return;
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
          if (watchedRef.current) {
            watchedRef.current = false;
            stopCapturing();
          }
          return;
        }
        const data = await res.json();
        const nowWatched = Boolean(data?.watched);

        if (nowWatched) {
          // Always attempt startCapturing — it's a no-op if already running.
          // This handles the case where watchedRef is true (e.g. after HMR) but
          // captureRef was cleared by the effect cleanup, causing the capture
          // loop to be silently stopped while still being watched.
          watchedRef.current = true;
          startCapturing();
        } else if (watchedRef.current) {
          watchedRef.current = false;
          stopCapturing();
        }
      } catch {
        if (watchedRef.current) {
          watchedRef.current = false;
          stopCapturing();
        }
      }
    };

    pollWatcherStatus();
    const pollId = setInterval(pollWatcherStatus, POLL_INTERVAL_MS);

    return () => {
      clearInterval(pollId);
      stopCapturing();
    };
  }, []);
}
