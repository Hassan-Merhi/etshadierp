/**
 * containerOffloadRoutes: ContainerOffloadCreate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { getClientDate } from "../../../lib/dateUtils";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { storage } from "../../../storage";
import { requireAuth, requireNonPOS } from "../../../auth";
import {
  containerOffloads,
  containerOffloadItems,
  offloadRequestSchema,
  purchaseOrders,
  vouchers,
  voucherEntries,
  ledgerAccounts,
} from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { reverseInventoryByExactValue } from "../../../inventoryHelper";
import { syncSalesItemCostsForStockItems } from "../../../services/syncSalesItemCosts";
import { firstRow } from "../../../lib/queryResult";

export function registerContainerOffloadCreateRoutes(app: Express) {
  app.post("/api/containers/:id/offload", requireAuth, requireNonPOS, async (req, res) => {
    const _t = Date.now();
    const _uid = (req as any).user?.id;
    const _cid = req.session.currentCompanyId;
    logger.info("Container offload started", {
      module: "containers",
      action: "offload",
      userId: _uid,
      companyId: _cid,
      containerId: req.params.id,
    });
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      // Validate request body
      const validation = offloadRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: validation.error.issues,
        });
      }

      const {
        locationId,
        offloadDate,
        duties,
        dutiesAccountId,
        officeCharges,
        officeChargesAccountId,
        officeChargesCashAccountId,
        transferCharges,
        transportFees,
        transportAccountId,
        additionalCharges = [],
        inventoryCostCorrections = [],
        agentChargeLines = [],
      } = validation.data;

      // Validate container exists
      const container = await storage.getContainerById(containerId);
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      // Check if this is an edit (container already offloaded)
      const isEdit = container.status === "OFFLOADED";

      if (isEdit) {
        // For edits, first reverse the existing offload
        const [existingOffload] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        if (existingOffload) {
          // Reverse inventory changes + delete old records atomically.
          // Prefer stored containerOffloadItems (exact quantities that were actually offloaded)
          // to avoid discrepancies when PO line items were edited after the original offload.
          const storedOffloadItems = await db
            .select()
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, existingOffload.id));

          await db.transaction(async (tx) => {
            if (storedOffloadItems.length > 0) {
              for (const offloadItem of storedOffloadItems) {
                await reverseInventoryByExactValue(
                  tx,
                  existingOffload.locationId,
                  offloadItem.stockItemId,
                  parseFloat(offloadItem.quantity),
                  parseFloat(offloadItem.totalValue)
                );
              }
            } else {
              const pos = await storage.getPurchaseOrdersByContainer(containerId);
              const allLineItems: any[] = [];
              for (const po of pos) {
                const lineItems = await storage.getLineItemsByPO(po.id);
                allLineItems.push(...lineItems);
              }
              const legacyAdditionalCost = parseFloat(existingOffload.additionalCostPerBale || "0");
              const legacyItemsMap = new Map<number, { totalQuantity: number; weightedRateSum: number }>();
              for (const item of allLineItems) {
                const stockItemId = item.stockItemId;
                if (!stockItemId || stockItemId === 0) continue;
                const quantity = parseFloat(item.quantity);
                const rate = parseFloat(item.rate || "0");
                if (legacyItemsMap.has(stockItemId)) {
                  const existing = legacyItemsMap.get(stockItemId)!;
                  existing.totalQuantity += quantity;
                  existing.weightedRateSum += rate * quantity;
                } else {
                  legacyItemsMap.set(stockItemId, { totalQuantity: quantity, weightedRateSum: rate * quantity });
                }
              }
              for (const [stockItemId, data] of Array.from(legacyItemsMap)) {
                const estimatedValue = data.weightedRateSum + data.totalQuantity * legacyAdditionalCost;
                await reverseInventoryByExactValue(
                  tx,
                  existingOffload.locationId,
                  stockItemId,
                  data.totalQuantity,
                  estimatedValue
                );
              }
            }

            // Delete stored offload items so they don't persist after reversal
            await tx.delete(containerOffloadItems).where(eq(containerOffloadItems.offloadId, existingOffload.id));

            const containerDescPattern = `%container ${container.containerNumber}%`;
            const oldVouchers = await tx
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, container.companyId),
                  sql`(
                      (
                        LOWER(${vouchers.description}) LIKE LOWER(${containerDescPattern})
                        AND (
                          ${vouchers.voucherNumber} LIKE 'DUTY-%' OR
                          ${vouchers.voucherNumber} LIKE 'OFFICE-%' OR
                          ${vouchers.voucherNumber} LIKE 'TRANS-%' OR
                          ${vouchers.voucherNumber} LIKE 'CHG-%' OR
                          ${vouchers.voucherNumber} LIKE 'XFER-%'
                        )
                      )
                      OR ${vouchers.voucherNumber} LIKE ${"SP-OTW-REV-ERP-" + containerId + "-%"}
                      OR ${vouchers.voucherNumber} LIKE ${"SP-STOCK-ERP-" + containerId + "-%"}
                      OR ${vouchers.voucherNumber} LIKE ${"SP-AGENT-SETTLE-" + containerId + "-%"}
                    )`
                )
              );

            for (const voucher of oldVouchers) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
              await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
            }

            // Also delete HADI L'SHI side SP agent vouchers (companyId=1) for this container
            const hadiAgentVouchers = await tx
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, 1),
                  sql`${vouchers.voucherNumber} LIKE ${"SP-AGENT-ERP-" + containerId + "-%"}`
                )
              );
            for (const v of hadiAgentVouchers) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
              await tx.delete(vouchers).where(eq(vouchers.id, v.id));
            }

            await tx.delete(containerOffloads).where(eq(containerOffloads.id, existingOffload.id));
          });
        }

        // Set status back to OTW so offloadContainer can proceed
        await storage.updateContainer(containerId, { status: "OTW" });
      }

      // Perform offload
      const offload = await storage.offloadContainer(
        containerId,
        locationId,
        duties,
        dutiesAccountId,
        officeCharges,
        officeChargesAccountId,
        officeChargesCashAccountId,
        transferCharges,
        transportFees,
        transportAccountId,
        additionalCharges,
        offloadDate || getClientDate(req),
        inventoryCostCorrections
      );

      // ── SP company: all SP-specific journals in one atomic transaction ──
      // Detect company type first (outside the tx — read-only, no side effects)
      const spCompanyRow = await db.execute(
        sql`SELECT company_type FROM companies WHERE id = ${container.companyId} LIMIT 1`
      );
      const spCompanyType = firstRow(spCompanyRow)?.company_type ?? (spCompanyRow as any)[0]?.company_type;
      const isSpCompany = spCompanyType === "supplier_partner";

      if (isSpCompany) {
        const vDate = offloadDate || getClientDate(req);
        const validAgentLines = agentChargeLines.filter((l) => l.amountUsd > 0);
        const totalAgentAmt = validAgentLines.reduce((s, l) => s + l.amountUsd, 0);
        // Use the container's stored grand total as the authoritative OTW amount.
        // Avoids computing from PO columns (which had issues with closure capture inside tx).
        const totalOtw = parseFloat(container.grandTotal || "0");

        // Pre-fetch all required ledger accounts in parallel (outside tx)
        const [otwAcct, otwClrAcct, spStockAcct, spCostClrAcct, hadiSpInterco, spHadiIcAcct, spPrepaidExpAcct] =
          await Promise.all([
            db
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, container.companyId),
                  eq(ledgerAccounts.subType, "sp_goods_otw"),
                  isNull(ledgerAccounts.deletedAt)
                )
              )
              .then((r) => r[0]),
            db
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, container.companyId),
                  eq(ledgerAccounts.subType, "sp_otw_clearing"),
                  isNull(ledgerAccounts.deletedAt)
                )
              )
              .then((r) => r[0]),
            db
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, container.companyId),
                  eq(ledgerAccounts.subType, "sp_stock"),
                  isNull(ledgerAccounts.deletedAt)
                )
              )
              .then((r) => r[0]),
            db
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.companyId, container.companyId),
                  eq(ledgerAccounts.subType, "sp_cost_clearing"),
                  isNull(ledgerAccounts.deletedAt)
                )
              )
              .then((r) => r[0]),
            validAgentLines.length > 0
              ? db
                  .select()
                  .from(ledgerAccounts)
                  .where(
                    and(
                      eq(ledgerAccounts.companyId, 1),
                      eq(ledgerAccounts.subType, "hadi_sp_intercompany"),
                      isNull(ledgerAccounts.deletedAt)
                    )
                  )
                  .then((r) => r[0])
              : Promise.resolve(undefined),
            validAgentLines.length > 0
              ? db
                  .select()
                  .from(ledgerAccounts)
                  .where(
                    and(
                      eq(ledgerAccounts.companyId, container.companyId),
                      eq(ledgerAccounts.subType, "sp_hadi_intercompany"),
                      isNull(ledgerAccounts.deletedAt)
                    )
                  )
                  .then((r) => r[0])
              : Promise.resolve(undefined),
            validAgentLines.length > 0
              ? db
                  .select()
                  .from(ledgerAccounts)
                  .where(
                    and(
                      eq(ledgerAccounts.companyId, container.companyId),
                      eq(ledgerAccounts.subType, "sp_prepaid_expenses"),
                      isNull(ledgerAccounts.deletedAt)
                    )
                  )
                  .then((r) => r[0])
              : Promise.resolve(undefined),
          ]);

        if (!otwAcct || !otwClrAcct) {
          throw new Error("SP OTW accounts not found. Run SP Setup first.");
        }
        if (!spStockAcct || !spCostClrAcct) {
          throw new Error("SP Stock / Cost Clearing accounts not found. Run SP Setup first.");
        }
        if (validAgentLines.length > 0) {
          if (!hadiSpInterco) throw new Error("HADI L'SHI intercompany account not found. Contact admin.");
          if (!spHadiIcAcct) throw new Error("SP intercompany account (SP-HADI-IC) not found. Run SP Setup first.");
          if (!spPrepaidExpAcct) throw new Error("SP Prepaid Expenses account not found. Run SP Setup first.");
        }

        // ── Single transaction: Voucher A + agent journals ──
        // Note: Voucher B (Dr sp_stock / Cr sp_cost_clearing) in the native SP offload
        // creates a stock asset. For ERP containers, inventory is managed through
        // storage.offloadContainer (bales/products tables), so no separate stock ledger
        // entry is needed — sp_goods_otw and sp_otw_clearing are fully cleared by Voucher A.
        await db.transaction(async (tx) => {
          // ── Voucher A: Reverse Goods OTW (clears OTW asset + OTW Clearing liability) ──
          // OTW Clearing Dr lines carry supplierId → zeroes the supplier sub-ledger balance.
          // Mirrors the same step in POST /api/sp/offload for native SP containers.
          if (totalOtw > 0) {
            const [voucherA] = await tx
              .insert(vouchers)
              .values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-OTW-REV-ERP-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Goods OTW Reversal — ERP container #${containerId}`,
                totalAmount: String(totalOtw),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();

            // Dr OTW Clearing per PO (with supplierId — zeroes supplier sub-ledger balance).
            // Re-query POs INSIDE the transaction to avoid closure-capture issues with the
            // outer pos variable that caused the loop to silently produce zero rows.
            const txPos = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.containerId, containerId));

            const calcPoTotal = (po: any): number =>
              parseFloat(po.itemsTotal || "0") +
              parseFloat(po.freight || "0") +
              parseFloat(po.otherCharges || "0") +
              parseFloat(po.surcharge || "0") +
              parseFloat(po.fumigation || "0") +
              parseFloat(po.documentCharges || "0") -
              parseFloat(po.discount || "0");

            if (txPos.length === 0) {
              // Fallback: single Dr entry for full totalOtw with no supplierId
              await tx.insert(voucherEntries).values({
                voucherId: voucherA.id,
                ledgerAccountId: otwClrAcct.id,
                supplierId: null,
                debitAmount: String(totalOtw),
                creditAmount: "0",
                narration: `OTW Clearing reversal — ERP container #${containerId}`,
              });
            } else {
              for (const po of txPos) {
                const poTotal = calcPoTotal(po);
                if (poTotal <= 0) continue;
                await tx.insert(voucherEntries).values({
                  voucherId: voucherA.id,
                  ledgerAccountId: otwClrAcct.id,
                  supplierId: po.supplierId || null,
                  debitAmount: String(poTotal),
                  creditAmount: "0",
                  narration: `OTW Clearing reversal — ERP container #${containerId}`,
                });
              }
            }

            // Cr Goods OTW (full total — reduces the OTW asset to zero)
            await tx.insert(voucherEntries).values({
              voucherId: voucherA.id,
              ledgerAccountId: otwAcct.id,
              debitAmount: "0",
              creditAmount: String(totalOtw),
              narration: `Goods OTW reversal — ERP container #${containerId}`,
            });

            // ── Voucher B: Recognise goods cost (Dr sp_stock / Cr sp_cost_clearing) ──
            // Mirrors the exact same step in POST /api/sp/offload.
            // Dr sp_stock: marks the base goods value as stock on floor.
            // Cr sp_cost_clearing: records the corresponding cost payable to HADI.
            // (Inventory quantity is also tracked in bales via storage.offloadContainer.)
            const [voucherB] = await tx
              .insert(vouchers)
              .values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-STOCK-ERP-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Stock cost recognition — ERP container #${containerId}`,
                totalAmount: String(totalOtw),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();
            // Dr sp_stock (goods now on floor)
            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: spStockAcct.id,
              debitAmount: String(totalOtw),
              creditAmount: "0",
              narration: `Stock on floor — ERP container #${containerId}`,
            });
            // Cr sp_cost_clearing (base cost payable to HADI)
            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: spCostClrAcct.id,
              debitAmount: "0",
              creditAmount: String(totalOtw),
              narration: `Base goods cost payable — ERP container #${containerId}`,
            });
          }

          // ── Agent settlement journals (only when agent charges exist) ──
          if (validAgentLines.length > 0 && spHadiIcAcct && spPrepaidExpAcct && hadiSpInterco) {
            // Journal in SP Test Co: Dr SP-HADI-IC / Cr SP-PREEXP
            const [settlementVoucher] = await tx
              .insert(vouchers)
              .values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-AGENT-SETTLE-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Agent charge settlement via HADI L'SHI — container #${containerId}`,
                totalAmount: String(totalAgentAmt),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();
            await tx.insert(voucherEntries).values({
              voucherId: settlementVoucher.id,
              ledgerAccountId: spHadiIcAcct.id,
              debitAmount: String(totalAgentAmt),
              creditAmount: "0",
              narration: `Agent charges via HADI L'SHI — ERP container #${containerId}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: settlementVoucher.id,
              ledgerAccountId: spPrepaidExpAcct.id,
              debitAmount: "0",
              creditAmount: String(totalAgentAmt),
              narration: `Prepaid expenses used for agent charges — ERP container #${containerId}`,
            });

            // Voucher C in HADI L'SHI: Dr HADI-SP-IC / Cr Agent (per line)
            const [voucherC] = await tx
              .insert(vouchers)
              .values({
                companyId: 1,
                voucherType: "Journal",
                voucherNumber: `SP-AGENT-ERP-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Agent charges for ERP offload — container #${containerId}`,
                totalAmount: String(totalAgentAmt),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();
            await tx.insert(voucherEntries).values({
              voucherId: voucherC.id,
              ledgerAccountId: hadiSpInterco.id,
              debitAmount: String(totalAgentAmt),
              creditAmount: "0",
              narration: `ERP container offload agent charges — container #${containerId}`,
            });
            for (const line of validAgentLines) {
              await tx.insert(voucherEntries).values({
                voucherId: voucherC.id,
                ledgerAccountId: line.parentAgentAccountId,
                debitAmount: "0",
                creditAmount: String(line.amountUsd),
                narration: `Agent credit for ERP container #${containerId}${line.description ? ` — ${line.description}` : ""}`,
              });
            }
          }
        });
      }

      logger.info("Container offload succeeded", {
        module: "containers",
        action: "offload",
        userId: _uid,
        companyId: _cid,
        containerId: req.params.id,
        durationMs: Date.now() - _t,
      });
      res.json(offload);

      // ── Part A: sync sales_items costs after offload (fire-and-forget) ──
      // The offload transaction just updated inventory.averageRate for all
      // affected stock items. Propagate those updated rates into existing
      // sales_items so the Sales Report reflects the correct landed cost.
      Promise.resolve().then(async () => {
        try {
          const offloadItems = await db
            .select({ stockItemId: containerOffloadItems.stockItemId })
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, offload.id));

          const stockItemIds = [...new Set(offloadItems.map((i) => i.stockItemId))];
          if (stockItemIds.length === 0) return;

          const result = await syncSalesItemCostsForStockItems(container.companyId, offload.locationId, stockItemIds);
          if (result.updatedCount > 0) {
            logger.info("Sales item costs synced after container offload", {
              module: "containers",
              action: "sync-sales-costs",
              containerId,
              locationId: offload.locationId,
              stockItemIds,
              updatedSalesItems: result.updatedCount,
            });
          }
        } catch (syncErr: unknown) {
          // Non-fatal — the offload itself succeeded; log and move on.
          logger.error("Failed to sync sales item costs after offload (non-fatal)", {
            module: "containers",
            action: "sync-sales-costs",
            containerId,
            error: getErrorMessage(syncErr),
          });
        }
      });
    } catch (error: unknown) {
      logger.error("Container offload failed", {
        module: "containers",
        action: "offload",
        userId: _uid,
        companyId: _cid,
        containerId: req.params.id,
        durationMs: Date.now() - _t,
        error,
      });
      logger.error("Container offload error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
