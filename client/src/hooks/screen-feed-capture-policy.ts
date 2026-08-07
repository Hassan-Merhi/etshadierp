export const ACTIVE_CAPTURE_MIN_GAP_MS = 850;
export const DIRTY_SETTLE_MS = 180;
export const MAX_DIRTY_LATENCY_MS = 1200;
export const IDLE_REFRESH_MS = 60000;
export const FAILED_CAPTURE_BACKOFF_MS = 3500;

// Keep the legacy exports for any tests or older call sites, but map them onto
// the low-impact policy. The optimized hook no longer continuously captures
// unchanged pages just to discover that the frame is identical.
export const ACTIVE_CAPTURE_DELAY_MS = ACTIVE_CAPTURE_MIN_GAP_MS;
export const IDLE_CAPTURE_DELAY_MS = 5000;
export const MAX_IDLE_CAPTURE_DELAY_MS = IDLE_REFRESH_MS;
export const FAILED_CAPTURE_DELAY_MS = FAILED_CAPTURE_BACKOFF_MS;

export interface UploadDecisionInput {
  signature: string;
  lastSignature: string | null;
  latestClickTs: number;
  lastUploadedClickTs: number;
  force?: boolean;
}

export function shouldUploadScreenFrame({
  signature,
  lastSignature,
  latestClickTs,
  lastUploadedClickTs,
  force = false,
}: UploadDecisionInput): boolean {
  return force || signature !== lastSignature || latestClickTs > lastUploadedClickTs;
}

export function nextScreenFeedCaptureDelay(unchangedFrames: number, failed = false): number {
  if (failed) return FAILED_CAPTURE_BACKOFF_MS;
  if (unchangedFrames >= 4) return IDLE_REFRESH_MS;
  if (unchangedFrames >= 2) return IDLE_CAPTURE_DELAY_MS;
  return ACTIVE_CAPTURE_MIN_GAP_MS;
}

export function hashScreenFeedPixels(data: Uint8ClampedArray): string {
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 4) {
    hash ^= data[index] ?? 0;
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 1] ?? 0;
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 2] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
