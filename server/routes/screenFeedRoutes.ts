import type { Express } from "express";
import { requireAuth } from "../auth";
import { screenFeedStore } from "../screenFeedStore";

export function registerScreenFeedRoutes(app: Express) {
  // POST: watched user uploads their screenshot frame + recent clicks (fire-and-forget)
  app.post("/api/screen-feed", requireAuth, (req, res) => {
    const { dataUrl, clicks } = req.body ?? {};
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return res.status(400).end();
    }
    const userId   = req.user!.id;
    const username = req.user!.username;
    // Keep only clicks from the last 8 seconds and cap at 50
    const now = Date.now();
    const safeClicks = Array.isArray(clicks)
      ? clicks.filter((c: any) => c && typeof c.x === "number" && typeof c.y === "number" && (now - c.ts) < 8000).slice(-50)
      : [];
    screenFeedStore.set(userId, { dataUrl, capturedAt: new Date(), userId, username, clicks: safeClicks });
    res.status(204).end();
  });

  // GET: admin fetches latest frame + clicks for a specific user
  app.get("/api/screen-feed/:userId", requireAuth, (req, res) => {
    const role = req.session.currentRole;
    if (role !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }
    const frame = screenFeedStore.get(req.params.userId);
    if (!frame) return res.json(null);
    res.json({
      dataUrl:    frame.dataUrl,
      capturedAt: frame.capturedAt,
      username:   frame.username,
      clicks:     frame.clicks,
    });
  });
}
