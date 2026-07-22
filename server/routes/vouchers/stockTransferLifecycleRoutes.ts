import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireNonPOS } from "../../auth";
import { db } from "../../db";
import { stockTransferVouchers, vouchers } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  finalizeOptionalStockTransfer,
  saveStockTransferLifecycle,
  type StockTransferLifecycleItem,
} from "../../services/stockTransferLifecycle";

const lifecycleItemSchema = z.object({
  stockItemId: z.coerce.number().int().positive(),
  sourceLocationId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative().default(0),
});

const putSchema = z.object({
  destinationLocationId: z.coerce.number().int().positive(),
  notes: z.string().optional().default(""),
  items: z.array(lifecycleItemSchema).min(1),
});

const transferPatchSchema = z.object({
  voucherDate: z.string().optional(),
  description: z.string().optional().default(""),
  sourceLocationId: z.coerce.number().int().positive().optional(),
  destinationLocationId: z.coerce.number().int().positive(),
  items: z
    .array(
      z.object({
        stockItemId: z.coerce.number().int().positive(),
        sourceLocationId: z.coerce.number().int().positive().optional(),
        quantity: z.coerce.number().positive(),
        rate: z.coerce.number().nonnegative().default(0),
      })
    )
    .min(1),
});

function inputError(error: unknown): boolean {
  const message = String((error as any)?.message ?? "");
  return /required|positive|different|insufficient|belong|missing|deleted|not found|not a stock transfer|inconsistent/i.test(message);
}

/**
 * Registered before the legacy stock-transfer handlers. These handlers own the
 * Stock Transfer lifecycle only; unrelated voucher types call next().
 */
export function registerStockTransferLifecycleRoutes(app: Express) {
  app.put("/api/stock-transfers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transferId = Number(req.params.id);
      if (!Number.isInteger(transferId) || transferId <= 0) {
        return res.status(400).json({ message: "Transfer ID is required" });
      }
      const parsed = putSchema.parse(req.body);
      const result = await saveStockTransferLifecycle({
        companyId,
        transferId,
        destinationLocationId: parsed.destinationLocationId,
        notes: parsed.notes,
        items: parsed.items,
      });
      return res.json({ transfer: result, items: result.items });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid stock transfer data", errors: error.issues });
      }
      const status = inputError(error) ? 400 : 500;
      if (status === 500) console.error("[StockTransferLifecycle PUT]", error);
      return res.status(status).json({ message: String((error as any)?.message ?? "Failed to update stock transfer") });
    }
  });

  app.patch(
    "/api/vouchers/:id/transfer",
    requireAuth,
    requireNonPOS,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const voucherId = Number(req.params.id);
        if (!Number.isInteger(voucherId) || voucherId <= 0) return res.status(400).json({ message: "Invalid voucher ID" });

        const [voucher] = await db.select().from(vouchers).where(eq(vouchers.id, voucherId));
        if (!voucher || voucher.voucherType !== "Stock Transfer") return next();
        if (voucher.companyId !== companyId) return res.status(403).json({ message: "Voucher belongs to a different company" });

        const [transfer] = await db
          .select()
          .from(stockTransferVouchers)
          .where(eq(stockTransferVouchers.voucherId, voucherId));
        if (!transfer) return res.status(404).json({ message: "Stock transfer not found" });

        const parsed = transferPatchSchema.parse(req.body);
        const fallbackSourceId = parsed.sourceLocationId;
        const items: StockTransferLifecycleItem[] = parsed.items.map((item) => {
          const sourceLocationId = item.sourceLocationId ?? fallbackSourceId;
          if (!sourceLocationId) throw new Error("Source location is required for every transfer item");
          return { ...item, sourceLocationId };
        });

        const result = await saveStockTransferLifecycle({
          companyId,
          transferId: transfer.id,
          destinationLocationId: parsed.destinationLocationId,
          notes: parsed.description,
          description: parsed.description,
          voucherDate: parsed.voucherDate,
          items,
        });
        return res.json({ success: true, voucherId, transferId: transfer.id, lifecycle: result });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid stock transfer data", errors: error.issues });
        }
        const status = inputError(error) ? 400 : 500;
        if (status === 500) console.error("[StockTransferLifecycle PATCH]", error);
        return res.status(status).json({ message: String((error as any)?.message ?? "Failed to update stock transfer") });
      }
    }
  );

  app.post(
    "/api/vouchers/:id/finalize",
    requireAuth,
    requireNonPOS,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const voucherId = Number(req.params.id);
        if (!Number.isInteger(voucherId) || voucherId <= 0) return res.status(400).json({ message: "Invalid voucher ID" });

        const [voucher] = await db.select().from(vouchers).where(eq(vouchers.id, voucherId));
        if (!voucher || voucher.voucherType !== "Stock Transfer") return next();
        if (voucher.companyId !== companyId) return res.status(403).json({ message: "Voucher belongs to a different company" });

        const result = await finalizeOptionalStockTransfer(companyId, voucherId);
        return res.json({ success: true, ...result });
      } catch (error) {
        const status = inputError(error) ? 400 : 500;
        if (status === 500) console.error("[StockTransferLifecycle Finalize]", error);
        return res.status(status).json({ message: String((error as any)?.message ?? "Failed to finalize stock transfer") });
      }
    }
  );
}
