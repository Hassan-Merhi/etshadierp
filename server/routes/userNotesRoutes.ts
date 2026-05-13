import type { Express, Request, Response } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { userNotes } from "../../shared/schema";
import { eq } from "drizzle-orm";

export function registerUserNotesRoutes(app: Express) {
  // GET /api/user/notes — fetch current user's notes (returns empty string if none)
  app.get("/api/user/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const [row] = await db
        .select({ content: userNotes.content, updatedAt: userNotes.updatedAt })
        .from(userNotes)
        .where(eq(userNotes.userId, userId));

      res.json({ content: row?.content ?? "", updatedAt: row?.updatedAt ?? null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/user/notes — upsert current user's notes
  app.put("/api/user/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const content: string = typeof req.body.content === "string" ? req.body.content : "";

      await db
        .insert(userNotes)
        .values({ userId, content, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userNotes.userId,
          set: { content, updatedAt: new Date() },
        });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
