/**
 * stockGroupsItemsRoutes: StockItemLookup endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { storage } from "../../../storage";
import { requireAuth, requireNonPOS } from "../../../auth";
import { stockItems, stockGroups, stockGrades, stockCategories } from "@shared/schema";
import { eq, and, asc, sql, isNull } from "drizzle-orm";
import { createWorkbook, jsonToSheet, writeWorkbook } from "../../../excelHelper";

export function registerStockItemLookupRoutes(app: Express) {
  // Get cost dubai from OTW containers for stock items
  app.get("/api/stock-items/cost-dubai", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const result = await db.execute(sql`
        SELECT DISTINCT ON (pli.stock_item_id)
          pli.stock_item_id AS "stockItemId",
          pli.rate AS "costDubai"
        FROM po_line_items pli
        JOIN purchase_orders po ON pli.po_id = po.id
        JOIN containers c ON po.container_id = c.id
        WHERE po.company_id = ${companyId}
        ORDER BY pli.stock_item_id, pli.id DESC
      `);
      res.json(result.rows);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Offload item search — find all offloaded containers that contain a given item
  app.get("/api/offload-item-search", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const q = ((req.query.q as string) || "").trim();
      if (!q) return res.json([]);

      const result = await db.execute(sql`
        SELECT
          pli.item_name       AS "itemName",
          pli.quantity        AS "quantity",
          pli.rate            AS "rate",
          pli.line_total      AS "lineTotal",
          po.po_number        AS "poNumber",
          c.container_number  AS "containerNumber",
          c.offload_date      AS "offloadDate",
          c.import_date       AS "importDate",
          c.status            AS "containerStatus",
          po.currency         AS "currency",
          s.legal_name        AS "supplierName"
        FROM po_line_items pli
        JOIN purchase_orders po ON pli.po_id = po.id
        JOIN containers c ON po.container_id = c.id
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.company_id = ${companyId}
          AND c.offload_date IS NOT NULL
          AND pli.item_name ILIKE ${"%" + q + "%"}
        ORDER BY c.offload_date DESC, pli.item_name
      `);
      res.json(result.rows);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Export last 4 sales per stock item (for Excel export)
  app.get("/api/stock-items/last-sales-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db.execute(sql`
        WITH ranked AS (
          SELECT
            si.stock_item_id   AS "stockItemId",
            sk.code            AS "itemCode",
            sk.name            AS "itemName",
            v.voucher_number   AS "voucherNumber",
            v.voucher_date     AS "voucherDate",
            COALESCE(l.name, '') AS "locationName",
            si.quantity        AS "quantity",
            si.selling_price   AS "rate",
            si.total_sales     AS "amount",
            ROW_NUMBER() OVER (
              PARTITION BY si.stock_item_id
              ORDER BY v.voucher_date DESC, v.id DESC
            ) AS rn
          FROM sales_items si
          JOIN vouchers v ON si.voucher_id = v.id
          JOIN stock_items sk ON si.stock_item_id = sk.id
          LEFT JOIN locations l ON v.location_id = l.id
          WHERE v.company_id = ${companyId}
            AND v.optional = false
        )
        SELECT "stockItemId", "itemCode", "itemName", "voucherNumber",
               "voucherDate", "locationName", "quantity", "rate", "amount", rn
        FROM ranked
        WHERE rn <= 4
        ORDER BY "itemName" ASC, rn ASC
      `);

      res.json(rows.rows);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ── Grade/Category Template Export ───────────────────────────────────────────
  // MUST be defined before /api/stock-items/:id to avoid route conflict

  app.get("/api/stock-items/export-grade-category-template", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          id: stockItems.id,
          code: stockItems.code,
          name: stockItems.name,
          stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
          uom: stockItems.uom,
          active: stockItems.active,
          sellingPrice: stockItems.sellingPrice,
          gradeName: sql<string | null>`${stockGrades.name}`,
          categoryName: sql<string | null>`${stockCategories.name}`,
        })
        .from(stockItems)
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .leftJoin(stockGrades, eq(stockItems.gradeId, stockGrades.id))
        .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
        .orderBy(asc(stockItems.code));

      const data = rows.map((r) => ({
        "Item ID": r.id,
        "Item Code": r.code,
        "Item Name": r.name,
        "Stock Group": r.stockGroupName,
        UOM: r.uom,
        Active: r.active ? "Yes" : "No",
        "Selling Price": r.sellingPrice ?? "0",
        "Current Grade": r.gradeName ?? "",
        "Current Category": r.categoryName ?? "",
      }));

      const wb = createWorkbook();
      const ws = jsonToSheet(wb, data, "Stock Items");

      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      headerRow.commit();

      ws.getColumn(8).width = 20;
      ws.getColumn(9).width = 22;
      ws.columns.forEach((col, i) => {
        if (i < 7) col.width = Math.max(col.width || 12, 15);
      });

      const buffer = await writeWorkbook(wb);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="grade-category-template.xlsx"');
      res.send(buffer);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Get single stock item by ID
  // Bulk alias lookup — MUST be registered before /:id to prevent "all-code-aliases"
  // being captured as a param value (parseInt → NaN → 400).
  app.get("/api/stock-items/all-code-aliases", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const aliases = await storage.getAllCompanyCodeAliases(companyId);
      res.json(aliases);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
