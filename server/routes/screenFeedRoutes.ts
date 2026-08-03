import type { Express, Request, Response } from "express";
import { logger } from "../lib/logger";
import { requireAuth, requireLogin } from "../auth";
import { screenFeedStore, watcherPollStore } from "../screenFeedStore";
import { isValidScreenFeedDataUrl, sanitizeScreenFeedClicks } from "../services/screenFeedService";
import {
  emergencyDisableRemoteSupport,
  getRemoteSupportRuntimeSnapshot,
  isRemoteSupportEnabled,
  recordRemoteSupportMetric,
  resetRemoteSupportMetrics,
  restoreRemoteSupportBootDefaults,
  updateRemoteSupportFlags,
} from "../services/remoteSupportRuntime";
import { getSessionRole, getSessionUserId, getSessionUsername } from "../lib/requestContext";

const WATCHER_TIMEOUT_MS = 12000;
const MAX_FRAME_SIZE = 1_500_000;
const FAST_MAX_FRAME_SIZE = 900_000;
const FAST_MIN_UPLOAD_INTERVAL_MS = 650;
const FAST_RETRY_AFTER_SECONDS = 1;
const MAX_USER_ID_LENGTH = 64;
const isDev = process.env.NODE_ENV !== "production";
const lastFastUploadAt = new Map<string, number>();

function requireDeveloper(req: Request, res: Response): boolean {
  if (getSessionRole(req) !== "Developer") {
    res.status(403).json({ message: "Access denied." });
    return false;
  }
  return true;
}

function runtimeActor(req: Request): string {
  return getSessionUsername(req) || String(getSessionUserId(req));
}

function isValidWatchedUserId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_USER_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

function frameEtag(userId: string, capturedAt: Date, dataUrlLength: number): string {
  return `W/\"screen-feed-${userId}-${capturedAt.getTime()}-${dataUrlLength}\"`;
}

export function registerScreenFeedRoutes(app: Express) {
  app.get("/api/screen-feed/admin/runtime", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(getRemoteSupportRuntimeSnapshot());
  });

  app.patch("/api/screen-feed/admin/runtime", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    const patch = req.body?.flags ?? req.body ?? {};
    const snapshot = updateRemoteSupportFlags(patch, runtimeActor(req));
    if (!snapshot.flags.screenFeedEnabled) {
      watcherPollStore.clear();
      lastFastUploadAt.clear();
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(snapshot);
  });

  app.post("/api/screen-feed/admin/runtime/emergency-stop", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    watcherPollStore.clear();
    lastFastUploadAt.clear();
    const snapshot = emergencyDisableRemoteSupport(runtimeActor(req));
    logger.warn(`[RemoteSupport] emergency stop activated by ${runtimeActor(req)}`);
    res.setHeader("Cache-Control", "no-store");
    res.json(snapshot);
  });

  app.post("/api/screen-feed/admin/runtime/restore-defaults", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    const snapshot = restoreRemoteSupportBootDefaults(runtimeActor(req));
    res.setHeader("Cache-Control", "no-store");
    res.json(snapshot);
  });

  app.post("/api/screen-feed/admin/runtime/reset-metrics", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(resetRemoteSupportMetrics());
  });

  app.get("/api/screen-feed/being-watched", requireLogin, (req, res) => {
    recordRemoteSupportMetric("watcherStatusPoll");
    if (!isRemoteSupportEnabled("screenFeedEnabled")) {
      return res.json({ watched: false, transport: "legacy" });
    }

    const userId = String(getSessionUserId(req));
    const lastPoll = watcherPollStore.get(userId) ?? 0;
    const ageMs = Date.now() - lastPoll;
    const watched = lastPoll > 0 && ageMs < WATCHER_TIMEOUT_MS;
    const fastEnabled = isRemoteSupportEnabled("fastScreenFeed");

    if (isDev) {
      logger.info(
        `[ScreenFeed] being-watched userId=${userId} watched=${watched} transport=${fastEnabled ? "fast" : "legacy"} lastPollAgeMs=${lastPoll > 0 ? ageMs : "never"}`
      );
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
      watched,
      transport: fastEnabled ? "fast" : "legacy",
      ...(isDev ? { userId, lastWatcherPollAgeMs: lastPoll > 0 ? ageMs : null } : {}),
    });
  });

  app.get("/api/screen-feed/trace/:event", requireLogin, (req, res) => {
    if (!isDev) return res.status(204).end();
    const userId = String(getSessionUserId(req));
    const event = req.params.event;
    const extra = req.query.d ? String(req.query.d) : "";
    logger.info(`[ScreenFeed][TRACE] userId=${userId} event=${event}${extra ? " d=" + extra : ""}`);
    res.status(204).end();
  });

  app.post("/api/screen-feed", requireLogin, (req, res) => {
    if (!isRemoteSupportEnabled("screenFeedEnabled")) return res.status(200).end();

    const userId = String(getSessionUserId(req));
    const fastEnabled = isRemoteSupportEnabled("fastScreenFeed");
    const now = Date.now();
    if (fastEnabled) {
      const previous = lastFastUploadAt.get(userId) ?? 0;
      if (now - previous < FAST_MIN_UPLOAD_INTERVAL_MS) {
        recordRemoteSupportMetric("frameRejected");
        res.setHeader("Retry-After", String(FAST_RETRY_AFTER_SECONDS));
        return res.status(429).json({ message: "Frame producer is sending too quickly." });
      }
    }

    const { dataUrl, clicks } = req.body ?? {};
    if (!isValidScreenFeedDataUrl(dataUrl)) {
      recordRemoteSupportMetric("frameRejected");
      return res.status(400).end();
    }

    const activeLimit = fastEnabled ? FAST_MAX_FRAME_SIZE : MAX_FRAME_SIZE;
    if (dataUrl.length > activeLimit) {
      recordRemoteSupportMetric("frameRejected");
      return res.status(413).json({ message: "Frame payload is too large." });
    }

    const username = getSessionUsername(req) || userId;
    const safeClicks = sanitizeScreenFeedClicks(clicks);
    const capturedAt = new Date();
    screenFeedStore.set(userId, { dataUrl, capturedAt, userId, username, clicks: safeClicks });
    if (fastEnabled) lastFastUploadAt.set(userId, now);
    recordRemoteSupportMetric("frameAccepted", Buffer.byteLength(dataUrl, "utf8"));
    res.status(204).end();
  });

  app.get("/api/screen-feed/:userId", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;

    const watchedUserId = req.params.userId;
    if (!isValidWatchedUserId(watchedUserId)) {
      return res.status(400).json({ message: "Invalid watched user ID." });
    }

    recordRemoteSupportMetric("viewerPoll");
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");

    if (!isRemoteSupportEnabled("screenFeedEnabled")) return res.json(null);

    watcherPollStore.set(watchedUserId, Date.now());
    const frame = screenFeedStore.get(watchedUserId);
    if (!frame) return res.json(null);

    const etag = frameEtag(watchedUserId, frame.capturedAt, frame.dataUrl.length);
    res.setHeader("ETag", etag);
    res.setHeader("X-Screen-Feed-Transport", isRemoteSupportEnabled("fastScreenFeed") ? "fast" : "legacy");

    if (isRemoteSupportEnabled("fastScreenFeed") && req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.json({
      dataUrl: frame.dataUrl,
      capturedAt: frame.capturedAt.toISOString(),
      username: frame.username,
      clicks: frame.clicks,
    });
  });
}
