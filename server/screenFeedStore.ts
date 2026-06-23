export interface ClickEvent {
  x: number;
  y: number;
  label: string;
  ts: number;
}

export interface ScreenFrame {
  dataUrl: string;
  capturedAt: Date;
  userId: string;
  username: string;
  clicks: ClickEvent[];
}

// One frame per user, kept in memory only — ephemeral by design.
export const screenFeedStore = new Map<string, ScreenFrame>();

// Tracks the last time a Developer polled a user's feed.
// Key = watched userId, Value = timestamp (ms).
// If this is recent (< 5s), that user is currently being watched.
export const watcherPollStore = new Map<string, number>();

// Evict frames and stale watcher polls older than 2 minutes.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const cutoffDt = new Date(cutoff);
  for (const [userId, frame] of screenFeedStore.entries()) {
    if (frame.capturedAt < cutoffDt) screenFeedStore.delete(userId);
  }
  for (const [userId, ts] of watcherPollStore.entries()) {
    if (ts < cutoff) watcherPollStore.delete(userId);
  }
}, 60 * 1000);
