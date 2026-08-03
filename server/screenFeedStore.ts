export interface ClickEvent {
  x: number;
  y: number;
  label?: string;
  ts: number;
}

export interface ScreenFeedCursor {
  x: number;
  y: number;
  ts: number;
  visible: boolean;
}

export interface ScreenFeedViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  documentWidth: number;
  documentHeight: number;
  devicePixelRatio: number;
  visualScale: number;
}

export interface ScreenFeedCaptureInfo {
  width: number;
  height: number;
  source: "dom" | "retry" | "fallback";
  quality: number;
  encodedBytes: number;
  durationMs: number;
}

export interface ScreenFrame {
  dataUrl: string;
  capturedAt: Date;
  clientCapturedAt?: Date;
  userId: string;
  username: string;
  clicks: ClickEvent[];
  cursor?: ScreenFeedCursor | null;
  viewport?: ScreenFeedViewport;
  capture?: ScreenFeedCaptureInfo;
}

// One frame per user, kept in memory only — ephemeral by design.
export const screenFeedStore = new Map<string, ScreenFrame>();

// Latest pointer position per user. Pointer updates are tiny and independent
// from image frames so cursor movement does not force duplicate image uploads.
export const screenFeedCursorStore = new Map<string, ScreenFeedCursor>();

// Tracks the last time a Developer polled a user's feed.
// Key = watched userId, Value = timestamp (ms).
export const watcherPollStore = new Map<string, number>();

// Evict frames, cursors, and stale watcher polls older than 2 minutes.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const cutoffDt = new Date(cutoff);
  for (const [userId, frame] of screenFeedStore.entries()) {
    if (frame.capturedAt < cutoffDt) screenFeedStore.delete(userId);
  }
  for (const [userId, cursor] of screenFeedCursorStore.entries()) {
    if (cursor.ts < cutoff) screenFeedCursorStore.delete(userId);
  }
  for (const [userId, ts] of watcherPollStore.entries()) {
    if (ts < cutoff) watcherPollStore.delete(userId);
  }
}, 60 * 1000);
