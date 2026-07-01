import type { Express } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";

function getFactoryCompanyId(req: any): number | undefined {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
}

export function registerFactorySheetsAndSacksRoutes(app: Express) {
  // GET /api/factory/sheets-sacks — list all items
  app.get("/api/factory/sheets-sacks", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = await pool.query(
        `SELECT id, company_id AS "companyId", type, name, size, quantity, unit_price AS "unitPrice", notes, created_at AS "createdAt"
         FROM factory_sheets_sacks
         WHERE company_id = $1
         ORDER BY type, name`,
        [companyId]
      );
      res.json(rows);
    } catch (err: any) {
      console.error("GET /api/factory/sheets-sacks error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch items" });
    }
  });

  // POST /api/factory/sheets-sacks — create item
  app.post("/api/factory/sheets-sacks", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { type, name, size, quantity, unitPrice, notes } = req.body;
      if (!name || !type) return res.status(400).json({ message: "name and type are required" });

      const { rows } = await pool.query(
        `INSERT INTO factory_sheets_sacks (company_id, type, name, size, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, company_id AS "companyId", type, name, size, quantity, unit_price AS "unitPrice", notes, created_at AS "createdAt"`,
        [companyId, type, name, size || null, quantity || 0, unitPrice || 0, notes || null]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      console.error("POST /api/factory/sheets-sacks error:", err);
      res.status(500).json({ message: err.message || "Failed to create item" });
    }
  });

  // PATCH /api/factory/sheets-sacks/:id — update item
  app.patch("/api/factory/sheets-sacks/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      const id = parseInt(req.params.id);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { type, name, size, quantity, unitPrice, notes } = req.body;

      const { rows } = await pool.query(
        `UPDATE factory_sheets_sacks
         SET type = COALESCE($1, type),
             name = COALESCE($2, name),
             size = $3,
             quantity = COALESCE($4, quantity),
             unit_price = COALESCE($5, unit_price),
             notes = $6
         WHERE id = $7 AND company_id = $8
         RETURNING id, company_id AS "companyId", type, name, size, quantity, unit_price AS "unitPrice", notes, created_at AS "createdAt"`,
        [type || null, name || null, size || null, quantity ?? null, unitPrice ?? null, notes || null, id, companyId]
      );
      if (rows.length === 0) return res.status(404).json({ message: "Item not found" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error("PATCH /api/factory/sheets-sacks/:id error:", err);
      res.status(500).json({ message: err.message || "Failed to update item" });
    }
  });

  // DELETE /api/factory/sheets-sacks/:id
  app.delete("/api/factory/sheets-sacks/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      const id = parseInt(req.params.id);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rowCount } = await pool.query(
        `DELETE FROM factory_sheets_sacks WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (!rowCount) return res.status(404).json({ message: "Item not found" });
      res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/factory/sheets-sacks/:id error:", err);
      res.status(500).json({ message: err.message || "Failed to delete item" });
    }
  });
}
