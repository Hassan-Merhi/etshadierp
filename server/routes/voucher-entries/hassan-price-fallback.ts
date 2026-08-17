import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { salesItems, stockItemLocationPrices, stockItems } from "@shared/schema";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { storage } from "../../storage";

function parsePositivePrice(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function registerHassanPriceFallbackMiddleware(app: Express) {
  app.use("/api/vouchers/:id/view-entries", requireAuth, async (req, res, next) => {
    if (req.method !== "GET") return next();

    try {
      const voucherId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(voucherId)) return next();

      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher || voucher.companyId !== req.session.currentCompanyId || voucher.voucherType !== "Sales") {
        return next();
      }

      const saleRows = await db
        .select({
          id: salesItems.id,
          stockItemId: salesItems.stockItemId,
          configuredPrice: salesItems.configuredPrice,
          baseSellingPrice: stockItems.sellingPrice,
        })
        .from(salesItems)
        .leftJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .where(eq(salesItems.voucherId, voucherId));

      const stockItemIds = Array.from(new Set(saleRows.map((row) => row.stockItemId)));
      const locationPriceRows =
        voucher.locationId && stockItemIds.length > 0
          ? await db
              .select({
                stockItemId: stockItemLocationPrices.stockItemId,
                sellingPrice: stockItemLocationPrices.sellingPrice,
              })
              .from(stockItemLocationPrices)
              .where(
                and(
                  eq(stockItemLocationPrices.locationId, voucher.locationId),
                  inArray(stockItemLocationPrices.stockItemId, stockItemIds)
                )
              )
          : [];
      const locationPriceByStockItem = new Map(
        locationPriceRows.map((row) => [row.stockItemId, row.sellingPrice] as const)
      );

      const benchmarkBySaleItemId = new Map<number, number>();
      for (const row of saleRows) {
        const historicalPrice = parsePositivePrice(row.configuredPrice);
        if (historicalPrice != null) {
          benchmarkBySaleItemId.set(row.id, historicalPrice);
          continue;
        }

        const locationPriceRaw = locationPriceByStockItem.get(row.stockItemId);
        if (locationPriceRaw != null) {
          const locationPrice = parsePositivePrice(locationPriceRaw);
          if (locationPrice != null) benchmarkBySaleItemId.set(row.id, locationPrice);
          continue;
        }

        const basePrice = parsePositivePrice(row.baseSellingPrice);
        if (basePrice != null) benchmarkBySaleItemId.set(row.id, basePrice);
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (!Array.isArray(body)) return originalJson(body);

        const enriched = body.map((entry: unknown) => {
          if (!entry || typeof entry !== "object") return entry;
          const record = entry as Record<string, unknown>;
          if (record.isStockItem !== true || record.hassansPrice != null || record.profit == null) return entry;

          const saleItemId = Number(record.id);
          const benchmark = benchmarkBySaleItemId.get(saleItemId);
          if (benchmark == null) return entry;

          const quantity = Number.parseFloat(String(record.quantity ?? "0")) || 0;
          const sellingPrice = Number.parseFloat(String(record.sellingPrice ?? record.rate ?? "0")) || 0;
          const hassansProfit = (sellingPrice - benchmark) * quantity;
          const hassansPercentage = ((sellingPrice - benchmark) / benchmark) * 100;

          return {
            ...record,
            hassansPrice: benchmark.toFixed(2),
            hassansProfit: hassansProfit.toFixed(2),
            hassansPercentage: hassansPercentage.toFixed(1),
          };
        });

        return originalJson(enriched);
      }) as typeof res.json;

      return next();
    } catch {
      return next();
    }
  });
}
