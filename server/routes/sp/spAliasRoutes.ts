import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql } from "drizzle-orm";
import { stockItemCodeAliases } from "@shared/schema";
import { requireSpCompany } from "./spHelpers";

// ── Aliases (article code → stock item mapping) ───────────────────────────

export function registerSpAliasRoutes(app: Express) {
  app.get("/api/sp/aliases", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const rows = await db.execute(sql`
        SELECT a.id, a.alias_code, a.description, a.stock_item_id,
               si.name AS stock_item_name, si.code AS stock_item_code
        FROM stock_item_code_aliases a
        LEFT JOIN stock_items si ON a.stock_item_id = si.id
        WHERE a.company_id = ${companyId}
        ORDER BY a.alias_code ASC
      `);
      res.json((rows as any).rows ?? (rows as any));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/aliases", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const { aliasCode, stockItemId, description } = req.body;
      if (!aliasCode || !stockItemId) return res.status(400).json({ message: "aliasCode and stockItemId required" });
      const [row] = await db
        .insert(stockItemCodeAliases)
        .values({
          companyId,
          stockItemId: parseInt(stockItemId),
          aliasCode: String(aliasCode).trim(),
          description: description || null,
        })
        .returning();
      res.json(row);
    } catch (error: any) {
      if (error.code === "23505")
        return res.status(400).json({ message: "Alias code already exists for this company" });
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sp/aliases/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      await db.execute(
        sql`DELETE FROM stock_item_code_aliases WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId}`
      );
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
