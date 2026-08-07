import type { Express } from "express";
import { requireLogin } from "../auth";
import { getSessionUserId } from "../lib/requestContext";
import { screenFeedCursorStore, screenFeedStore, watcherPollStore } from "../screenFeedStore";
import { screenFeedLiveHub } from "../services/screenFeedLiveHub";
import { sanitizeScreenFeedCursor } from "../services/screenFeedService";
import { isRemoteSupportEnabled } from "../services/remoteSupportRuntime";

const WATCHER_TIMEOUT_MS = 12_000;

function isUserBeingWatched(userId: string): boolean {
  if (screenFeedLiveHub.hasViewer(userId)) return true;
  const lastPoll = watcherPollStore.get(userId) ?? 0;
  return lastPoll > 0 && Date.now() - lastPoll < WATCHER_TIMEOUT_MS;
}

/**
 * Pointer telemetry is visual-only support metadata. It must never create a
 * noisy 400 loop because of client clock skew, stale browser code or a single
 * malformed sample. Valid coordinates are normalized by the sanitizer; invalid
 * samples are dropped with 204 while the next pointer sample can recover.
 *
 * This route is intentionally registered before the legacy screen-feed route,
 * so it owns POST /api/screen-feed/pointer without changing frame handling.
 */
export function registerScreenFeedPointerRoute(app: Express): void {
  app.post("/api/screen-feed/pointer", requireLogin, (req, res) => {
    if (!isRemoteSupportEnabled("screenFeedEnabled")) return res.status(204).end();
    const userId = String(getSessionUserId(req));
    if (!isUserBeingWatched(userId)) return res.status(204).end();

    const cursor = sanitizeScreenFeedCursor(req.body?.cursor ?? req.body);
    if (!cursor) return res.status(204).end();

    screenFeedCursorStore.set(userId, cursor);
    const existingFrame = screenFeedStore.get(userId);
    if (existingFrame) existingFrame.cursor = cursor;
    if (isRemoteSupportEnabled("fastScreenFeed")) screenFeedLiveHub.publishCursor(userId, cursor);
    res.status(204).end();
  });
}
