import type { Express } from "express";
import { sql } from "drizzle-orm";
import { APPLICATION_LANGUAGES, DEFAULT_APPLICATION_LANGUAGE, parseApplicationLanguage } from "@shared/applicationLanguageContract";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";

let tableReady: Promise<void> | null = null;

function ensureLanguagePreferenceTable() {
  if (!tableReady) {
    tableReady = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS user_language_preferences (
          user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          preferred_language varchar(2) NOT NULL DEFAULT ${DEFAULT_APPLICATION_LANGUAGE},
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now(),
          CONSTRAINT user_language_preferences_language_check
            CHECK (preferred_language IN ('en', 'ar', 'fr'))
        )
      `)
      .then(() => undefined)
      .catch((error) => {
        tableReady = null;
        throw error;
      });
  }
  return tableReady;
}

export function registerLanguagePreferenceRoutes(app: Express) {
  app.get("/api/language-preference", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      await ensureLanguagePreferenceTable();
      const result = await db.execute(sql`
        SELECT preferred_language AS "preferredLanguage"
        FROM user_language_preferences
        WHERE user_id = ${req.user.id}
        LIMIT 1
      `);
      const row = result.rows[0] as { preferredLanguage?: string } | undefined;
      return res.json({
        preferredLanguage: parseApplicationLanguage(row?.preferredLanguage),
      });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.put("/api/language-preference", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      const requestedLanguage = req.body?.preferredLanguage;
      if (!APPLICATION_LANGUAGES.includes(requestedLanguage)) {
        return res.status(400).json({ message: "Invalid application language" });
      }
      await ensureLanguagePreferenceTable();
      const preferredLanguage = parseApplicationLanguage(requestedLanguage);
      await db.execute(sql`
        INSERT INTO user_language_preferences (user_id, preferred_language, updated_at)
        VALUES (${req.user.id}, ${preferredLanguage}, now())
        ON CONFLICT (user_id)
        DO UPDATE SET preferred_language = EXCLUDED.preferred_language, updated_at = now()
      `);
      return res.json({ preferredLanguage });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
