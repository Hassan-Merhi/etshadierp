export const ACTIVE_CAPTURE_DELAY_MS = 150;
export const IDLE_CAPTURE_DELAY_MS = 500;
export const MAX_IDLE_CAPTURE_DELAY_MS = 1000;
export const FAILED_CAPTURE_DELAY_MS = 2000;

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
  if (failed) return FAILED_CAPTURE_DELAY_MS;
  if (unchangedFrames >= 4) return MAX_IDLE_CAPTURE_DELAY_MS;
  if (unchangedFrames >= 2) return IDLE_CAPTURE_DELAY_MS;
  return ACTIVE_CAPTURE_DELAY_MS;
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
