/**
 * supplierProfitCheckRoutes: SupplierProfitProforma endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";

export function registerSupplierProfitProformaRoutes(app: Express, requireAuth: any) {
  app.post("/api/supplier-profit-check/save-proforma", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierId, reference, notes, items } = req.body;
      if (!supplierId || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "supplierId and items required" });

      const proformaRef = reference || `PC-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-4)}`;

      const proformaResult = await pool.query(
        `
        INSERT INTO supplier_proformas (company_id, supplier_id, reference, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        RETURNING id, reference
      `,
        [companyId, supplierId, proformaRef, notes || null]
      );

      const proforma = proformaResult.rows[0];

      if (items.length > 0) {
        const lineValues = [];
        const linePlaceholders: string[] = [];
        let pIdx = 1;
        for (const item of items) {
          lineValues.push(
            proforma.id,
            item.barcode || item.code || "",
            item.itemName || item.name || "",
            Math.round(Number(item.qty) || 0),
            String(item.weight || "0"),
            String(Number(item.supplierPrice || 0).toFixed(2))
          );
          linePlaceholders.push(`($${pIdx},$${pIdx + 1},$${pIdx + 2},$${pIdx + 3},$${pIdx + 4},$${pIdx + 5})`);
          pIdx += 6;
        }
        await pool.query(
          `
          INSERT INTO supplier_proforma_lines (proforma_id, barcode, item_name, qty, weight_per_bale, price_per_bale)
          VALUES ${linePlaceholders.join(",")}
        `,
          lineValues
        );
      }

      res.json({ id: proforma.id, reference: proforma.reference });
    } catch (err: unknown) {
      logger.error("[supplier-profit-check/save-proforma]", { error: getErrorMessage(err) });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // PUT /api/supplier-profit-check/proforma/:id/update-items — autosave: replace lines in place
  app.put("/api/supplier-profit-check/proforma/:id/update-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseInt(req.params.id);
      if (isNaN(proformaId)) return res.status(400).json({ message: "Invalid proforma ID" });

      const check = await pool.query(`SELECT id FROM supplier_proformas WHERE id = $1 AND company_id = $2`, [
        proformaId,
        companyId,
      ]);
      if (!check.rows.length) return res.status(404).json({ message: "Proforma not found" });

      const { items } = req.body;
      if (!Array.isArray(items)) return res.status(400).json({ message: "items array required" });

      await pool.query(`DELETE FROM supplier_proforma_lines WHERE proforma_id = $1`, [proformaId]);

      if (items.length > 0) {
        const lineValues = [];
        const linePlaceholders: string[] = [];
        let pIdx = 1;
        for (const item of items) {
          lineValues.push(
            proformaId,
            item.barcode || item.code || "",
            item.itemName || item.name || "",
            Math.round(Number(item.qty) || 0),
            String(item.weight || "0"),
            String(Number(item.supplierPrice || 0).toFixed(2))
          );
          linePlaceholders.push(`($${pIdx},$${pIdx + 1},$${pIdx + 2},$${pIdx + 3},$${pIdx + 4},$${pIdx + 5})`);
          pIdx += 6;
        }
        await pool.query(
          `INSERT INTO supplier_proforma_lines (proforma_id, barcode, item_name, qty, weight_per_bale, price_per_bale) VALUES ${linePlaceholders.join(",")}`,
          lineValues
        );
      }

      await pool.query(`UPDATE supplier_proformas SET updated_at = now() WHERE id = $1`, [proformaId]);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
