import type { Express, NextFunction, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { getClientDate } from "../../lib/dateUtils";
import { buildSafeFilename, contentDisposition } from "../../lib/contentDisposition";
import { db, pool } from "../../db";
import { storage } from "../../storage";
import { requireAuth, checkPOSLocation } from "../../auth";
import { calculateHistoricalLocationInventory } from "../_helpers";
import { inventory, locations, stockCategories, stockGroups, stockItems } from "@shared/schema";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";

function parsePage(value: unknown): number {
  return Math.max(1, Number.parseInt(String(value), 10) || 1);
}

function parsePageSize(value: unknown): number {
  return Math.min(250, Math.max(1, Number.parseInt(String(value), 10) || 100));
}

function normalizeAsOfDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/");
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function compactInventoryRow(item: any, isPOS: boolean) {
  return {
    inventoryId: item.inventoryId ?? item.id ?? null,
    locationId: item.locationId,
    stockItemId: item.stockItemId,
    quantity: item.quantity ?? "0",
    averageRate: isPOS ? null : (item.averageRate ?? "0"),
    totalValue: isPOS ? null : (item.totalValue ?? "0"),
    stockItemCode: item.stockItemCode ?? "",
    stockItemName: item.stockItemName ?? "",
    stockItemUom: item.stockItemUom ?? "",
    stockGroupId: item.stockGroupId ?? null,
    stockGroupName: item.stockGroupName ?? null,
    stockGroupCode: item.stockGroupCode ?? null,
    stockItemActive: item.stockItemActive ?? true,
    categoryId: item.categoryId ?? null,
    categoryName: item.categoryName ?? null,
  };
}

export function registerCommonInventoryPerformanceRoutes(app: Express): void {
  app.get("/api/stock-items", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    if (!req.query.page) return next();

    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.pageSize);
      const offset = (page - 1) * pageSize;
      const conditions: any[] = [eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)];

      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search) {
        const query = `%${search}%`;
        conditions.push(or(ilike(stockItems.name, query), ilike(stockItems.code, query)));
      }

      if (req.query.stockGroupId && req.query.stockGroupId !== "all") {
        conditions.push(eq(stockItems.stockGroupId, Number.parseInt(String(req.query.stockGroupId), 10)));
      }
      if (req.query.gradeId === "none") conditions.push(isNull(stockItems.gradeId));
      else if (req.query.gradeId && req.query.gradeId !== "all") {
        conditions.push(eq(stockItems.gradeId, Number.parseInt(String(req.query.gradeId), 10)));
      }
      if (req.query.categoryId === "none") conditions.push(isNull(stockItems.categoryId));
      else if (req.query.categoryId && req.query.categoryId !== "all") {
        conditions.push(eq(stockItems.categoryId, Number.parseInt(String(req.query.categoryId), 10)));
      }
      if (req.query.active === "true") conditions.push(eq(stockItems.active, true));
      else if (req.query.active === "false") conditions.push(eq(stockItems.active, false));

      const where = and(...conditions);
      const [countRows, data] = await Promise.all([
        db.select({ total: sql<number>`count(*)::int` }).from(stockItems).where(where),
        db.select().from(stockItems).where(where).orderBy(asc(stockItems.name)).limit(pageSize).offset(offset),
      ]);
      const total = countRows[0]?.total ?? 0;

      return res.json({ data, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Compact selected-location payload. The legacy route remains available when
  // profile=compact is absent, but the primary inventory screen opts into this
  // explicit projection instead of receiving every storage-layer column.
  app.get(
    "/api/locations/:locationId/inventory",
    requireAuth,
    checkPOSLocation,
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.query.profile !== "compact") return next();

      try {
        const locationId = Number.parseInt(req.params.locationId, 10);
        if (!Number.isInteger(locationId) || locationId <= 0) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        const location = await storage.getLocationById(locationId);
        if (!location) return res.status(404).json({ message: "Location not found" });
        if (location.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({ message: "Access denied: Location belongs to a different company" });
        }

        const rawAsOfDate = req.query.asOfDate;
        const asOfDate = normalizeAsOfDate(rawAsOfDate);
        if (rawAsOfDate && !asOfDate) {
          return res.status(400).json({ message: "Invalid asOfDate format. Use YYYY-MM-DD" });
        }
        const includeZero = req.query.includeZero === "true";
        const isPOS = req.session.currentRole === "POS" || (req.user as any)?.role === "POS";

        if (asOfDate) {
          const historical = await calculateHistoricalLocationInventory(locationId, location.companyId, asOfDate);
          const rows = historical
            .filter((item: any) => includeZero || Number.parseFloat(String(item.quantity ?? 0)) !== 0)
            .map((item: any) => compactInventoryRow(item, isPOS));
          res.setHeader("X-Result-Profile", "compact");
          return res.json(rows);
        }

        const conditions: any[] = [
          eq(inventory.companyId, location.companyId),
          eq(inventory.locationId, locationId),
          isNull(stockItems.deletedAt),
        ];
        if (!includeZero) conditions.push(sql`${inventory.quantity}::numeric <> 0`);

        const rows = await db
          .select({
            inventoryId: inventory.id,
            locationId: inventory.locationId,
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            totalValue: inventory.totalValue,
            stockItemCode: stockItems.code,
            stockItemName: stockItems.name,
            stockItemUom: stockItems.uom,
            stockGroupId: stockItems.stockGroupId,
            stockGroupName: stockGroups.name,
            stockGroupCode: stockGroups.code,
            stockItemActive: stockItems.active,
            categoryId: stockItems.categoryId,
            categoryName: stockCategories.name,
          })
          .from(inventory)
          .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
          .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
          .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
          .where(and(...conditions))
          .orderBy(asc(stockItems.code));

        res.setHeader("X-Result-Profile", "compact");
        res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
        return res.json(rows.map((item) => compactInventoryRow(item, isPOS)));
      } catch (error: unknown) {
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );

  // Server-built all-location matrix. This replaces the browser's old behavior
  // of downloading every inventory page in parallel and rebuilding the pivot.
  app.get("/api/inventory", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    if (req.query.profile !== "matrix") return next();

    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isPOS = req.session.currentRole === "POS" || (req.user as any)?.role === "POS";

      const result = await pool.query<{
        stock_item_id: number;
        stock_item_name: string;
        stock_item_code: string;
        stock_group_id: number | null;
        stock_group_name: string;
        category_id: number | null;
        category_name: string | null;
        total_qty: string;
        avg_cost: string;
        total_value: string;
        qty_by_location_name: Record<string, number | string>;
        locations: Array<{ id: number; name: string; quantity: number | string }>;
      }>(
        `WITH location_rollup AS (
           SELECT i.stock_item_id,
                  COALESCE(si.name, '') AS stock_item_name,
                  COALESCE(si.code, '') AS stock_item_code,
                  si.stock_group_id,
                  COALESCE(sg.name, 'Unassigned') AS stock_group_name,
                  si.category_id,
                  sc.name AS category_name,
                  MIN(l.id)::int AS location_id,
                  l.name AS location_name,
                  SUM(i.quantity::numeric) AS quantity,
                  SUM(i.total_value::numeric) AS total_value
             FROM inventory i
             JOIN stock_items si ON si.id = i.stock_item_id
             JOIN locations l ON l.id = i.location_id
             LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
             LEFT JOIN stock_categories sc ON sc.id = si.category_id
            WHERE i.company_id = $1
              AND si.deleted_at IS NULL
              AND l.deleted_at IS NULL
              AND i.quantity::numeric <> 0
            GROUP BY i.stock_item_id, si.name, si.code, si.stock_group_id,
                     sg.name, si.category_id, sc.name, l.name
         )
         SELECT stock_item_id,
                stock_item_name,
                stock_item_code,
                stock_group_id,
                stock_group_name,
                category_id,
                category_name,
                SUM(quantity)::text AS total_qty,
                CASE WHEN SUM(quantity) = 0 THEN '0'
                     ELSE (SUM(total_value) / NULLIF(SUM(quantity), 0))::text END AS avg_cost,
                SUM(total_value)::text AS total_value,
                jsonb_object_agg(location_name, quantity ORDER BY location_name) AS qty_by_location_name,
                jsonb_agg(
                  jsonb_build_object('id', location_id, 'name', location_name, 'quantity', quantity)
                  ORDER BY location_name
                ) AS locations
           FROM location_rollup
          GROUP BY stock_item_id, stock_item_name, stock_item_code,
                   stock_group_id, stock_group_name, category_id, category_name
          ORDER BY stock_group_name, stock_item_name`,
        [companyId],
      );

      const rows = result.rows.map((row) => ({
        stockItemId: row.stock_item_id,
        stockItemName: row.stock_item_name,
        stockItemCode: row.stock_item_code,
        stockGroupId: row.stock_group_id,
        stockGroupName: row.stock_group_name,
        categoryId: row.category_id,
        categoryName: row.category_name,
        totalQty: Number.parseFloat(row.total_qty || "0") || 0,
        avgCost: isPOS ? 0 : Number.parseFloat(row.avg_cost || "0") || 0,
        totalValue: isPOS ? 0 : Number.parseFloat(row.total_value || "0") || 0,
        qtyByLocationName: Object.fromEntries(
          Object.entries(row.qty_by_location_name || {}).map(([name, quantity]) => [
            name,
            Number.parseFloat(String(quantity || 0)) || 0,
          ]),
        ),
        locations: (row.locations || []).map((location) => ({
          id: Number(location.id),
          name: String(location.name || ""),
          quantity: Number.parseFloat(String(location.quantity || 0)) || 0,
        })),
      }));

      res.setHeader("X-Result-Profile", "matrix");
      res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
      return res.json(rows);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // SQL-bounded paged inventory fallback. A single request can no longer ask the
  // server for 5,000 item-location rows; the matrix profile is used for the one
  // legitimate all-location overview.
  app.get("/api/inventory", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    if (!req.query.page) return next();

    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.pageSize);
      const offset = (page - 1) * pageSize;
      const conditions: any[] = [
        eq(inventory.companyId, companyId),
        isNull(locations.deletedAt),
        isNull(stockItems.deletedAt),
      ];

      if (req.query.locationId) {
        conditions.push(eq(inventory.locationId, Number.parseInt(String(req.query.locationId), 10)));
      }
      if (req.query.stockGroupId && req.query.stockGroupId !== "all") {
        conditions.push(eq(stockItems.stockGroupId, Number.parseInt(String(req.query.stockGroupId), 10)));
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search) {
        const query = `%${search}%`;
        conditions.push(or(ilike(stockItems.name, query), ilike(stockItems.code, query)));
      }

      const where = and(...conditions);
      const countQuery = db
        .select({ total: sql<number>`count(*)::int` })
        .from(inventory)
        .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(where);
      const dataQuery = db
        .select({
          inventoryId: inventory.id,
          locationId: inventory.locationId,
          locationName: locations.name,
          locationCode: locations.code,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
          lastUpdated: inventory.lastUpdated,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          stockItemUom: stockItems.uom,
          stockGroupId: stockItems.stockGroupId,
          stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
          stockGroupCode: sql<string>`COALESCE(${stockGroups.code}, '')`,
        })
        .from(inventory)
        .leftJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(where)
        .orderBy(asc(stockItems.code), asc(locations.name))
        .limit(pageSize)
        .offset(offset);

      const [countRows, data] = await Promise.all([countQuery, dataQuery]);
      const total = countRows[0]?.total ?? 0;
      return res.json({ data, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Stream the XLSX workbook directly to the response instead of constructing a
  // second full in-memory workbook buffer for large godown exports.
  app.get(
    "/api/locations/:locationId/inventory/export",
    requireAuth,
    checkPOSLocation,
    async (req: Request, res: Response) => {
      try {
        const locationId = Number.parseInt(req.params.locationId, 10);
        if (!Number.isInteger(locationId) || locationId <= 0) {
          return res.status(400).json({ message: "Invalid location ID" });
        }
        const location = await storage.getLocationById(locationId);
        if (!location) return res.status(404).json({ message: "Location not found" });
        if (location.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({ message: "Access denied: Location belongs to a different company" });
        }

        const rows = await db
          .select({
            stockItemCode: stockItems.code,
            stockItemName: stockItems.name,
            stockGroupCode: stockGroups.code,
            stockGroupName: stockGroups.name,
            stockItemUom: stockItems.uom,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            totalValue: inventory.totalValue,
          })
          .from(inventory)
          .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
          .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
          .where(
            and(
              eq(inventory.companyId, location.companyId),
              eq(inventory.locationId, locationId),
              isNull(stockItems.deletedAt),
              sql`${inventory.quantity}::numeric <> 0`,
            ),
          )
          .orderBy(asc(stockGroups.name), asc(stockItems.code));

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader(
          "Content-Disposition",
          contentDisposition(buildSafeFilename([location.name, "inventory", getClientDate(req)], "xlsx")),
        );
        res.setHeader("Cache-Control", "no-store");

        const ExcelJSModule = await import("exceljs");
        const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          stream: res,
          useStyles: false,
          useSharedStrings: false,
        });
        const worksheet = workbook.addWorksheet(`${location.name} Inventory`.slice(0, 31));
        worksheet.columns = [
          { header: "Item Code", key: "stockItemCode", width: 15 },
          { header: "Item Name", key: "stockItemName", width: 30 },
          { header: "Group Code", key: "stockGroupCode", width: 15 },
          { header: "Group Name", key: "stockGroupName", width: 25 },
          { header: "UOM", key: "stockItemUom", width: 10 },
          { header: "Quantity", key: "quantity", width: 15 },
          { header: "Cost/Unit", key: "averageRate", width: 15 },
          { header: "Total Value", key: "totalValue", width: 15 },
        ];

        for (const row of rows) {
          worksheet
            .addRow({
              stockItemCode: row.stockItemCode || "",
              stockItemName: row.stockItemName || "",
              stockGroupCode: row.stockGroupCode || "",
              stockGroupName: row.stockGroupName || "Unassigned",
              stockItemUom: row.stockItemUom || "",
              quantity: Number.parseFloat(row.quantity || "0") || 0,
              averageRate: Number.parseFloat(row.averageRate || "0") || 0,
              totalValue: Number.parseFloat(row.totalValue || "0") || 0,
            })
            .commit();
        }
        worksheet.commit();
        await workbook.commit();
        return;
      } catch (error: unknown) {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : new Error(getErrorMessage(error)));
          return;
        }
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );
}
