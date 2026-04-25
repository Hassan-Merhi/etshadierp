interface ScreenFrame {
  dataUrl:     string;
  capturedAt:  Date;
  userId:      string;
  username:    string;
}

// One frame per user, kept in memory only — ephemeral by design.
export const screenFeedStore = new Map<string, ScreenFrame>();

// Evict frames older than 2 minutes every minute.
setInterval(() => {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  for (const [userId, frame] of screenFeedStore.entries()) {
    if (frame.capturedAt < cutoff) screenFeedStore.delete(userId);
  }
}, 60 * 1000);
