export interface ScreenFeedDisplaySize {
  width: number;
  height: number;
}

export type ScreenFeedConnectionQuality = "excellent" | "good" | "delayed" | "stale" | "waiting";
export type ScreenFeedRecoveryAction = "none" | "poll" | "reconnect";

export interface ScreenFeedRecoveryDecision {
  quality: ScreenFeedConnectionQuality;
  action: ScreenFeedRecoveryAction;
  retryAfterMs: number | null;
  reason: "healthy" | "waiting-for-first-frame" | "transport-disconnected" | "frame-delayed" | "frame-stale";
}

const RECOVERY_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

export function calculateContainedScreenFeedSize(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number
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
  frameAgeMs: number
): ScreenFeedConnectionQuality {
  if (!hasFrame) return "waiting";
  if (liveConnected && frameAgeMs < 2500) return "excellent";
  if (frameAgeMs < 6000) return "good";
  if (frameAgeMs < 15000) return "delayed";
  return "stale";
}

export function getScreenFeedRecoveryDelay(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return RECOVERY_BACKOFF_MS[Math.min(normalizedAttempt, RECOVERY_BACKOFF_MS.length - 1)];
}

export function decideScreenFeedRecovery(input: {
  hasFrame: boolean;
  liveConnected: boolean;
  frameAgeMs: number;
  recoveryAttempt: number;
}): ScreenFeedRecoveryDecision {
  const quality = classifyScreenFeedConnection(input.hasFrame, input.liveConnected, input.frameAgeMs);

  if (quality === "excellent" || quality === "good") {
    return { quality, action: "none", retryAfterMs: null, reason: "healthy" };
  }

  if (quality === "waiting") {
    return {
      quality,
      action: input.liveConnected ? "poll" : "reconnect",
      retryAfterMs: getScreenFeedRecoveryDelay(input.recoveryAttempt),
      reason: "waiting-for-first-frame",
    };
  }

  if (!input.liveConnected) {
    return {
      quality,
      action: "reconnect",
      retryAfterMs: getScreenFeedRecoveryDelay(input.recoveryAttempt),
      reason: "transport-disconnected",
    };
  }

  if (quality === "delayed") {
    return {
      quality,
      action: "poll",
      retryAfterMs: getScreenFeedRecoveryDelay(input.recoveryAttempt),
      reason: "frame-delayed",
    };
  }

  return {
    quality,
    action: "reconnect",
    retryAfterMs: getScreenFeedRecoveryDelay(input.recoveryAttempt),
    reason: "frame-stale",
  };
}

export function formatScreenFeedDelay(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}
