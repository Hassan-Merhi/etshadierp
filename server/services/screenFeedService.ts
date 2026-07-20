export interface ScreenFeedClick {
  x: number;
  y: number;
  ts: number;
}

const MAX_CLICK_AGE_MS = 8_000;
const MAX_CLICKS_PER_FRAME = 50;

export function isValidScreenFeedDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

export function sanitizeScreenFeedClicks(value: unknown, now = Date.now()): ScreenFeedClick[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (click): click is ScreenFeedClick =>
        !!click &&
        typeof click.x === "number" &&
        Number.isFinite(click.x) &&
        typeof click.y === "number" &&
        Number.isFinite(click.y) &&
        typeof click.ts === "number" &&
        Number.isFinite(click.ts) &&
        now - click.ts < MAX_CLICK_AGE_MS,
    )
    .slice(-MAX_CLICKS_PER_FRAME);
}
