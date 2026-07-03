import type { Express } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";

function getFactoryCompanyId(req: any): number | undefined {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
}

async function hasWriteAccess(req: any, companyId: number): Promise<boolean> {
  const role = req.user?.role;
  if (role === "Admin" || role === "Owner" || role === "Developer") return true;
  const userId = req.user?.id;
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM factory_user_page_access WHERE user_id = $1 AND company_id = $2 AND page_key = 'factory/sheets-sacks'`,
    [userId, companyId]
  );
  return rows.length > 0;
}

const SELECT_COLS = `
  id, company_id AS "companyId", type, name, size,
  quantity, unit_price AS "unitPrice",
  pack_qty AS "packQty", pcs_per_pack AS "pcsPerPack",
  row_color AS "rowColor",
  notes, created_at AS "createdAt"
`;

export function registerFactorySheetsAndSacksRoutes(app: Express) {
  // GET /api/factory/sheets-sacks — list all items
  app.get("/api/factory/sheets-sacks", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = await pool.query(
        `SELECT ${SELECT_COLS}
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
      if (!(await hasWriteAccess(req, companyId))) return res.status(403).json({ message: "Access denied" });

      const { type, name, size, quantity, unitPrice, packQty, pcsPerPack, rowColor, notes } = req.body;
      if (!name || !type) return res.status(400).json({ message: "name and type are required" });

      const { rows } = await pool.query(
        `INSERT INTO factory_sheets_sacks
           (company_id, type, name, size, quantity, unit_price, pack_qty, pcs_per_pack, row_color, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${SELECT_COLS}`,
        [
          companyId, type, name,
          size || null,
          quantity || 0,
          unitPrice || 0,
          packQty != null ? parseInt(packQty) : null,
          pcsPerPack != null ? parseInt(pcsPerPack) : null,
          rowColor || null,
          notes || null,
        ]
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
      if (!(await hasWriteAccess(req, companyId))) return res.status(403).json({ message: "Access denied" });

      const { type, name, size, quantity, unitPrice, packQty, pcsPerPack, rowColor, notes } = req.body;

      const { rows } = await pool.query(
        `UPDATE factory_sheets_sacks
         SET type       = COALESCE($1, type),
             name       = COALESCE($2, name),
             size       = $3,
             quantity   = COALESCE($4, quantity),
             unit_price = COALESCE($5, unit_price),
             pack_qty   = $6,
             pcs_per_pack = $7,
             row_color  = $8,
             notes      = $9
         WHERE id = $10 AND company_id = $11
         RETURNING ${SELECT_COLS}`,
        [
          type || null, name || null, size || null,
          quantity ?? null, unitPrice ?? null,
          packQty != null ? parseInt(packQty) : null,
          pcsPerPack != null ? parseInt(pcsPerPack) : null,
          rowColor || null,
          notes || null,
          id, companyId,
        ]
      );
      if (rows.length === 0) return res.status(404).json({ message: "Item not found" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error("PATCH /api/factory/sheets-sacks/:id error:", err);
      res.status(500).json({ message: err.message || "Failed to update item" });
    }
  });

  // PATCH /api/factory/sheets-sacks/:id/deduct — reduce stock
  app.patch("/api/factory/sheets-sacks/:id/deduct", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      const id = parseInt(req.params.id);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!(await hasWriteAccess(req, companyId))) return res.status(403).json({ message: "Access denied" });

      const pieces = parseInt(req.body.pieces) || 0;
      const packs = req.body.packs != null ? parseInt(req.body.packs) : null;
      if (pieces <= 0) return res.status(400).json({ message: "Pieces to deduct must be greater than 0" });

      // Fetch current values
      const { rows: existing } = await pool.query(
        `SELECT quantity, pack_qty FROM factory_sheets_sacks WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (existing.length === 0) return res.status(404).json({ message: "Item not found" });

      const currentQty = parseFloat(existing[0].quantity || "0");
      const currentPackQty = existing[0].pack_qty != null ? parseInt(existing[0].pack_qty) : null;

      const newQty = Math.max(0, currentQty - pieces);
      const newPackQty =
        packs != null && currentPackQty != null
          ? Math.max(0, currentPackQty - packs)
          : currentPackQty;

      const { rows } = await pool.query(
        `UPDATE factory_sheets_sacks
         SET quantity = $1, pack_qty = $2
         WHERE id = $3 AND company_id = $4
         RETURNING ${SELECT_COLS}`,
        [newQty, newPackQty, id, companyId]
      );
      res.json(rows[0]);
    } catch (err: any) {
      console.error("PATCH /api/factory/sheets-sacks/:id/deduct error:", err);
      res.status(500).json({ message: err.message || "Failed to deduct" });
    }
  });

  // DELETE /api/factory/sheets-sacks/:id
  app.delete("/api/factory/sheets-sacks/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      const id = parseInt(req.params.id);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!(await hasWriteAccess(req, companyId))) return res.status(403).json({ message: "Access denied" });

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
