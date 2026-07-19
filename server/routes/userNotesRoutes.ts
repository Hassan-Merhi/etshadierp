import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { getUserNotes, saveUserNotes } from "../services/userNotesService";

interface AuthenticatedRequest extends Request {
  user?: {
    id?: number;
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

export function registerUserNotesRoutes(app: Express) {
  // GET /api/user/notes — fetch current user's notes (returns empty string if none)
  app.get("/api/user/notes", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      res.json(await getUserNotes(userId));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // PUT /api/user/notes — upsert current user's notes
  app.put("/api/user/notes", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const content = typeof req.body.content === "string" ? req.body.content : "";
      await saveUserNotes(userId, content);

      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
