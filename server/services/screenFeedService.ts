import type { ScreenFeedCaptureInfo, ScreenFeedCursor, ScreenFeedViewport } from "../screenFeedStore";

export interface ScreenFeedClick {
  x: number;
  y: number;
  label?: string;
  ts: number;
}

const MAX_CLICK_AGE_MS = 8_000;
const MAX_CLICKS_PER_FRAME = 50;
const MAX_POINTER_AGE_MS = 30_000;
const MAX_VIEWPORT_DIMENSION = 20_000;
const MAX_CAPTURE_DIMENSION = 8_000;
const MAX_CAPTURE_DURATION_MS = 30_000;
const MAX_ENCODED_BYTES = 1_500_000;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  const number = finiteNumber(value);
  if (number === null || number < minimum || number > maximum) return null;
  return number;
}

function normalizedCoordinate(value: unknown): number | null {
  return boundedNumber(value, 0, 1);
}

export function isValidScreenFeedDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

export function sanitizeScreenFeedClicks(value: unknown, now = Date.now()): ScreenFeedClick[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (click): click is ScreenFeedClick =>
        !!click &&
        normalizedCoordinate(click.x) !== null &&
        normalizedCoordinate(click.y) !== null &&
        typeof click.ts === "number" &&
        Number.isFinite(click.ts) &&
        now - click.ts < MAX_CLICK_AGE_MS
    )
    .slice(-MAX_CLICKS_PER_FRAME)
    .map((click) => ({
      x: Math.min(1, Math.max(0, click.x)),
      y: Math.min(1, Math.max(0, click.y)),
      ...(typeof click.label === "string" ? { label: click.label.slice(0, 60) } : {}),
      ts: click.ts,
    }));
}

export function sanitizeScreenFeedCursor(value: unknown, now = Date.now()): ScreenFeedCursor | null {
  if (!value || typeof value !== "object") return null;
  const cursor = value as Record<string, unknown>;
  const x = normalizedCoordinate(cursor.x);
  const y = normalizedCoordinate(cursor.y);
  const ts = finiteNumber(cursor.ts);
  if (x === null || y === null || ts === null || now - ts > MAX_POINTER_AGE_MS) return null;

  return {
    x,
    y,
    ts,
    visible: cursor.visible !== false,
  };
}

export function sanitizeScreenFeedViewport(value: unknown): ScreenFeedViewport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const viewport = value as Record<string, unknown>;
  const width = boundedNumber(viewport.width, 1, MAX_VIEWPORT_DIMENSION);
  const height = boundedNumber(viewport.height, 1, MAX_VIEWPORT_DIMENSION);
  const scrollX = boundedNumber(viewport.scrollX, 0, MAX_VIEWPORT_DIMENSION * 10);
  const scrollY = boundedNumber(viewport.scrollY, 0, MAX_VIEWPORT_DIMENSION * 10);
  const documentWidth = boundedNumber(viewport.documentWidth, 1, MAX_VIEWPORT_DIMENSION * 10);
  const documentHeight = boundedNumber(viewport.documentHeight, 1, MAX_VIEWPORT_DIMENSION * 10);
  const devicePixelRatio = boundedNumber(viewport.devicePixelRatio, 0.25, 8);
  const visualScale = boundedNumber(viewport.visualScale, 0.25, 8);

  if (
    width === null ||
    height === null ||
    scrollX === null ||
    scrollY === null ||
    documentWidth === null ||
    documentHeight === null ||
    devicePixelRatio === null ||
    visualScale === null
  ) {
    return undefined;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    scrollX: Math.round(scrollX),
    scrollY: Math.round(scrollY),
    documentWidth: Math.round(documentWidth),
    documentHeight: Math.round(documentHeight),
    devicePixelRatio,
    visualScale,
  };
}

export function sanitizeScreenFeedCapture(value: unknown): ScreenFeedCaptureInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const capture = value as Record<string, unknown>;
  const width = boundedNumber(capture.width, 1, MAX_CAPTURE_DIMENSION);
  const height = boundedNumber(capture.height, 1, MAX_CAPTURE_DIMENSION);
  const quality = boundedNumber(capture.quality, 0.1, 1);
  const encodedBytes = boundedNumber(capture.encodedBytes, 1, MAX_ENCODED_BYTES);
  const durationMs = boundedNumber(capture.durationMs, 0, MAX_CAPTURE_DURATION_MS);
  const source = capture.source;

  if (
    width === null ||
    height === null ||
    quality === null ||
    encodedBytes === null ||
    durationMs === null ||
    (source !== "dom" && source !== "retry" && source !== "fallback")
  ) {
    return undefined;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    source,
    quality,
    encodedBytes: Math.round(encodedBytes),
    durationMs: Math.round(durationMs),
  };
}

export function sanitizeScreenFeedClientCapturedAt(value: unknown, now = Date.now()): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const skewMs = Math.abs(now - date.getTime());
  return skewMs <= 10 * 60 * 1000 ? date : undefined;
}
