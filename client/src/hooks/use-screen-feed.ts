import { useEffect, useRef } from "react";
import {
  hashScreenFeedPixels,
  nextScreenFeedCaptureDelay,
  shouldUploadScreenFrame,
} from "./screen-feed-capture-policy";
import {
  approximateDataUrlBytes,
  getScreenFeedCaptureScale,
  isSafeScreenFeedAssetUrl,
  normalizeScreenFeedPoint,
  shouldPreserveScreenFeedBackground,
} from "./screen-feed-viewing-quality";

// Polling remains as a fallback for browsers or proxies that cannot keep an
// event stream open. The live path normally detects a viewer immediately.
const POLL_INTERVAL_MS = 15000;
const LEGACY_CAPTURE_INTERVAL_MS = 3000;
const POINTER_INTERVAL_MS = 250;
const CAPTURE_TIMEOUT_MS = 4000;
const CLICK_RETAIN_MS = 8000;
const MAX_DATA_URL_LEN = 1_300_000;
const FAST_MAX_DATA_URL_LEN = 560_000;
const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 18;

const isDev = import.meta.env.DEV;

type Html2Canvas = (typeof import("html2canvas"))["default"];
type CaptureSource = "dom" | "retry" | "fallback";
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

interface CursorEvent {
  x: number;
  y: number;
  visible: boolean;
  ts: number;
}

interface EncodedFrame {
  dataUrl: string;
  canvas: HTMLCanvasElement;
  quality: number;
}

interface CaptureCanvasResult {
  canvas: HTMLCanvasElement;
  source: CaptureSource;
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
      const point = normalizeScreenFeedPoint(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
      clickBuffer.push({
        ...point,
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

function sanitizeClone(doc: Document): void {
  const origin = window.location.origin;

  doc.querySelectorAll<HTMLImageElement>("img").forEach((element) => {
    const src = element.currentSrc || element.getAttribute("src") || "";
    if (src && !isSafeScreenFeedAssetUrl(src, origin)) element.remove();
  });

  doc.querySelectorAll<SVGImageElement>("image").forEach((element) => {
    const href = element.getAttribute("href") || element.getAttribute("xlink:href") || "";
    if (href && !isSafeScreenFeedAssetUrl(href, origin)) element.remove();
  });

  doc.querySelectorAll<HTMLElement>("*").forEach((element) => {
    try {
      const backgroundImage = (doc.defaultView ?? window).getComputedStyle(element).backgroundImage;
      if (!shouldPreserveScreenFeedBackground(backgroundImage, origin)) {
        element.style.backgroundImage = "none";
      }
    } catch {
      element.style.backgroundImage = "none";
    }
  });
}

function buildHtml2CanvasOptions() {
  return {
    scale: getScreenFeedCaptureScale(window.devicePixelRatio),
    useCORS: true,
    allowTaint: false,
    logging: false,
    foreignObjectRendering: false,
    imageTimeout: 1200,
    onclone: (doc: Document) => sanitizeClone(doc),
    ignoreElements: (element: Element) => element.getAttribute("data-screenfeed-ignore") === "true",
  } as const;
}

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
  document.querySelectorAll("h1, h2, h3").forEach((element) => {
    const text = element.textContent?.trim().slice(0, 80);
    if (text && y < height - 20) {
      ctx.fillStyle = dark ? "#ccc" : "#222";
      ctx.font = element.tagName === "H1" ? "bold 16px system-ui" : "14px system-ui, sans-serif";
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, target.width, target.height);
  return target;
}

function encodeFastFrame(canvas: HTMLCanvasElement): EncodedFrame | null {
  const attempts = [
    { maxWidth: 1440, quality: 0.72 },
    { maxWidth: 1280, quality: 0.66 },
    { maxWidth: 1120, quality: 0.58 },
    { maxWidth: 960, quality: 0.5 },
    { maxWidth: 800, quality: 0.44 },
  ];

  let lastFrame: EncodedFrame | null = null;
  for (const attempt of attempts) {
    const candidate = resizeCanvas(canvas, attempt.maxWidth);
    const dataUrl = candidate.toDataURL("image/jpeg", attempt.quality);
    lastFrame = { dataUrl, canvas: candidate, quality: attempt.quality };
    if (dataUrl.length <= FAST_MAX_DATA_URL_LEN) return lastFrame;
  }

  return lastFrame && lastFrame.dataUrl.length <= MAX_DATA_URL_LEN ? lastFrame : null;
}

async function captureCanvas(): Promise<CaptureCanvasResult> {
  trace("capture-start");
  const options = buildHtml2CanvasOptions();
  try {
    const canvas = await withSafeCreatePattern(() => tryCapture(options));
    trace("capture-ok");
    return { canvas, source: "dom" };
  } catch (error) {
    trace("capture-fail-p1", String(error).slice(0, 80));
    try {
      const canvas = await withSafeCreatePattern(() =>
        tryCapture({
          ...options,
          scale: 0.35,
          imageTimeout: 300,
        })
      );
      trace("capture-ok-retry");
      return { canvas, source: "retry" };
    } catch (retryError) {
      trace("capture-fail-p2", String(retryError).slice(0, 80));
      trace("capture-fallback");
      return { canvas: buildFallbackCanvas(), source: "fallback" };
    }
  }
}

function buildViewportMetadata() {
  const documentElement = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight)),
    scrollX: Math.max(0, Math.round(window.scrollX)),
    scrollY: Math.max(0, Math.round(window.scrollY)),
    documentWidth: Math.max(documentElement.scrollWidth, body?.scrollWidth ?? 0, window.innerWidth),
    documentHeight: Math.max(documentElement.scrollHeight, body?.scrollHeight ?? 0, window.innerHeight),
    devicePixelRatio: Math.max(0.25, window.devicePixelRatio || 1),
    visualScale: Math.max(0.25, window.visualViewport?.scale ?? 1),
  };
}

async function captureAndUpload(
  fast: boolean,
  lastSignature: string | null,
  lastUploadedClickTs: number,
  cursor: CursorEvent | null
): Promise<CaptureResult> {
  const startedAt = Date.now();
  const { canvas, source } = await captureCanvas();
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

  let encoded: EncodedFrame | null;
  try {
    encoded = fast
      ? encodeFastFrame(canvas)
      : {
          dataUrl: canvas.toDataURL("image/jpeg", 0.75),
          canvas,
          quality: 0.75,
        };
  } catch (error) {
    trace("to-data-url-failed", String(error).slice(0, 80));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }

  if (!encoded?.dataUrl.startsWith("data:image/")) {
    trace("bad-prefix");
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }
  if (encoded.dataUrl.length > MAX_DATA_URL_LEN) {
    trace("too-large", String(encoded.dataUrl.length));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }

  trace("uploading", String(encoded.dataUrl.length));
  const completedAt = Date.now();
  try {
    const response = await fetch("/api/screen-feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        dataUrl: encoded.dataUrl,
        clicks,
        cursor,
        viewport: buildViewportMetadata(),
        clientCapturedAt: new Date(completedAt).toISOString(),
        capture: {
          width: encoded.canvas.width,
          height: encoded.canvas.height,
          source,
          quality: encoded.quality,
          encodedBytes: approximateDataUrlBytes(encoded.dataUrl),
          durationMs: completedAt - startedAt,
        },
      }),
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

function cursorsDiffer(previous: CursorEvent | null, next: CursorEvent): boolean {
  if (!previous) return true;
  return (
    previous.visible !== next.visible ||
    Math.abs(previous.x - next.x) > 0.002 ||
    Math.abs(previous.y - next.y) > 0.002 ||
    next.ts - previous.ts > 1000
  );
}

export function useScreenFeed() {
  const busyRef = useRef(false);
  const watchedRef = useRef(false);
  const fastModeRef = useRef(false);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointerRef = useRef<CursorEvent | null>(null);
  const lastSentPointerRef = useRef<CursorEvent | null>(null);
  const lastSignatureRef = useRef<string | null>(null);
  const lastUploadedClickTsRef = useRef(0);
  const unchangedFramesRef = useRef(0);

  useEffect(() => {
    busyRef.current = false;
    trace("hook-mounted");

    const onPointerMove = (event: PointerEvent) => {
      const point = normalizeScreenFeedPoint(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
      pointerRef.current = { ...point, visible: true, ts: Date.now() };
    };
    const onPointerLeave = () => {
      const previous = pointerRef.current ?? { x: 0, y: 0, visible: false, ts: Date.now() };
      pointerRef.current = { ...previous, visible: false, ts: Date.now() };
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave, { passive: true });

    const clearCaptureTimer = () => {
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    };

    const stopPointerLoop = () => {
      if (pointerTimerRef.current) {
        clearInterval(pointerTimerRef.current);
        pointerTimerRef.current = null;
      }
      lastSentPointerRef.current = null;
    };

    const sendPointerUpdate = () => {
      const cursor = pointerRef.current;
      if (!watchedRef.current || !cursor || !cursorsDiffer(lastSentPointerRef.current, cursor)) return;
      lastSentPointerRef.current = cursor;
      void fetch("/api/screen-feed/pointer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cursor }),
      }).catch(() => {
        lastSentPointerRef.current = null;
      });
    };

    const startPointerLoop = () => {
      if (pointerTimerRef.current) return;
      sendPointerUpdate();
      pointerTimerRef.current = setInterval(sendPointerUpdate, POINTER_INTERVAL_MS);
    };

    const stopCapturing = () => {
      clearCaptureTimer();
      stopPointerLoop();
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
          lastUploadedClickTsRef.current,
          pointerRef.current
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
        startPointerLoop();
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
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);
}
