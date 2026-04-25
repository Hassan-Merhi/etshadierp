import type { Express } from "express";
import { requireAuth } from "../auth";
import { screenFeedStore } from "../screenFeedStore";

export function registerScreenFeedRoutes(app: Express) {
  // POST: watched user uploads their screenshot frame (fire-and-forget from client)
  app.post("/api/screen-feed", requireAuth, (req, res) => {
    const { dataUrl } = req.body ?? {};
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return res.status(400).end();
    }
    const userId   = req.user!.id;
    const username = req.user!.username;
    screenFeedStore.set(userId, { dataUrl, capturedAt: new Date(), userId, username });
    res.status(204).end();
  });

  // GET: admin fetches latest frame for a specific user
  app.get("/api/screen-feed/:userId", requireAuth, (req, res) => {
    const role = req.session.currentRole;
    if (role !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }
    const frame = screenFeedStore.get(req.params.userId);
    if (!frame) return res.json(null);
    res.json({
      dataUrl:     frame.dataUrl,
      capturedAt:  frame.capturedAt,
      username:    frame.username,
    });
  });
}
