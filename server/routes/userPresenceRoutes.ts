/**
 * User-presence routes.
 *
 * Active-user presence tracking (list, heartbeat/update, per-user status and
 * activity, clear, and leave). Extracted from authRoutes.ts as a
 * sub-registrar; behaviour is unchanged.
 */
import type { Express } from "express";
import { eq, and, desc, lt, gt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { requireAuth } from "../auth";
import { userActivityLog, userPresence, updatePresenceSchema } from "@shared/schema";

export function registerUserPresenceRoutes(app: Express) {
  // User Presence tracking endpoints
  // GET: Fetch all active users (Admin/Owner/Manager only)
  // Uses TTL-based filtering (WHERE lastSeen > 2 min ago) in a single SELECT —
  // no blocking DELETE before fetch. Stale-row cleanup runs fire-and-forget separately.
  app.get("/api/user-presence", requireAuth, async (req, res) => {
    const userRole = req.session.currentRole;
    if (!userRole || !["Admin", "Owner", "Manager", "Developer"].includes(userRole)) {
      return res.status(403).json({ message: "Access denied. Admin, Owner, or Manager role required." });
    }

    try {
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

      // Single SELECT with WHERE — no blocking cleanup step.
      const activeUsers = await db
        .select()
        .from(userPresence)
        .where(and(gt(userPresence.lastSeen, threeMinutesAgo), ne(userPresence.role, "Developer")))
        .orderBy(desc(userPresence.lastSeen));

      res.json(activeUsers);

      // Fire-and-forget stale row cleanup; never blocks the response.
      db.delete(userPresence)
        .where(lt(userPresence.lastSeen, threeMinutesAgo))
        .catch((err: any) => console.error("[Presence] Stale cleanup error:", err.message));
    } catch (error: any) {
      console.error("[Presence] Error fetching active users:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH: Update user presence (heartbeat / route change)
  // Returns 204 silently on DB failure — presence is non-critical.
  app.patch("/api/user-presence", requireAuth, async (req, res) => {
    const parseResult = updatePresenceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid request body" });
    }

    const { route, type } = parseResult.data;
    const sessionId = req.sessionID;
    const userId = req.user!.id;
    const username = req.user!.username;
    const companyId = req.session.currentCompanyId || null;
    const companyName = (req.session as any).currentCompanyName || null;
    const role = req.session.currentRole || null;

    // Respond immediately — presence writes are best-effort.
    res.status(204).end();

    // Upsert current presence row.
    db.insert(userPresence)
      .values({
        sessionId,
        userId,
        username,
        currentRoute: route,
        companyId,
        companyName,
        role,
        lastSeen: sql`now()`,
      })
      .onConflictDoUpdate({
        target: userPresence.sessionId,
        set: {
          currentRoute: route,
          companyId,
          companyName,
          role,
          lastSeen: sql`now()`,
        },
      })
      .catch((err: any) => {
        console.error("[Presence] Heartbeat upsert error:", err.message);
      });

    // Log route changes to activity log so admins can watch navigation history.
    if (type === "route_change") {
      db.insert(userActivityLog)
        .values({
          userId,
          username,
          companyId,
          companyName,
          route,
        })
        .catch((err: any) => {
          console.error("[ActivityLog] Insert error:", err.message);
        });

      // Prune: keep only last 200 entries per user (fire-and-forget).
      db.execute(
        sql`DELETE FROM user_activity_log WHERE user_id = ${userId}
              AND id NOT IN (
                SELECT id FROM user_activity_log WHERE user_id = ${userId}
                ORDER BY occurred_at DESC LIMIT 200
              )`
      ).catch(() => {});
    }
  });

  // GET: Fetch a single user's current presence (for Watch panel polling).
  app.get("/api/user-presence/:userId", requireAuth, async (req, res) => {
    const role = req.session.currentRole;
    if (role !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }
    try {
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
      const rows = await db
        .select()
        .from(userPresence)
        .where(and(eq(userPresence.userId, req.params.userId), gt(userPresence.lastSeen, threeMinutesAgo)))
        .orderBy(desc(userPresence.lastSeen))
        .limit(1);
      if (!rows[0]) return res.json(null);
      // Explicitly serialize date to ISO string so clients parse it reliably
      res.json({
        ...rows[0],
        lastSeen: rows[0].lastSeen instanceof Date ? rows[0].lastSeen.toISOString() : String(rows[0].lastSeen),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET: Fetch navigation activity history for a user (for Watch panel).
  app.get("/api/user-presence/:userId/activity", requireAuth, async (req, res) => {
    const role = req.session.currentRole;
    if (role !== "Developer") {
      return res.status(403).json({ message: "Access denied." });
    }
    try {
      const rows = await db
        .select()
        .from(userActivityLog)
        .where(eq(userActivityLog.userId, req.params.userId))
        .orderBy(desc(userActivityLog.occurredAt))
        .limit(50);
      // Serialize dates to ISO strings for reliable client-side parsing
      res.json(
        rows.map((r) => ({
          ...r,
          occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
        }))
      );
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE: Clear user presence on logout — fire-and-forget, never 500.
  app.delete("/api/user-presence", requireAuth, async (req, res) => {
    const sessionId = req.sessionID;
    res.status(204).end();
    if (sessionId) {
      db.delete(userPresence)
        .where(eq(userPresence.sessionId, sessionId))
        .catch((err: any) => console.error("[Presence] Delete error:", err.message));
    }
  });

  // POST: Handle sendBeacon leave (no auth — session may already be ending).
  // Responds instantly; DB delete runs in the background.
  app.post("/api/user-presence/leave", async (req, res) => {
    const sessionId = req.sessionID;
    res.status(204).end();
    if (sessionId) {
      db.delete(userPresence)
        .where(eq(userPresence.sessionId, sessionId))
        .catch((err: any) => console.error("[Presence] Leave delete error:", err.message));
    }
  });
}
