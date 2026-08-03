export interface ScreenFeedDisplaySize {
  width: number;
  height: number;
}

export type ScreenFeedConnectionQuality = "excellent" | "good" | "delayed" | "stale" | "waiting";

export function calculateContainedScreenFeedSize(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): ScreenFeedDisplaySize {
  if (containerWidth <= 0 || containerHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function classifyScreenFeedConnection(
  hasFrame: boolean,
  liveConnected: boolean,
  frameAgeMs: number,
): ScreenFeedConnectionQuality {
  if (!hasFrame) return "waiting";
  if (liveConnected && frameAgeMs < 2500) return "excellent";
  if (frameAgeMs < 6000) return "good";
  if (frameAgeMs < 15000) return "delayed";
  return "stale";
}

export function formatScreenFeedDelay(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}
