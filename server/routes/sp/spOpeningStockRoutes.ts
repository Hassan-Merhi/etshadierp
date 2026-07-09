import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql, eq, and, isNull } from "drizzle-orm";
import { vouchers, voucherEntries, locations, spStockMovements } from "@shared/schema";
import { adjustInventory } from "../../inventoryHelper";
import { requireSpCompany, getSpAccount, parseNum } from "./spHelpers";

// ── Opening Stock ─────────────────────────────────────────────────────────

export function registerSpOpeningStockRoutes(app: Express) {
  app.get("/api/sp/opening-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const rows = await db.execute(
        sql`SELECT * FROM sp_stock_movements WHERE company_id = ${companyId} AND source_type = 'opening' ORDER BY created_at DESC`
      );
      res.json((rows as any).rows ?? (rows as any));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/opening-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { articleCode, stockItemId, qty, baseUnitCostUsd, landedUnitCostUsd, finalUnitCostUsd, locationId, notes } =
        req.body;

      if (!articleCode) return res.status(400).json({ message: "articleCode required" });
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

      const finalTotal = qtyNum * finalUC;
      const baseTotal = qtyNum * baseUC;
      const landTotal = qtyNum * landUC;

      const result = await db.transaction(async (tx) => {
        const [movement] = await tx
          .insert(spStockMovements)
          .values({
            companyId,
            sourceType: "opening",
            articleCode,
            description: notes || null,
            stockItemId: stockItemId ? parseInt(stockItemId) : null,
            locationId: locId,
            qtyIn: String(qtyNum),
            qtyRemaining: String(qtyNum),
            baseUnitCostUsd: String(baseUC),
            landedUnitCostUsd: String(landUC),
            finalUnitCostUsd: String(finalUC),
          })
          .returning();

        if (stockItemId && locId) {
          try {
            await adjustInventory(tx, locId, parseInt(stockItemId), qtyNum, companyId);
          } catch {
            /* non-blocking */
          }
        }

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherType: "Journal",
            voucherNumber: `SP-OPNSTK-${movement.id}-${Date.now()}`,
            voucherDate: new Date().toISOString().slice(0, 10),
            description: `Opening stock — ${articleCode} (${qtyNum} units)`,
            totalAmount: String(finalTotal),
            currency: "USD",
            exchangeRate: "1",
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
        // Cr SP-OPNBAL = landTotal (opening equity source for landed portion)
        if (landTotal > 0.00001) {
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: opnBalAcct.id,
            debitAmount: "0",
            creditAmount: String(landTotal),
            narration: `Opening stock landed clearing — ${articleCode}`,
          });
        } else if (Math.abs(finalTotal - baseTotal) > 0.00001) {
          // finalUC was set manually different from base+landed=0, route difference to opnbal
          const diff = finalTotal - baseTotal;
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: opnBalAcct.id,
            debitAmount: diff < 0 ? String(Math.abs(diff)) : "0",
            creditAmount: diff >= 0 ? String(diff) : "0",
            narration: `Opening stock cost adjustment — ${articleCode}`,
          });
        }

        return { movement, voucherId: voucher.id };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
