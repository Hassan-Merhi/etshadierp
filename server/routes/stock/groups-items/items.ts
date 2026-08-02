/**
 * stockGroupsItemsRoutes: StockItem endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { storage } from "../../../storage";
import { requireAuth, requireNonPOS } from "../../../auth";
import { logAudit } from "../../_helpers";
import { stockItems, insertStockItemSchema } from "@shared/schema";
import { eq, and, or, asc, sql, isNull, ilike } from "drizzle-orm";

export function registerStockItemRoutes(app: Express) {
  // Stock Items
  app.get("/api/stock-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { page, pageSize, search, stockGroupId, active } = req.query;

      // No page param → flat array (backward-compat for dropdowns / offline sync)
      if (!page) {
        const items = await storage.getAllStockItems(companyId);
        return res.json(items);
      }

      // Paginated path
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const pageSizeNum = Math.min(500, Math.max(1, parseInt(pageSize as string) || 50));
      const offset = (pageNum - 1) * pageSizeNum;

      const conditions: any[] = [eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)];
      if (search && typeof search === "string" && search.trim()) {
        const q = `%${search.trim()}%`;
        conditions.push(or(ilike(stockItems.name, q), ilike(stockItems.code, q)));
      }
      if (stockGroupId && stockGroupId !== "all") {
        conditions.push(eq(stockItems.stockGroupId, parseInt(stockGroupId as string)));
      }
      const { gradeId, categoryId } = req.query;
      if (gradeId === "none") {
        conditions.push(isNull(stockItems.gradeId));
      } else if (gradeId && gradeId !== "all") {
        conditions.push(eq(stockItems.gradeId, parseInt(gradeId as string)));
      }
      if (categoryId === "none") {
        conditions.push(isNull(stockItems.categoryId));
      } else if (categoryId && categoryId !== "all") {
        conditions.push(eq(stockItems.categoryId, parseInt(categoryId as string)));
      }
      if (active === "true") {
        conditions.push(eq(stockItems.active, true));
      } else if (active === "false") {
        conditions.push(eq(stockItems.active, false));
      }
      const where = and(...conditions);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(stockItems)
        .where(where);

      const data = await db
        .select()
        .from(stockItems)
        .where(where)
        .orderBy(asc(stockItems.name))
        .limit(pageSizeNum)
        .offset(offset);

      return res.json({
        data,
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/stock-items", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertStockItemSchema.parse(dataWithCompany);

      // Require a valid stock group (no null/uncategorized)
      if (!parsed.stockGroupId) {
        return res.status(400).json({ message: "Stock Group is required. Please select a valid stock group." });
      }

      // Check for duplicate code within the same company
      const existing = await storage.getStockItemByCode(parsed.code, req.session.currentCompanyId);
      if (existing) {
        return res.status(400).json({ message: "Stock item code already exists in this company" });
      }

      // Calculate opening value if qty and rate provided
      if (parsed.openingQty && parsed.openingRate) {
        const qty = parseFloat(parsed.openingQty);
        const rate = parseFloat(parsed.openingRate);
        parsed.openingValue = (qty * rate).toFixed(2);
      }

      const item = await storage.createStockItem(parsed);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "stock_items",
          recordId: item.id,
          recordIdentifier: item.name,
          changes: {
            name: { new: item.name },
            code: { new: item.code },
            uom: { new: item.uom },
            sellingPrice: { new: item.sellingPrice || "0" },
            openingQty: { new: item.openingQty || "0" },
            openingRate: { new: item.openingRate || "0" },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.status(201).json(item);
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
