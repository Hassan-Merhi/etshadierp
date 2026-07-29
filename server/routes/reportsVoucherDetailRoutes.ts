import type { Express } from "express";

import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { requireAuth } from "../auth";
import { db } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import {
  ledgerAccounts,
  poLineItems,
  posShifts,
  purchaseOrders,
  salesItems,
  stockItems,
  suppliers,
  voucherEntries,
  vouchers,
} from "@shared/schema";

export function registerReportsVoucherDetailRoutes(app: Express) {
  app.get("/api/voucher-detail/:voucherId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const voucherId = parseInt(req.params.voucherId);
      if (isNaN(voucherId)) return res.status(400).json({ message: "Invalid voucher ID" });

      const voucher = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)))
        .execute()
        .then((rows) => rows[0]);
      if (!voucher) return res.status(404).json({ message: "Voucher not found" });

      if (req.user?.role === "POS" && voucher.voucherType === "Sales") {
        const [ownedShift] = voucher.shiftId
          ? await db
              .select({ id: posShifts.id })
              .from(posShifts)
              .where(and(eq(posShifts.id, voucher.shiftId), eq(posShifts.userId, req.user.id)))
              .limit(1)
          : [];
        if (!ownedShift) return res.status(403).json({ message: "Access denied" });
      }

      let partyName: string | null = null;
      const supplierEntry = await db
        .select({ supplierId: voucherEntries.supplierId })
        .from(voucherEntries)
        .where(and(eq(voucherEntries.voucherId, voucherId), isNotNull(voucherEntries.supplierId)))
        .execute()
        .then((rows) => rows[0]);
      if (supplierEntry?.supplierId) {
        const supplier = await db
          .select({ legalName: suppliers.legalName })
          .from(suppliers)
          .where(eq(suppliers.id, supplierEntry.supplierId))
          .execute()
          .then((rows) => rows[0]);
        partyName = supplier?.legalName || null;
      }

      const purchaseEntry = await db
        .select({ name: ledgerAccounts.name })
        .from(voucherEntries)
        .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
        .where(
          and(
            eq(voucherEntries.voucherId, voucherId),
            or(eq(ledgerAccounts.code, "PURCHASES"), sql`${ledgerAccounts.code} LIKE 'PURCHASES-%'`)
          )
        )
        .execute()
        .then((rows) => rows[0]);

      const salesItemsData = await db
        .select({
          id: salesItems.id,
          stockItemId: salesItems.stockItemId,
          quantity: salesItems.quantity,
          rate: salesItems.sellingPrice,
          total: salesItems.totalSales,
        })
        .from(salesItems)
        .where(eq(salesItems.voucherId, voucherId))
        .execute();

      const poItemsData = await db
        .select({
          id: poLineItems.id,
          stockItemId: poLineItems.stockItemId,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          total: poLineItems.lineTotal,
        })
        .from(poLineItems)
        .innerJoin(purchaseOrders, eq(poLineItems.poId, purchaseOrders.id))
        .where(eq(purchaseOrders.voucherId, voucherId))
        .execute();

      const items = await Promise.all(
        [...salesItemsData, ...poItemsData].map(async (item) => {
          const stockItem = item.stockItemId
            ? await db
                .select({ name: stockItems.name, code: stockItems.code, uom: stockItems.uom })
                .from(stockItems)
                .where(eq(stockItems.id, item.stockItemId))
                .execute()
                .then((rows) => rows[0])
            : null;
          return {
            id: item.id,
            stockItemId: item.stockItemId,
            stockItemName: stockItem?.name || "Unknown Item",
            stockItemCode: stockItem?.code || "",
            quantity: parseFloat(item.quantity || "0"),
            unit: stockItem?.uom || "BL",
            rate: parseFloat(item.rate || "0"),
            amount: parseFloat(item.total || "0"),
          };
        })
      );

      const entriesData = await db
        .select({
          id: voucherEntries.id,
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, voucherId))
        .execute();

      const entries = await Promise.all(
        entriesData.map(async (entry) => {
          const ledger = entry.ledgerAccountId
            ? await db
                .select({ name: ledgerAccounts.name })
                .from(ledgerAccounts)
                .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
                .execute()
                .then((rows) => rows[0])
            : null;
          return {
            id: entry.id,
            ledgerAccountId: entry.ledgerAccountId || 0,
            ledgerAccountName: ledger?.name || "Unknown Account",
            debitAmount: parseFloat(entry.debitAmount || "0"),
            creditAmount: parseFloat(entry.creditAmount || "0"),
            narration: entry.narration,
          };
        })
      );

      res.json({
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        voucherType: voucher.voucherType,
        date: voucher.voucherDate,
        partyName,
        purchaseLedger: purchaseEntry?.name || null,
        locationName: voucher.locationName || null,
        narration: voucher.description,
        supplierInvoiceNo: null,
        items,
        entries,
        totals: {
          quantity: items.reduce((sum, item) => sum + item.quantity, 0),
          amount: items.reduce((sum, item) => sum + item.amount, 0),
          debit: entries.reduce((sum, entry) => sum + entry.debitAmount, 0),
          credit: entries.reduce((sum, entry) => sum + entry.creditAmount, 0),
        },
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
