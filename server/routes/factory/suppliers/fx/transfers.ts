/**
 * supplierFxRoutes: SupplierFxTransfer endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { parseId } from "../../../../lib/parseId";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { getClientDate } from "../../../../lib/dateUtils";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { writeDaybookEntry } from "../../_helpers";
import {
  factorySuppliers,
  factoryContainers,
  factoryContainerCommissions,
  factoryDaybookEntries,
  factorySupplierPayments,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

export function registerSupplierFxTransferRoutes(app: Express) {
  app.get("/api/factory/supplier-fx-transfers", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId))
        .orderBy(desc(factorySupplierFxTransfers.date));
      res.json(transfers);
    } catch (error: unknown) {
      logger.error("Error fetching FX transfers:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/supplier-fx-transfers", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierFxTransferSchema.parse({ ...req.body, companyId });

      // Validate both suppliers exist and belong to this company
      const [fromSupplier] = await db
        .select({ id: factorySuppliers.id, name: factorySuppliers.name, parentId: factorySuppliers.parentId })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.fromSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!fromSupplier) return res.status(404).json({ message: "From-supplier not found" });

      const [toSupplier] = await db
        .select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.toSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!toSupplier) return res.status(404).json({ message: "To-supplier not found" });

      // ── Balance validation (Phase 3) ─────────────────────────────────────────
      const currCode = parsed.fromCurrencyCode;
      const fromSupId = parsed.fromSupplierId;
      const sourceType = parsed.sourceType || "supplier";

      // 1a. Containers for this supplier in this currency (for supplier-bucket validation)
      const contRowsInCurrency = await db
        .select({
          finalPayableAmount: factoryContainers.finalPayableAmount,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          freight: factoryContainers.freight,
          id: factoryContainers.id,
        })
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            eq(factoryContainers.supplierId, fromSupId),
            eq(factoryContainers.currencyCode, currCode)
          )
        );

      const containerIds = contRowsInCurrency.map((c) => c.id);
      const totalValue = contRowsInCurrency.reduce((s: number, c) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const freight = parseFloat(c.freight || "0");
        return s + (kg * rate + freight);
      }, 0);

      // 1b. For commission validation: ALL containers for this supplier (commission may be in a
      //     different currency than the container, e.g. EUR container with USD commission).
      const allContainerIds: number[] = containerIds.slice(); // start with same-currency containers
      if (sourceType === "commission" || sourceType === "both") {
        const allContRows = await db
          .select({ id: factoryContainers.id })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, fromSupId)));
        for (const c of allContRows) {
          if (!allContainerIds.includes(c.id)) allContainerIds.push(c.id);
        }
      }

      // 2. Commissions from factoryContainerCommissions for relevant containers,
      //    filtered by commission currency code (handles cross-currency commissions).
      let totalCommission = 0;
      if (allContainerIds.length > 0) {
        const commRows = await db
          .select({
            commissionTotal: factoryContainerCommissions.commissionTotal,
            currencyCode: factoryContainerCommissions.currencyCode,
          })
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              inArray(factoryContainerCommissions.containerId, allContainerIds)
            )
          );
        // Only count commissions denominated in the transfer currency
        totalCommission = commRows
          .filter((cm) => (cm.currencyCode || "USD") === currCode)
          .reduce((s: number, cm) => s + parseFloat(cm.commissionTotal || "0"), 0);

        // Also include direct commissions from containers (commissionAmount / commissionCurrencyCode)
        if (sourceType === "commission" || sourceType === "both") {
          const directRows = await db
            .select({
              commissionAmount: factoryContainers.commissionAmount,
              commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
            })
            .from(factoryContainers)
            .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, fromSupId)));
          const directAmt = directRows
            .filter((r) => (r.commissionCurrencyCode || "USD") === currCode)
            .reduce((s: number, r) => s + parseFloat(r.commissionAmount || "0"), 0);
          // Use whichever is larger (factoryContainerCommissions may supersede commissionAmount)
          if (directAmt > totalCommission) totalCommission = directAmt;
        }
      }

      // 3. Payments in this currency
      const payRows = await db
        .select({ amount: factorySupplierPayments.amount })
        .from(factorySupplierPayments)
        .where(
          and(
            eq(factorySupplierPayments.companyId, companyId),
            eq(factorySupplierPayments.supplierId, fromSupId),
            eq(factorySupplierPayments.currencyCode, currCode)
          )
        );
      const totalPaid = payRows.reduce((s: number, p) => s + parseFloat(p.amount || "0"), 0);

      // 4. Existing FX transfers out for this supplier + currency
      const fxRows = await db
        .select({
          fromAmount: factorySupplierFxTransfers.fromAmount,
          sourceType: factorySupplierFxTransfers.sourceType,
        })
        .from(factorySupplierFxTransfers)
        .where(
          and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            eq(factorySupplierFxTransfers.fromSupplierId, fromSupId),
            eq(factorySupplierFxTransfers.fromCurrencyCode, currCode)
          )
        );

      // FX deducted from supplier bucket (source = supplier or both)
      const fxSupplierOut = fxRows
        .filter((t) => !t.sourceType || t.sourceType === "supplier" || t.sourceType === "both")
        .reduce((s: number, t) => s + parseFloat(t.fromAmount || "0"), 0);
      // FX deducted from commission bucket (source = commission or both)
      const fxCommOut = fxRows
        .filter((t) => t.sourceType === "commission" || t.sourceType === "both")
        .reduce((s: number, t) => s + parseFloat(t.fromAmount || "0"), 0);

      const supplierAvail = totalValue - totalCommission - totalPaid - fxSupplierOut;
      const commAvail = totalCommission - fxCommOut;

      let available: number;
      if (sourceType === "commission") {
        available = commAvail;
      } else if (sourceType === "both") {
        available = supplierAvail + commAvail;
      } else {
        available = supplierAvail; // "supplier" (default)
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Overpayments are allowed — the remaining balance will go negative (CR),
      // visible on the statement so the company knows the supplier owes money back.

      const [created] = await db.insert(factorySupplierFxTransfers).values(parsed).returning();

      // ── Phase 1: Oldest-first allocation persistence ──────────────────────────
      // Allocate this FX transfer against containers ordered by creation date
      try {
        const allContainers = await db
          .select({
            id: factoryContainers.id,
            finalPayableAmount: factoryContainers.finalPayableAmount,
            actualReceivedKg: factoryContainers.actualReceivedKg,
            totalKg: factoryContainers.totalKg,
            ratePerKg: factoryContainers.ratePerKg,
            freight: factoryContainers.freight,
          })
          .from(factoryContainers)
          .where(
            and(
              eq(factoryContainers.companyId, companyId),
              eq(factoryContainers.supplierId, fromSupId),
              eq(factoryContainers.currencyCode, currCode)
            )
          )
          .orderBy(factoryContainers.createdAt); // oldest first

        const cIds = allContainers.map((c) => c.id);
        const prevAllocs =
          cIds.length > 0
            ? await db
                .select({
                  containerId: factoryFxAllocations.containerId,
                  allocatedAmount: factoryFxAllocations.allocatedAmount,
                })
                .from(factoryFxAllocations)
                .where(
                  and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, cIds))
                )
            : [];

        const allocatedPerContainer: Record<number, number> = {};
        for (const a of prevAllocs)
          allocatedPerContainer[a.containerId] =
            (allocatedPerContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

        let rem = parseFloat(created.fromAmount);
        const rows = [];
        for (const c of allContainers) {
          if (rem <= 0.001) break;
          // Use totalKg (agreed weight) for FX allocation ceiling — same as supplier balance.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const val = kg * rate + freight;
          const used = allocatedPerContainer[c.id] || 0;
          const avail = Math.max(0, val - used);
          if (avail <= 0.001) continue;
          const toAlloc = Math.min(rem, avail);
          rows.push({
            companyId,
            fxTransferId: created.id,
            containerId: c.id,
            sourceType: created.sourceType || "supplier",
            allocatedAmount: toAlloc.toFixed(4),
            currencyCode: currCode,
          });
          rem -= toAlloc;
        }
        if (rows.length > 0) await db.insert(factoryFxAllocations).values(rows);
      } catch (allocErr) {
        logger.error("FX allocation error (non-fatal):", { error: allocErr });
      }
      // ─────────────────────────────────────────────────────────────────────────

      const transferKind = created.sourceType === "commission" ? "Commission Transfer" : "FX Transfer";
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_FX_TRANSFER",
        referenceId: created.id,
        referenceTable: "factory_supplier_fx_transfers",
        description: `${transferKind}: ${fromSupplier.name} ${created.fromCurrencyCode} ${parseFloat(created.fromAmount).toFixed(2)} → ${toSupplier.name} USD ${parseFloat(created.toAmountUsd).toFixed(2)}`,
        amountCurrency: parseFloat(created.fromAmount),
        amountUsd: parseFloat(created.toAmountUsd),
        currencyCode: created.fromCurrencyCode,
        effectiveDate: (req.body.effectiveDate as string) || null,
      });

      res.json(created);
    } catch (error: unknown) {
      logger.error("Error creating FX transfer:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/factory/supplier-fx-transfers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [transfer] = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      // Cascade-delete allocation rows before removing the transfer
      await db
        .delete(factoryFxAllocations)
        .where(and(eq(factoryFxAllocations.fxTransferId, id), eq(factoryFxAllocations.companyId, companyId)));

      await db
        .delete(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));

      // Remove the original daybook entry that was written when this transfer was created.
      // Without this, the SUPPLIER_FX_TRANSFER row lingers in the daybook even after deletion.
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "SUPPLIER_FX_TRANSFER"),
            eq(factoryDaybookEntries.referenceId, id)
          )
        );

      await writeDaybookEntry(db, {
        companyId,
        txDate: getClientDate(req),
        txType: "SUPPLIER_FX_TRANSFER_DELETE",
        description: `FX Transfer deleted: ${transfer.fromCurrencyCode} ${parseFloat(transfer.fromAmount).toFixed(2)} → USD ${parseFloat(transfer.toAmountUsd).toFixed(2)} (dated ${transfer.date})`,
      });

      res.json({ message: "FX transfer deleted" });
    } catch (error: unknown) {
      logger.error("Error deleting FX transfer:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
