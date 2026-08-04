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

const POLL_INTERVAL_MS = 15000;
const LEGACY_CAPTURE_INTERVAL_MS = 3000;
const POINTER_INTERVAL_MS = 250;
const CAPTURE_TIMEOUT_MS = 12000;
const RETRY_CAPTURE_TIMEOUT_MS = 7000;
const CLICK_RETAIN_MS = 8000;
const MAX_DATA_URL_LEN = 1_300_000;
const FAST_MAX_DATA_URL_LEN = 560_000;
const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 18;
const UNSUPPORTED_COLOR_FUNCTION_RE = /\b(?:color|color-mix|lab|lch|oklab|oklch)\(/i;

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
  failureReason?: string;
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
      clickBuffer.push({ ...point, label: trimLabel(target), ts: Date.now() });
      if (clickBuffer.length > 50) clickBuffer.shift();
    },
    { capture: true }
  );
}

function runWhenIdle(fn: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: 750 });
  } else {
    setTimeout(fn, 0);
  }
}

function trace(event: string, extra?: string): void {
  if (!isDev) return;
  const url = `/api/screen-feed/trace/${encodeURIComponent(event)}${extra ? `?d=${encodeURIComponent(extra)}` : ""}`;
  fetch(url, { credentials: "include" }).catch(() => {});
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
}

async function waitForCaptureReady(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  try {
    await Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Font readiness must never block capture.
  }
}

function copyLiveFormState(doc: Document): void {
  const originals = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
  const clones = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));

  originals.forEach((original, index) => {
    const clone = clones[index];
    if (!clone) return;
    if (original instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      clone.value = original.value;
      clone.checked = original.checked;
      clone.setAttribute("value", original.value);
      if (original.checked) clone.setAttribute("checked", "checked");
      else clone.removeAttribute("checked");
    } else if (original instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
      clone.value = original.value;
      clone.textContent = original.value;
    } else if (original instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
      clone.value = original.value;
      Array.from(clone.options).forEach((option, optionIndex) => {
        option.selected = original.options[optionIndex]?.selected ?? false;
      });
    }
  });

  const editableOriginals = Array.from(document.querySelectorAll<HTMLElement>("[contenteditable='true']"));
  const editableClones = Array.from(doc.querySelectorAll<HTMLElement>("[contenteditable='true']"));
  editableOriginals.forEach((original, index) => {
    if (editableClones[index]) editableClones[index].innerHTML = original.innerHTML;
  });
}

function copyScrollablePositions(doc: Document): void {
  const originals = Array.from(document.querySelectorAll<HTMLElement>("*"));
  const clones = Array.from(doc.querySelectorAll<HTMLElement>("*"));
  originals.forEach((original, index) => {
    const clone = clones[index];
    if (!clone || (original.scrollTop === 0 && original.scrollLeft === 0)) return;
    clone.scrollTop = original.scrollTop;
    clone.scrollLeft = original.scrollLeft;
  });
}

function createCssColorNormalizer(doc: Document): (value: string, fallback: string) => string {
  const canvas = doc.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, string>();

  return (value: string, fallback: string): string => {
    const key = `${value}\u0000${fallback}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (!context) return fallback;

    try {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = fallback;
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alphaByte] = context.getImageData(0, 0, 1, 1).data;
      const alpha = Math.round((alphaByte / 255) * 1000) / 1000;
      const normalized =
        alpha >= 1
          ? `rgb(${red}, ${green}, ${blue})`
          : `rgba(${red}, ${green}, ${blue}, ${alpha})`;
      cache.set(key, normalized);
      return normalized;
    } catch {
      cache.set(key, fallback);
      return fallback;
    }
  };
}

function sanitizeComputedStyle(
  element: HTMLElement,
  computed: CSSStyleDeclaration,
  origin: string,
  normalizeColor: (value: string, fallback: string) => string,
): void {
  const backgroundImage = computed.backgroundImage;
  if (
    !shouldPreserveScreenFeedBackground(backgroundImage, origin) ||
    UNSUPPORTED_COLOR_FUNCTION_RE.test(backgroundImage)
  ) {
    element.style.backgroundImage = "none";
  }

  element.style.color = normalizeColor(computed.color, "rgb(0, 0, 0)");
  element.style.backgroundColor = normalizeColor(computed.backgroundColor, "rgba(0, 0, 0, 0)");
  element.style.borderTopColor = normalizeColor(computed.borderTopColor, "rgba(0, 0, 0, 0)");
  element.style.borderRightColor = normalizeColor(computed.borderRightColor, "rgba(0, 0, 0, 0)");
  element.style.borderBottomColor = normalizeColor(computed.borderBottomColor, "rgba(0, 0, 0, 0)");
  element.style.borderLeftColor = normalizeColor(computed.borderLeftColor, "rgba(0, 0, 0, 0)");
  element.style.outlineColor = normalizeColor(computed.outlineColor, "rgba(0, 0, 0, 0)");
  element.style.textDecorationColor = normalizeColor(computed.textDecorationColor, computed.color);
  element.style.caretColor = "transparent";

  if (computed.boxShadow !== "none" && UNSUPPORTED_COLOR_FUNCTION_RE.test(computed.boxShadow)) {
    element.style.boxShadow = "none";
  }
  if (computed.textShadow !== "none" && UNSUPPORTED_COLOR_FUNCTION_RE.test(computed.textShadow)) {
    element.style.textShadow = "none";
  }
  if (computed.borderImageSource !== "none" && UNSUPPORTED_COLOR_FUNCTION_RE.test(computed.borderImageSource)) {
    element.style.borderImageSource = "none";
  }
  if (computed.filter !== "none") element.style.filter = "none";
  if (computed.backdropFilter !== "none") element.style.backdropFilter = "none";
  if (computed.mixBlendMode !== "normal") element.style.mixBlendMode = "normal";
}

function sanitizeClone(doc: Document): void {
  const origin = window.location.origin;
  const view = doc.defaultView ?? window;
  const normalizeColor = createCssColorNormalizer(doc);
  copyLiveFormState(doc);
  copyScrollablePositions(doc);

  const captureOverrides = doc.createElement("style");
  captureOverrides.setAttribute("data-screenfeed-capture-styles", "true");
  captureOverrides.textContent = `
    *::before,
    *::after {
      color: inherit !important;
      background-color: transparent !important;
      background-image: none !important;
      border-color: currentColor !important;
      box-shadow: none !important;
      text-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
    }
  `;
  doc.head.appendChild(captureOverrides);

  doc.querySelectorAll<HTMLImageElement>("img").forEach((element) => {
    const src = element.currentSrc || element.getAttribute("src") || "";
    if (src && !isSafeScreenFeedAssetUrl(src, origin)) {
      element.removeAttribute("src");
      element.removeAttribute("srcset");
      element.style.visibility = "hidden";
    }
  });

  doc.querySelectorAll<SVGImageElement>("image").forEach((element) => {
    const href = element.getAttribute("href") || element.getAttribute("xlink:href") || "";
    if (href && !isSafeScreenFeedAssetUrl(href, origin)) element.remove();
  });

  doc.querySelectorAll<HTMLElement>("*").forEach((element) => {
    try {
      sanitizeComputedStyle(element, view.getComputedStyle(element), origin, normalizeColor);
    } catch {
      element.style.backgroundImage = "none";
      element.style.filter = "none";
      element.style.backdropFilter = "none";
      element.style.boxShadow = "none";
      element.style.textShadow = "none";
    }
  });

  doc.querySelectorAll<SVGElement>("svg, svg *").forEach((element) => {
    try {
      const computed = view.getComputedStyle(element);
      element.style.setProperty("color", normalizeColor(computed.color, "rgb(0, 0, 0)"));
      element.style.setProperty("fill", normalizeColor(computed.fill, "rgba(0, 0, 0, 0)"));
      element.style.setProperty("stroke", normalizeColor(computed.stroke, "rgba(0, 0, 0, 0)"));
      element.style.setProperty("filter", "none");
    } catch {
      element.style.setProperty("filter", "none");
    }
  });
}

function buildHtml2CanvasOptions() {
  return {
    scale: getScreenFeedCaptureScale(window.devicePixelRatio),
    useCORS: true,
    allowTaint: false,
    logging: false,
    foreignObjectRendering: true,
    imageTimeout: 2500,
    removeContainer: true,
    onclone: (doc: Document) => sanitizeClone(doc),
    ignoreElements: (element: Element) => element.getAttribute("data-screenfeed-ignore") === "true",
  } as const;
}

async function tryCapture(opts: Record<string, unknown>, timeoutMs: number): Promise<HTMLCanvasElement> {
  const html2canvas = await loadHtml2Canvas();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
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
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`timeout-${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function buildFallbackCanvas(reason: string): HTMLCanvasElement {
  const width = Math.max(800, Math.min(1440, window.innerWidth));
  const height = Math.max(480, Math.round(width * (window.innerHeight / Math.max(1, window.innerWidth))));
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
  ctx.fillText(document.title.slice(0, 90), 24, 48);
  ctx.fillStyle = dark ? "#aaa" : "#555";
  ctx.font = "14px monospace";
  ctx.fillText(window.location.href.slice(0, 120), 24, 80);
  ctx.fillStyle = "#888";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(new Date().toLocaleTimeString(), 24, 110);
  ctx.fillText(`Capture fallback: ${reason.slice(0, 120)}`, 24, 132);

  let y = 170;
  document.querySelectorAll<HTMLElement>("header, nav, h1, h2, h3, button, [role='dialog']").forEach((element) => {
    const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!text || y > height - 24) return;
    ctx.fillStyle = dark ? "#ccc" : "#222";
    ctx.font = element.matches("h1, h2, h3") ? "bold 15px system-ui" : "13px system-ui, sans-serif";
    ctx.fillText(text, 24, y);
    y += 22;
  });

  return canvas;
}

async function withSafeCreatePattern<T>(fn: () => Promise<T>): Promise<T> {
  const original = CanvasRenderingContext2D.prototype.createPattern;
  CanvasRenderingContext2D.prototype.createPattern = function (image: CanvasImageSource, repetition: string | null): CanvasPattern | null {
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
  await waitForCaptureReady();
  const options = buildHtml2CanvasOptions();
  try {
    const canvas = await withSafeCreatePattern(() => tryCapture(options, CAPTURE_TIMEOUT_MS));
    trace("capture-ok");
    return { canvas, source: "dom" };
  } catch (error) {
    const firstReason = errorMessage(error);
    trace("capture-fail-p1", firstReason);
    try {
      const canvas = await withSafeCreatePattern(() =>
        tryCapture(
          {
            ...options,
            scale: 0.5,
            imageTimeout: 800,
            foreignObjectRendering: false,
          },
          RETRY_CAPTURE_TIMEOUT_MS,
        )
      );
      trace("capture-ok-retry");
      return { canvas, source: "retry", failureReason: firstReason };
    } catch (retryError) {
      const reason = `${firstReason}; retry: ${errorMessage(retryError)}`;
      trace("capture-fallback", reason);
      return { canvas: buildFallbackCanvas(reason), source: "fallback", failureReason: reason };
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
  cursor: CursorEvent | null,
  expectedPath: string
): Promise<CaptureResult> {
  const startedAt = Date.now();
  const { canvas, source, failureReason } = await captureCanvas();
  if (window.location.href !== expectedPath) {
    trace("capture-discarded-navigation");
    return { uploaded: false, unchanged: false, failed: false, signature: null, latestClickTs: lastUploadedClickTs };
  }
  const signature = buildFrameSignature(canvas);
  const cutoff = Date.now() - CLICK_RETAIN_MS;
  const clicks = clickBuffer.filter((click) => click.ts >= cutoff);
  const latestClickTs = clicks.reduce((latest, click) => Math.max(latest, click.ts), 0);

  if (!shouldUploadScreenFrame({ signature, lastSignature, latestClickTs, lastUploadedClickTs })) {
    return { uploaded: false, unchanged: true, failed: false, signature, latestClickTs };
  }

  let encoded: EncodedFrame | null;
  try {
    encoded = fast ? encodeFastFrame(canvas) : { dataUrl: canvas.toDataURL("image/jpeg", 0.75), canvas, quality: 0.75 };
  } catch (error) {
    trace("to-data-url-failed", errorMessage(error));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }

  if (!encoded?.dataUrl.startsWith("data:image/") || encoded.dataUrl.length > MAX_DATA_URL_LEN) {
    trace("encode-invalid", String(encoded?.dataUrl.length ?? 0));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }

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
          failureReason,
        },
      }),
    });
    return { uploaded: response.ok, unchanged: false, failed: !response.ok, signature, latestClickTs };
  } catch (error) {
    trace("upload-error", errorMessage(error));
    return { uploaded: false, unchanged: false, failed: true, signature, latestClickTs };
  }
}

function cursorsDiffer(previous: CursorEvent | null, next: CursorEvent): boolean {
  if (!previous) return true;
  return previous.visible !== next.visible || Math.abs(previous.x - next.x) > 0.002 || Math.abs(previous.y - next.y) > 0.002 || next.ts - previous.ts > 1000;
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
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    };
    const stopPointerLoop = () => {
      if (pointerTimerRef.current) clearInterval(pointerTimerRef.current);
      pointerTimerRef.current = null;
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
      }).catch(() => { lastSentPointerRef.current = null; });
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
      if (watchedRef.current) captureTimerRef.current = setTimeout(runCaptureCycle, delayMs);
    };
    const runCaptureCycle = () => {
      captureTimerRef.current = null;
      if (!watchedRef.current || busyRef.current) return;
      busyRef.current = true;
      const expectedPath = window.location.href;
      runWhenIdle(() => {
        captureAndUpload(fastModeRef.current, lastSignatureRef.current, lastUploadedClickTsRef.current, pointerRef.current, expectedPath)
          .then((result) => {
            if (result.uploaded) {
              lastSignatureRef.current = result.signature;
              lastUploadedClickTsRef.current = result.latestClickTs;
              unchangedFramesRef.current = 0;
            } else if (result.unchanged) {
              unchangedFramesRef.current += 1;
            }
            if (!watchedRef.current) return;
            const delay = fastModeRef.current ? nextScreenFeedCaptureDelay(unchangedFramesRef.current, result.failed) : LEGACY_CAPTURE_INTERVAL_MS;
            scheduleCapture(delay);
          })
          .finally(() => { busyRef.current = false; });
      });
    };
    const applyWatchStatus = (watched: boolean, fast: boolean) => {
      fastModeRef.current = fast;
      if (watched) {
        const wasWatched = watchedRef.current;
        watchedRef.current = true;
        startPointerLoop();
        if (!wasWatched && !busyRef.current) scheduleCapture(0);
      } else if (watchedRef.current) {
        watchedRef.current = false;
        stopCapturing();
      }
    };
    const pollWatcherStatus = async () => {
      try {
        const response = await fetch("/api/screen-feed/being-watched", { credentials: "include" });
        if (!response.ok) return applyWatchStatus(false, false);
        const data = await response.json();
        applyWatchStatus(Boolean(data?.watched), Boolean(data?.fast));
      } catch {
        applyWatchStatus(false, false);
      }
    };

    let pollId: ReturnType<typeof setInterval> | null = null;
    const stopFallbackPolling = () => {
      if (pollId) clearInterval(pollId);
      pollId = null;
    };
    const startFallbackPolling = () => {
      if (pollId) return;
      void pollWatcherStatus();
      pollId = setInterval(pollWatcherStatus, POLL_INTERVAL_MS);
    };

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/screen-feed/live/status", { withCredentials: true });
      eventSource.onopen = stopFallbackPolling;
      eventSource.addEventListener("status", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data);
          applyWatchStatus(Boolean(data?.watched), Boolean(data?.fast));
        } catch {
          startFallbackPolling();
        }
      });
      eventSource.onerror = startFallbackPolling;
    } catch {
      startFallbackPolling();
    }

    const onNavigation = () => {
      lastSignatureRef.current = null;
      if (watchedRef.current && !busyRef.current) scheduleCapture(0);
    };
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);

    return () => {
      eventSource?.close();
      stopFallbackPolling();
      watchedRef.current = false;
      stopCapturing();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("popstate", onNavigation);
      window.removeEventListener("hashchange", onNavigation);
    };
  }, []);
}
