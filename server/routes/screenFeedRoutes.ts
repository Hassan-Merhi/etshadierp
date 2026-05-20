import type { Express } from "express";
import { requireAuth } from "../auth";
import { screenFeedStore, watcherPollStore } from "../screenFeedStore";

// How long (ms) after a watcher's last GET we still consider the user "being watched".
// Must be comfortably larger than the watcher's poll interval (~3–5 s) to avoid
// the watched user flipping back to "not watched" between watcher polls.
const WATCHER_TIMEOUT_MS = 12000;

// Reject frames larger than 1.5 MB (base64 string length)
const MAX_FRAME_SIZE = 1_500_000;

export function registerScreenFeedRoutes(app: Express) {
  // GET: watched user asks "is anyone watching me right now?"
  // Must be registered BEFORE /:userId to avoid route conflict.
  app.get("/api/screen-feed/being-watched", requireAuth, (req, res) => {
    const userId   = req.user!.id;
    const lastPoll = watcherPollStore.get(userId) ?? 0;
    const watched  = (Date.now() - lastPoll) < WATCHER_TIMEOUT_MS;
    res.json({ watched });
  });

  // POST: watched user uploads their screenshot frame + recent clicks
  app.post("/api/screen-feed", requireAuth, (req, res) => {
    const { dataUrl, clicks } = req.body ?? {};

    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return res.status(400).end();
    }
    if (dataUrl.length > MAX_FRAME_SIZE) {
      // Frame too large — silently discard rather than 400 so client keeps running
      return res.status(204).end();
    }

    const userId   = req.user!.id;
    const username = req.user!.username;
    const now      = Date.now();
    const safeClicks = Array.isArray(clicks)
      ? clicks
          .filter((c: any) => c && typeof c.x === "number" && typeof c.y === "number" && (now - c.ts) < 8000)
          .slice(-50)
      : [];
    screenFeedStore.set(userId, { dataUrl, capturedAt: new Date(), userId, username, clicks: safeClicks });
    res.status(204).end();
  });

  // GET: Developer polls the latest frame + clicks for a specific watched user.
  // Recording this poll is what signals "a watcher is active".
  app.get("/api/screen-feed/:userId", requireAuth, (req, res) => {
    const role = req.session.currentRole;
    if (role !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }
    // Record that someone is watching this user right now
    watcherPollStore.set(req.params.userId, Date.now());

    const frame = screenFeedStore.get(req.params.userId);
    if (!frame) return res.json(null);
    res.json({
      dataUrl:    frame.dataUrl,
      capturedAt: frame.capturedAt.toISOString(),
      username:   frame.username,
      clicks:     frame.clicks,
    });
  });
}
