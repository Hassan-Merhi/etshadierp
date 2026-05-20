import type { Express } from "express";
import { requireAuth, requireLogin } from "../auth";
import { screenFeedStore, watcherPollStore } from "../screenFeedStore";

// How long (ms) after a watcher's last GET we still consider the user "being watched".
// Must be comfortably larger than the watcher's poll interval (~3–5 s) to avoid
// the watched user flipping back to "not watched" between watcher polls.
const WATCHER_TIMEOUT_MS = 12000;

// Reject frames larger than 1.5 MB (base64 string length)
const MAX_FRAME_SIZE = 1_500_000;

const isDev = process.env.NODE_ENV !== "production";

export function registerScreenFeedRoutes(app: Express) {
  // GET: watched user asks "is anyone watching me right now?"
  // Must be registered BEFORE /:userId to avoid route conflict.
  app.get("/api/screen-feed/being-watched", requireLogin, (req, res) => {
    const userId   = String(req.session.userId!);
    const lastPoll = watcherPollStore.get(userId) ?? 0;
    const ageMs    = Date.now() - lastPoll;
    const watched  = lastPoll > 0 && ageMs < WATCHER_TIMEOUT_MS;

    if (isDev) {
      console.log(`[ScreenFeed] being-watched userId=${userId} watched=${watched} lastPollAgeMs=${lastPoll > 0 ? ageMs : "never"}`);
    }

    res.json({ watched, ...(isDev ? { userId, lastWatcherPollAgeMs: lastPoll > 0 ? ageMs : null } : {}) });
  });

  // POST: client sends a trace event so we can see browser-side diagnostics in server logs.
  // No auth required beyond login — best-effort diagnostic only.
  app.post("/api/screen-feed/trace", requireLogin, (req, res) => {
    if (!isDev) return res.status(204).end();
    const { event, data } = req.body ?? {};
    const userId = String(req.session.userId!);
    console.log(`[ScreenFeed][TRACE] userId=${userId} event=${event}`, data ?? "");
    res.status(204).end();
  });

  // POST: watched user uploads their screenshot frame + recent clicks.
  app.post("/api/screen-feed", requireLogin, (req, res) => {
    if (isDev) {
      console.log(`[ScreenFeed] POST /api/screen-feed received from userId=${String(req.session.userId!)} body_keys=${Object.keys(req.body ?? {}).join(",")}`);
    }

    const { dataUrl, clicks } = req.body ?? {};

    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      if (isDev) console.warn(`[ScreenFeed] POST rejected: missing or invalid dataUrl (type=${typeof dataUrl} starts=${typeof dataUrl === "string" ? dataUrl.slice(0, 30) : "N/A"})`);
      return res.status(400).end();
    }
    if (dataUrl.length > MAX_FRAME_SIZE) {
      if (isDev) console.warn(`[ScreenFeed] POST rejected: frame too large (${dataUrl.length} bytes)`);
      return res.status(204).end();
    }

    const userId   = String(req.session.userId!);
    const username = (req.session as any).username as string || userId;
    const now      = Date.now();
    const safeClicks = Array.isArray(clicks)
      ? clicks
          .filter((c: any) => c && typeof c.x === "number" && typeof c.y === "number" && (now - c.ts) < 8000)
          .slice(-50)
      : [];
    screenFeedStore.set(userId, { dataUrl, capturedAt: new Date(), userId, username, clicks: safeClicks });

    if (isDev) {
      console.log(`[ScreenFeed] POST frame stored userId=${userId} frameLen=${dataUrl.length} clicks=${safeClicks.length}`);
    }

    res.status(204).end();
  });

  // GET: Developer polls the latest frame + clicks for a specific watched user.
  app.get("/api/screen-feed/:userId", requireAuth, (req, res) => {
    const role = req.session.currentRole;
    if (role !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }

    const watchedUserId = req.params.userId;
    watcherPollStore.set(watchedUserId, Date.now());

    const frame = screenFeedStore.get(watchedUserId);
    const hasFrame = !!frame;

    if (isDev) {
      const frameAgeMs = frame ? (Date.now() - frame.capturedAt.getTime()) : null;
      console.log(`[ScreenFeed] GET /:userId watchedUserId=${watchedUserId} hasFrame=${hasFrame} frameAgeMs=${frameAgeMs}`);
    }

    if (!frame) return res.json(null);
    res.json({
      dataUrl:    frame.dataUrl,
      capturedAt: frame.capturedAt.toISOString(),
      username:   frame.username,
      clicks:     frame.clicks,
    });
  });
}
