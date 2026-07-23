import type { Express } from "express";
import { logger } from "../lib/logger";
import { requireAuth, requireLogin } from "../auth";
import { screenFeedStore, watcherPollStore } from "../screenFeedStore";
import {
  isValidScreenFeedDataUrl,
  sanitizeScreenFeedClicks,
} from "../services/screenFeedService";
import {
  getSessionRole,
  getSessionUserId,
  getSessionUsername,
} from "../lib/requestContext";

// How long (ms) after a watcher's last GET we still consider the user "being watched".
// Must be comfortably larger than the watcher's poll interval (~3–5 s) to avoid
// the watched user flipping back to "not watched" between watcher polls.
const WATCHER_TIMEOUT_MS = 12000;

// Reject frames larger than 1.5 MB (base64 string length)
const MAX_FRAME_SIZE = 1_500_000;

const isDev = process.env.NODE_ENV !== "production";

// When DISABLE_SCREEN_FEED=true, the feature is fully disabled server-side:
// being-watched always returns false (no captures start) and POST frames are dropped.
const SCREEN_FEED_DISABLED = process.env.DISABLE_SCREEN_FEED === "true";

export function registerScreenFeedRoutes(app: Express) {
  // GET: watched user asks "is anyone watching me right now?"
  // Must be registered BEFORE /:userId to avoid route conflict.
  app.get("/api/screen-feed/being-watched", requireLogin, (req, res) => {
    if (SCREEN_FEED_DISABLED) return res.json({ watched: false });

    const userId = String(getSessionUserId(req));
    const lastPoll = watcherPollStore.get(userId) ?? 0;
    const ageMs = Date.now() - lastPoll;
    const watched = lastPoll > 0 && ageMs < WATCHER_TIMEOUT_MS;

    if (isDev) {
      logger.info(
        `[ScreenFeed] being-watched userId=${userId} watched=${watched} lastPollAgeMs=${lastPoll > 0 ? ageMs : "never"}`,
      );
    }

    res.json({ watched, ...(isDev ? { userId, lastWatcherPollAgeMs: lastPoll > 0 ? ageMs : null } : {}) });
  });

  // GET-based trace: CSRF-exempt diagnostic ping from the watched user's browser.
  // Route pattern: GET /api/screen-feed/trace/:event?d=<extra>
  // Registered BEFORE /:userId so "trace" is not mistaken for a userId.
  app.get("/api/screen-feed/trace/:event", requireLogin, (req, res) => {
    if (!isDev) return res.status(204).end();
    const userId = String(getSessionUserId(req));
    const event = req.params.event;
    const extra = req.query.d ? String(req.query.d) : "";
    logger.info(`[ScreenFeed][TRACE] userId=${userId} event=${event}${extra ? " d=" + extra : ""}`);
    res.status(204).end();
  });

  // POST: watched user uploads their screenshot frame + recent clicks.
  app.post("/api/screen-feed", requireLogin, (req, res) => {
    if (SCREEN_FEED_DISABLED) return res.status(200).end();

    const userId = String(getSessionUserId(req));
    if (isDev) {
      logger.info(
        `[ScreenFeed] POST /api/screen-feed received from userId=${userId} body_keys=${Object.keys(req.body ?? {}).join(",")}`,
      );
    }

    const { dataUrl, clicks } = req.body ?? {};

    if (!isValidScreenFeedDataUrl(dataUrl)) {
      if (isDev) {
        logger.warn(
          `[ScreenFeed] POST rejected: missing or invalid dataUrl (type=${typeof dataUrl} starts=${typeof dataUrl === "string" ? dataUrl.slice(0, 30) : "N/A"})`,
        );
      }
      return res.status(400).end();
    }
    if (dataUrl.length > MAX_FRAME_SIZE) {
      if (isDev) logger.warn(`[ScreenFeed] POST rejected: frame too large (${dataUrl.length} bytes)`);
      return res.status(204).end();
    }

    const username = getSessionUsername(req) || userId;
    const safeClicks = sanitizeScreenFeedClicks(clicks);
    screenFeedStore.set(userId, { dataUrl, capturedAt: new Date(), userId, username, clicks: safeClicks });

    if (isDev) {
      logger.info(
        `[ScreenFeed] POST frame stored userId=${userId} frameLen=${dataUrl.length} clicks=${safeClicks.length}`,
      );
    }

    res.status(204).end();
  });

  // GET: Developer polls the latest frame + clicks for a specific watched user.
  app.get("/api/screen-feed/:userId", requireAuth, (req, res) => {
    if (getSessionRole(req) !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }

    const watchedUserId = req.params.userId;
    watcherPollStore.set(watchedUserId, Date.now());

    const frame = screenFeedStore.get(watchedUserId);
    const hasFrame = !!frame;

    if (isDev) {
      const frameAgeMs = frame ? Date.now() - frame.capturedAt.getTime() : null;
      logger.info(
        `[ScreenFeed] GET /:userId watchedUserId=${watchedUserId} hasFrame=${hasFrame} frameAgeMs=${frameAgeMs}`,
      );
    }

    if (!frame) return res.json(null);
    res.json({
      dataUrl: frame.dataUrl,
      capturedAt: frame.capturedAt.toISOString(),
      username: frame.username,
      clicks: frame.clicks,
    });
  });
}
