import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { getErrorMessage } from "../lib/httpHandlers";
import { companies, locations, stockAdjustmentVouchers, vouchers } from "@shared/schema";

type AdjustmentType = "Production" | "Consumption" | "Mixed";

type IncomingAdjustmentItem = {
  stockItemId?: unknown;
  quantity?: unknown;
  rate?: unknown;
};

function normalizeCurrency(code: string | null | undefined): string {
  const normalized = (code || "USD").trim().toUpperCase();
  return normalized === "XOF" ? "CFA" : normalized;
}

function normalizeAdjustmentItems(items: IncomingAdjustmentItem[]) {
  return items.map((item, index) => {
    const stockItemId = Number(item.stockItemId);
    const quantity = Number(item.quantity);
    const rawRate = item.rate === null || item.rate === undefined || item.rate === "" ? 0 : Number(item.rate);

    if (!Number.isInteger(stockItemId) || stockItemId <= 0) {
      throw new Error(`Stock item ID is required for item ${index + 1}`);
    }
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw new Error(`Quantity cannot be zero for item ${index + 1}`);
    }
    if (!Number.isFinite(rawRate) || rawRate < 0) {
      throw new Error(`Rate must be a non-negative number for item ${index + 1}`);
    }

    return {
      stockItemId,
      quantity: quantity.toString(),
      // Consumption ultimately uses the locked/current inventory rate in the
      // storage layer. Accepting a missing client-side rate prevents the
      // voucher from being created without its linked adjustment rows.
      rate: rawRate.toString(),
    };
  });
}

function actualAdjustmentTotal(
  adjustmentType: AdjustmentType,
  items: Array<{ quantity: string | null; totalAmount: string | null }>
): number {
  if (adjustmentType === "Mixed") {
    return items.reduce((sum, item) => {
      const quantity = Number(item.quantity || 0);
      const amount = Math.abs(Number(item.totalAmount || 0));
      return sum + (quantity > 0 ? amount : -amount);
    }, 0);
  }

  return items.reduce((sum, item) => sum + Math.abs(Number(item.totalAmount || 0)), 0);
}

/**
 * Corrected POST /api/stock-adjustments handler.
 *
 * It is installed in place of the legacy anonymous handler by
 * fiscal-transfers/update.ts so the public route and guard chain stay stable.
 */
export async function stockAdjustmentCreateHandler(req: Request, res: Response) {
  const startedAt = Date.now();
  const userId = req.session.userId;
  const companyId = req.session.currentCompanyId;
  const voucherId = Number(req.body?.voucherId);
  let cleanupVoucherOnFailure = false;

  try {
    const locationId = Number(req.body?.locationId);
    const adjustmentType = req.body?.adjustmentType as AdjustmentType;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    const incomingItems = req.body?.items;

    if (!Number.isInteger(voucherId) || voucherId <= 0) {
      return res.status(400).json({ message: "Voucher ID is required" });
    }
    if (!Number.isInteger(locationId) || locationId <= 0) {
      return res.status(400).json({ message: "Location is required" });
    }
    if (!["Production", "Consumption", "Mixed"].includes(adjustmentType)) {
      return res.status(400).json({ message: "Adjustment type must be 'Production', 'Consumption', or 'Mixed'" });
    }
    if (!Array.isArray(incomingItems) || incomingItems.length === 0) {
      return res.status(400).json({ message: "Items are required" });
    }

    const normalizedItems = normalizeAdjustmentItems(incomingItems);

    const [voucher] = await db.select().from(vouchers).where(eq(vouchers.id, voucherId)).limit(1);
    if (!voucher) return res.status(404).json({ message: "Voucher not found" });

    const [location] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1);
    if (!location) return res.status(404).json({ message: "Location not found" });

    if (!companyId || voucher.companyId !== companyId || location.companyId !== companyId) {
      return res.status(403).json({ message: "Voucher and location must belong to the selected company" });
    }

    const allowedVoucherTypes = new Set(["Production", "Consumption", "Mixed", "Stock Adjustment"]);
    if (!allowedVoucherTypes.has(voucher.voucherType)) {
      return res.status(400).json({ message: "Voucher is not a stock adjustment voucher" });
    }

    const [existingAdjustment] = await db
      .select({ id: stockAdjustmentVouchers.id })
      .from(stockAdjustmentVouchers)
      .where(eq(stockAdjustmentVouchers.voucherId, voucherId))
      .limit(1);
    if (existingAdjustment) {
      return res.status(409).json({ message: "This voucher already has a stock adjustment" });
    }

    const [company] = await db
      .select({ baseCurrency: companies.baseCurrency })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    const nativeCurrency = normalizeCurrency(company?.baseCurrency || voucher.currency);
    if (nativeCurrency.length > 3) {
      return res.status(400).json({ message: `Unsupported voucher currency: ${nativeCurrency}` });
    }

    // The form creates the voucher first and the adjustment second. From this
    // point until storage succeeds, compensate a failure by removing that
    // just-created orphan voucher so Daybook can never keep an empty shell.
    cleanupVoucherOnFailure = true;

    // Stock adjustment item rates/totals are native inventory values. Keep the
    // voucher currency aligned with the company's native/base currency instead
    // of the user's temporary UI display-currency toggle.
    await db
      .update(vouchers)
      .set({ currency: nativeCurrency, locationId })
      .where(eq(vouchers.id, voucherId));

    logger.info("stock adjustment create started", {
      module: "stockAdjustment",
      action: "create",
      userId,
      companyId,
      voucherId,
      adjustmentType,
      nativeCurrency,
      itemCount: normalizedItems.length,
    });

    const adjustment = await storage.createStockAdjustment(
      voucherId,
      locationId,
      adjustmentType,
      notes,
      normalizedItems
    );

    cleanupVoucherOnFailure = false;

    // Recalculate from the rates actually applied by the storage layer. For a
    // consumption this may be the inventory average rate, not the rate sent by
    // the browser, so Daybook's header and item rows remain consistent.
    const totalAmount = actualAdjustmentTotal(adjustmentType, adjustment.items);
    await db
      .update(vouchers)
      .set({
        currency: nativeCurrency,
        locationId,
        totalAmount: totalAmount.toFixed(2),
      })
      .where(eq(vouchers.id, voucherId));

    logger.info("stock adjustment create succeeded", {
      module: "stockAdjustment",
      action: "create",
      userId,
      companyId,
      voucherId,
      adjustmentId: adjustment.adjustment.id,
      durationMs: Date.now() - startedAt,
    });

    return res.status(201).json(adjustment);
  } catch (error: unknown) {
    if (cleanupVoucherOnFailure && Number.isInteger(voucherId) && voucherId > 0) {
      try {
        const [existingAdjustment] = await db
          .select({ id: stockAdjustmentVouchers.id })
          .from(stockAdjustmentVouchers)
          .where(eq(stockAdjustmentVouchers.voucherId, voucherId))
          .limit(1);

        if (!existingAdjustment) {
          await storage.deleteVoucher(voucherId);
          logger.warn("removed orphan stock adjustment voucher after failed creation", {
            module: "stockAdjustment",
            action: "cleanupOrphanVoucher",
            userId,
            companyId,
            voucherId,
          });
        }
      } catch (cleanupError: unknown) {
        logger.error("failed to clean up orphan stock adjustment voucher", {
          module: "stockAdjustment",
          action: "cleanupOrphanVoucher",
          userId,
          companyId,
          voucherId,
          error: getErrorMessage(cleanupError),
        });
      }
    }

    logger.error("stock adjustment create failed", {
      module: "stockAdjustment",
      action: "create",
      userId,
      companyId,
      voucherId: Number.isFinite(voucherId) ? voucherId : undefined,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
    });

    const message = getErrorMessage(error);
    const isValidationError =
      message.includes("required") ||
      message.includes("cannot be zero") ||
      message.includes("non-negative") ||
      message.includes("not a stock adjustment");
    return res.status(isValidationError ? 400 : 500).json({ message });
  }
}
