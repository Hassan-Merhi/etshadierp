import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql, eq, and, isNull } from "drizzle-orm";
import { vouchers, voucherEntries, locations, spStockMovements } from "@shared/schema";
import { adjustSpInventoryAtomic, respondToSpInventoryIntegrityError } from "../../services/sp/spInventoryIntegrity";
import { SP_RELEASE_CURRENCY, SP_RELEASE_EXCHANGE_RATE } from "../../services/sp/spReleasePolicy";
import { requireSpCompany, getSpAccount, parseNum } from "./spHelpers";
import { resultRows } from "../../lib/queryResult";

// ── Opening Stock ─────────────────────────────────────────────────────────

export function registerSpOpeningStockRoutes(app: Express) {
  app.get("/api/sp/opening-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const rows = await db.execute(
        sql`SELECT * FROM sp_stock_movements WHERE company_id = ${companyId} AND source_type = 'opening' ORDER BY created_at DESC`
      );
      res.json(resultRows(rows));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/sp/opening-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { articleCode, stockItemId, qty, baseUnitCostUsd, landedUnitCostUsd, finalUnitCostUsd, locationId, notes } =
        req.body;

      if (!articleCode) return res.status(400).json({ message: "articleCode required" });
      const parsedStockItemId = Number(stockItemId);
      if (!Number.isInteger(parsedStockItemId) || parsedStockItemId <= 0) {
        return res.status(400).json({
          code: "SP_INVENTORY_LINK_REQUIRED",
          message: "stockItemId is required so opening stock and ERP inventory remain synchronized",
        });
      }

      const qtyNum = parseNum(qty);
      if (qtyNum <= 0) return res.status(400).json({ message: "qty must be > 0" });
      const baseUC = parseNum(baseUnitCostUsd);
      const landUC = parseNum(landedUnitCostUsd);
      const finalUC = parseNum(finalUnitCostUsd);
      if (finalUC <= 0) return res.status(400).json({ message: "finalUnitCostUsd must be > 0" });

      const stockAcct = await getSpAccount(companyId, "sp_stock");
      const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
      const opnBalAcct = await getSpAccount(companyId, "sp_opnbal");
      if (!stockAcct || !costClrAcct || !opnBalAcct) {
        return res.status(400).json({ message: "SP accounts not configured. Run Setup first." });
      }

      let locId: number | null = locationId ? parseInt(locationId) : null;
      if (!locId) {
        const locs = await db
          .select()
          .from(locations)
          .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
        if (locs.length > 0) locId = locs[0].id;
      }
      if (!locId) {
        return res.status(400).json({
          code: "SP_INVENTORY_LINK_REQUIRED",
          message: "An active Supplier Partner location is required before opening stock can be posted",
        });
      }

      const finalTotal = qtyNum * finalUC;
      const baseTotal = qtyNum * baseUC;
      const landTotal = qtyNum * landUC;
      const openingBalanceTotal = finalTotal - baseTotal;

      const result = await db.transaction(async (tx) => {
        const [movement] = await tx
          .insert(spStockMovements)
          .values({
            companyId,
            sourceType: "opening",
            articleCode,
            description: notes || null,
            stockItemId: parsedStockItemId,
            locationId: locId,
            qtyIn: String(qtyNum),
            qtyRemaining: String(qtyNum),
            baseUnitCostUsd: String(baseUC),
            landedUnitCostUsd: String(landUC),
            finalUnitCostUsd: String(finalUC),
          })
          .returning();

        await adjustSpInventoryAtomic(tx, {
          companyId,
          locationId: locId,
          stockItemId: parsedStockItemId,
          deltaQty: qtyNum,
          incomingRate: finalUC,
          context: `SP opening stock ${articleCode} movement #${movement.id}`,
          sourceVoucherType: "SP_OPENING_STOCK",
          sourceVoucherId: movement.id,
        });

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherType: "Journal",
            voucherNumber: `SP-OPNSTK-${movement.id}-${Date.now()}`,
            voucherDate: new Date().toISOString().slice(0, 10),
            description: `Opening stock — ${articleCode} (${qtyNum} units)`,
            totalAmount: String(finalTotal),
            currency: SP_RELEASE_CURRENCY,
            exchangeRate: SP_RELEASE_EXCHANGE_RATE,
            sourceModule: "SP",
          })
          .returning();

        // Dr SP-STOCK = finalTotal
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: stockAcct.id,
          debitAmount: String(finalTotal),
          creditAmount: "0",
          narration: `Opening stock — ${articleCode} — ${qtyNum} units @ $${finalUC} (final)`,
        });
        // Cr SP-COSTCLR = baseTotal (cleared to supplier payable when sold)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: costClrAcct.id,
          debitAmount: "0",
          creditAmount: String(baseTotal),
          narration: `Opening stock base cost clearing — ${articleCode}`,
        });

        // Route the exact difference between final and base value to opening
        // equity. This always balances the voucher, including historical imports
        // whose final cost contains an adjustment beyond the declared landed cost.
        if (Math.abs(openingBalanceTotal) > 0.00001) {
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: opnBalAcct.id,
            debitAmount: openingBalanceTotal < 0 ? String(Math.abs(openingBalanceTotal)) : "0",
            creditAmount: openingBalanceTotal >= 0 ? String(openingBalanceTotal) : "0",
            narration: `Opening stock landed/adjustment clearing — ${articleCode} (declared landed $${landTotal})`,
          });
        }

        return { movement, voucherId: voucher.id };
      });

      res.json(result);
    } catch (error: unknown) {
      if (respondToSpInventoryIntegrityError(res, error)) return;
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
