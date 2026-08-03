import { useEffect, useRef } from "react";
import {
  hashScreenFeedPixels,
  nextScreenFeedCaptureDelay,
  shouldUploadScreenFrame,
} from "./screen-feed-capture-policy";

// Polling remains as a fallback for browsers or proxies that cannot keep an
// event stream open. The live path normally detects a viewer immediately.
const POLL_INTERVAL_MS = 15000;
const LEGACY_CAPTURE_INTERVAL_MS = 3000;
const CAPTURE_TIMEOUT_MS = 4000;
const CLICK_RETAIN_MS = 8000;
const MAX_DATA_URL_LEN = 1_300_000;
const FAST_MAX_DATA_URL_LEN = 420_000;
const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 18;

const isDev = import.meta.env.DEV;

type Html2Canvas = typeof import("html2canvas")["default"];
let html2canvasPromise: Promise<Html2Canvas> | null = null;

async function loadHtml2Canvas(): Promise<Html2Canvas> {
  if (!html2canvasPromise) {
    html2canvasPromise = import("html2canvas")
      .then((module) => module.default)
      .catch((error) => {
        html2canvasPromise = null;
        throw error;
      });
  }
  return html2canvasPromise;
}

export interface ClickEvent {
  x: number;
  y: number;
  label: string;
  ts: number;
}

interface CaptureResult {
  uploaded: boolean;
  unchanged: boolean;
  failed: boolean;
  signature: string | null;
  latestClickTs: number;
}

const clickBuffer: ClickEvent[] = [];

function trimLabel(el: HTMLElement): string {
  const txt =
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    el.getAttribute("title") ||
    el.textContent?.trim() ||
    el.tagName.toLowerCase();
  return txt.slice(0, 60);
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "click",
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-screenfeed-ignore='true']")) return;
      clickBuffer.push({
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight,
        label: trimLabel(target),
        ts: Date.now(),
      });
      if (clickBuffer.length > 50) clickBuffer.shift();
    },
    { capture: true }
  );
}

function runWhenIdle(fn: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: 500 });
  } else {
    setTimeout(fn, 0);
  }
}

// GET-based trace bypasses CSRF and Origin checks and is development-only.
function trace(event: string, extra?: string): void {
  if (!isDev) return;
  const url = `/api/screen-feed/trace/${encodeURIComponent(event)}${extra ? `?d=${encodeURIComponent(extra)}` : ""}`;
  fetch(url, { credentials: "include" }).catch(() => {});
}

// Strip elements and CSS that reliably cause createPattern errors in
// html2canvas. This runs on the cloned document and never mutates the live UI.
function sanitizeClone(doc: Document): void {
  doc.querySelectorAll("img").forEach((el) => el.remove());
  doc.querySelectorAll("image").forEach((el) => el.remove());
  doc.querySelectorAll<HTMLElement>("*").forEach((el) => {
    try {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") el.style.backgroundImage = "none";
    } catch {
      // Cross-origin iframe: skip it.
    }
  });
}

const html2canvasBaseOpts = {
  scale: 0.7,
  useCORS: true,
  logging: false,
  foreignObjectRendering: false,
  imageTimeout: 200,
  onclone: (doc: Document) => sanitizeClone(doc),
  ignoreElements: (el: Element) => el.getAttribute("data-screenfeed-ignore") === "true",
} as const;

async function tryCapture(opts: Record<string, unknown>): Promise<HTMLCanvasElement> {
  const html2canvas = await loadHtml2Canvas();
  return Promise.race([
    html2canvas(document.body, {
      ...opts,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout-${CAPTURE_TIMEOUT_MS}ms`)), CAPTURE_TIMEOUT_MS)
    ),
  ]);
}

function buildFallbackCanvas(): HTMLCanvasElement {
  const width = 800;
  const height = 480;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const dark = document.documentElement.classList.contains("dark");

  ctx.fillStyle = dark ? "#1c1c1e" : "#f0f0f0";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = dark ? "#e5e5e5" : "#111";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText(document.title.slice(0, 70), 24, 48);
  ctx.fillStyle = dark ? "#aaa" : "#555";
  ctx.font = "14px monospace";
  ctx.fillText(window.location.href.slice(0, 90), 24, 80);
  ctx.fillStyle = "#888";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(new Date().toLocaleTimeString(), 24, 110);
  ctx.fillText("(html2canvas unavailable — simplified frame)", 24, 132);

  const headerEl = document.querySelector("header");
  if (headerEl) {
    ctx.fillStyle = dark ? "#2c2c2e" : "#ddd";
    ctx.fillRect(0, 160, width, 40);
    ctx.fillStyle = dark ? "#ccc" : "#333";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(headerEl.textContent?.trim().slice(0, 80) ?? "", 12, 186);
  }

  let y = 220;
  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    const text = el.textContent?.trim().slice(0, 80);
    if (text && y < height - 20) {
      ctx.fillStyle = dark ? "#ccc" : "#222";
      ctx.font = el.tagName === "H1" ? "bold 16px system-ui" : "14px system-ui, sans-serif";
      ctx.fillText(text, 24, y);
      y += 24;
    }
  });

  return canvas;
}

async function withSafeCreatePattern<T>(fn: () => Promise<T>): Promise<T> {
  const original = CanvasRenderingContext2D.prototype.createPattern;
  CanvasRenderingContext2D.prototype.createPattern = function (
    image: CanvasImageSource,
    repetition: string | null
  ): CanvasPattern | null {
    try {
      return original.call(this, image, repetition);
    } catch {
      return null;
    }
  };
  try {
    return await fn();
  } finally {
    CanvasRenderingContext2D.prototype.createPattern = original;
  }
}

function buildFrameSignature(canvas: HTMLCanvasElement): string {
  const sample = document.createElement("canvas");
  sample.width = SIGNATURE_WIDTH;
  sample.height = SIGNATURE_HEIGHT;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return `${canvas.width}x${canvas.height}`;
  ctx.drawImage(canvas, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  return hashScreenFeedPixels(ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data);
}

function resizeCanvas(source: HTMLCanvasElement, maxWidth: number): HTMLCanvasElement {
  if (source.width <= maxWidth) return source;
  const scale = maxWidth / source.width;
  const target = document.createElement("canvas");
  target.width = maxWidth;
  target.height = Math.max(1, Math.round(source.height * scale));
  const ctx = target.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, target.width, target.height);
  return target;
}

function encodeFastFrame(canvas: HTMLCanvasElement): string | null {
  const attempts = [
    { maxWidth: 1280, quality: 0.64 },
    { maxWidth: 1120, quality: 0.56 },
    { maxWidth: 960, quality: 0.48 },
    { maxWidth: 800, quality: 0.42 },
  ];

  let lastDataUrl = "";
  for (const attempt of attempts) {
    const candidate = resizeCanvas(canvas, attempt.maxWidth);
    lastDataUrl = candidate.toDataURL("image/jpeg", attempt.quality);
    if (lastDataUrl.length <= FAST_MAX_DATA_URL_LEN) return lastDataUrl;
  }

  return lastDataUrl.length <= MAX_DATA_URL_LEN ? lastDataUrl : null;
}

async function captureCanvas(): Promise<HTMLCanvasElement> {
  trace("capture-start");
  try {
    const canvas = await withSafeCreatePattern(() => tryCapture(html2canvasBaseOpts));
    trace("capture-ok");
    return canvas;
  } catch (error) {
    trace("capture-fail-p1", String(error).slice(0, 80));
    try {
      const canvas = await withSafeCreatePattern(() =>
        tryCapture({
          ...html2canvasBaseOpts,
          scale: 0.15,
          imageTimeout: 200,
        })
      );
      trace("capture-ok-retry");
      return canvas;
    } catch (retryError) {
      trace("capture-fail-p2", String(retryError).slice(0, 80));
      trace("capture-fallback");
      return buildFallbackCanvas();
    }
  }
}

async function captureAndUpload(
  fast: boolean,
  lastSignature: string | null,
  lastUploadedClickTs: number
): Promise<CaptureResult> {
  const canvas = await captureCanvas();
  const signature = buildFrameSignature(canvas);
  const cutoff = Date.now() - CLICK_RETAIN_MS;
  const clicks = clickBuffer.filter((click) => click.ts >= cutoff);
  const latestClickTs = clicks.reduce((latest, click) => Math.max(latest, click.ts), 0);

  if (
    !shouldUploadScreenFrame({
      signature,
      lastSignature,
      latestClickTs,
      lastUploadedClickTs,
    })
  ) {
    trace("unchanged");
    return { uploaded: false, unchanged: true, failed: false, signature, latestClickTs };
  }

  let dataUrl: string | null;
  try {
    dataUrl = fast ? encodeFastFrame(canvas) : canvas.toDataURL("image/jpeg", 0.75);
  } catch (error) {
    trace("to-data-url-failed", String(error).slice(0, 80));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }

  if (!dataUrl?.startsWith("data:image/")) {
    trace("bad-prefix");
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }
  if (dataUrl.length > MAX_DATA_URL_LEN) {
    trace("too-large", String(dataUrl.length));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }

  trace("uploading", String(dataUrl.length));
  try {
    const response = await fetch("/api/screen-feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ dataUrl, clicks }),
    });
    trace("upload-done", String(response.status));
    return {
      uploaded: response.ok,
      unchanged: false,
      failed: !response.ok,
      signature,
      latestClickTs,
    };
  } catch (error) {
    trace("upload-error", String(error).slice(0, 80));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }
}

export function useScreenFeed() {
  const busyRef = useRef(false);
  const watchedRef = useRef(false);
  const fastModeRef = useRef(false);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignatureRef = useRef<string | null>(null);
  const lastUploadedClickTsRef = useRef(0);
  const unchangedFramesRef = useRef(0);

  useEffect(() => {
    busyRef.current = false;
    trace("hook-mounted");

    const clearCaptureTimer = () => {
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    };

    const stopCapturing = () => {
      clearCaptureTimer();
      lastSignatureRef.current = null;
      lastUploadedClickTsRef.current = 0;
      unchangedFramesRef.current = 0;
    };

    const scheduleCapture = (delayMs: number) => {
      clearCaptureTimer();
      if (!watchedRef.current) return;
      captureTimerRef.current = setTimeout(runCaptureCycle, delayMs);
    };

    const runCaptureCycle = () => {
      captureTimerRef.current = null;
      if (!watchedRef.current || busyRef.current) return;
      busyRef.current = true;

      runWhenIdle(() => {
        captureAndUpload(
          fastModeRef.current,
          lastSignatureRef.current,
          lastUploadedClickTsRef.current
        )
          .then((result) => {
            if (result.uploaded) {
              lastSignatureRef.current = result.signature;
              lastUploadedClickTsRef.current = result.latestClickTs;
              unchangedFramesRef.current = 0;
            } else if (result.unchanged) {
              unchangedFramesRef.current += 1;
            }

            if (!watchedRef.current) return;
            const delay = fastModeRef.current
              ? nextScreenFeedCaptureDelay(unchangedFramesRef.current, result.failed)
              : LEGACY_CAPTURE_INTERVAL_MS;
            scheduleCapture(delay);
          })
          .finally(() => {
            busyRef.current = false;
          });
      });
    };

    const applyWatchStatus = (watched: boolean, fast: boolean) => {
      fastModeRef.current = fast;
      if (watched) {
        const wasWatched = watchedRef.current;
        watchedRef.current = true;
        if (!wasWatched && !busyRef.current) {
          trace("start-capturing");
          scheduleCapture(0);
        }
      } else if (watchedRef.current) {
        watchedRef.current = false;
        stopCapturing();
      }
    };

    const pollWatcherStatus = async () => {
      try {
        const response = await fetch("/api/screen-feed/being-watched", { credentials: "include" });
        if (!response.ok) {
          applyWatchStatus(false, false);
          return;
        }
        const data = await response.json();
        applyWatchStatus(Boolean(data?.watched), Boolean(data?.fast));
      } catch {
        applyWatchStatus(false, false);
      }
    };

    let pollId: ReturnType<typeof setInterval> | null = null;
    const stopFallbackPolling = () => {
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
    };
    const startFallbackPolling = () => {
      if (pollId) return;
      void pollWatcherStatus();
      pollId = setInterval(pollWatcherStatus, POLL_INTERVAL_MS);
    };

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/screen-feed/live/status", { withCredentials: true });
      eventSource.onopen = () => {
        trace("live-status-open");
        stopFallbackPolling();
      };
      eventSource.addEventListener("status", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data);
          applyWatchStatus(Boolean(data?.watched), Boolean(data?.fast));
        } catch {
          startFallbackPolling();
        }
      });
      eventSource.onerror = () => {
        trace("live-status-error");
        startFallbackPolling();
      };
    } catch {
      startFallbackPolling();
    }

    return () => {
      eventSource?.close();
      stopFallbackPolling();
      watchedRef.current = false;
      stopCapturing();
    };
  }, []);
}
