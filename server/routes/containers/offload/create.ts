/**
 * containerOffloadRoutes: ContainerOffloadCreate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import type Decimal from "decimal.js";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { getClientDate } from "../../../lib/dateUtils";
import { logger } from "../../../lib/logger";
import {
  addInventoryValues,
  inventoryMoney,
  multiplyInventoryValues,
  subtractInventoryValues,
  toInventoryDecimal,
} from "../../../lib/inventoryMath";
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
    const startedAt = Date.now();
    const userId = req.user?.id;
    const sessionCompanyId = req.session.currentCompanyId;
    logger.info("Container offload started", {
      module: "containers",
      action: "offload",
      userId,
      companyId: sessionCompanyId,
      containerId: req.params.id,
    });

    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      const validation = offloadRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Validation failed", errors: validation.error.issues });
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

      const container = await storage.getContainerById(containerId);
      if (!container) return res.status(404).json({ message: "Container not found" });

      const isEdit = container.status === "OFFLOADED";
      if (isEdit) {
        const [existingOffload] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        if (existingOffload) {
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
                  toInventoryDecimal(offloadItem.quantity).toNumber(),
                  toInventoryDecimal(offloadItem.totalValue).toNumber()
                );
              }
            } else {
              const pos = await storage.getPurchaseOrdersByContainer(containerId);
              const allLineItems = [];
              for (const po of pos) {
                const lineItems = await storage.getLineItemsByPO(po.id);
                allLineItems.push(...lineItems);
              }

              const legacyAdditionalCost = toInventoryDecimal(existingOffload.additionalCostPerBale);
              const legacyItemsMap = new Map<number, { totalQuantity: Decimal; weightedRateSum: Decimal }>();

              for (const item of allLineItems) {
                const stockItemId = item.stockItemId;
                if (!stockItemId || stockItemId === 0) continue;
                const quantity = toInventoryDecimal(item.quantity);
                const rate = toInventoryDecimal(item.rate);
                const weightedValue = multiplyInventoryValues(rate, quantity);
                const existing = legacyItemsMap.get(stockItemId);
                if (existing) {
                  existing.totalQuantity = addInventoryValues(existing.totalQuantity, quantity);
                  existing.weightedRateSum = addInventoryValues(existing.weightedRateSum, weightedValue);
                } else {
                  legacyItemsMap.set(stockItemId, {
                    totalQuantity: quantity,
                    weightedRateSum: weightedValue,
                  });
                }
              }

              for (const [stockItemId, data] of legacyItemsMap) {
                const estimatedValue = addInventoryValues(
                  data.weightedRateSum,
                  multiplyInventoryValues(data.totalQuantity, legacyAdditionalCost)
                );
                await reverseInventoryByExactValue(
                  tx,
                  existingOffload.locationId,
                  stockItemId,
                  data.totalQuantity.toNumber(),
                  estimatedValue.toNumber()
                );
              }
            }

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

            const hadiAgentVouchers = await tx
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, 1),
                  sql`${vouchers.voucherNumber} LIKE ${"SP-AGENT-ERP-" + containerId + "-%"}`
                )
              );
            for (const voucher of hadiAgentVouchers) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
              await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
            }

            await tx.delete(containerOffloads).where(eq(containerOffloads.id, existingOffload.id));
          });
        }

        await storage.updateContainer(containerId, { status: "OTW" });
      }

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

      const spCompanyRow = await db.execute(
        sql`SELECT company_type FROM companies WHERE id = ${container.companyId} LIMIT 1`
      );
      const spCompanyType =
        firstRow(spCompanyRow)?.company_type ??
        (spCompanyRow as unknown as { [key: string]: { company_type: unknown } })[0]?.company_type;
      const isSpCompany = spCompanyType === "supplier_partner";

      if (isSpCompany) {
        const voucherDate = offloadDate || getClientDate(req);
        const validAgentLines = agentChargeLines.filter((line) => toInventoryDecimal(line.amountUsd).isPositive());
        const totalAgentAmount = addInventoryValues(...validAgentLines.map((line) => line.amountUsd));
        const totalOtw = toInventoryDecimal(container.grandTotal);

        const [
          otwAccount,
          otwClearingAccount,
          spStockAccount,
          spCostClearingAccount,
          hadiSpInterco,
          spHadiIcAccount,
          spPrepaidExpenseAccount,
        ] = await Promise.all([
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
            .then((rows) => rows[0]),
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
            .then((rows) => rows[0]),
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
            .then((rows) => rows[0]),
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
            .then((rows) => rows[0]),
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
                .then((rows) => rows[0])
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
                .then((rows) => rows[0])
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
                .then((rows) => rows[0])
            : Promise.resolve(undefined),
        ]);

        if (!otwAccount || !otwClearingAccount) {
          throw new Error("SP OTW accounts not found. Run SP Setup first.");
        }
        if (!spStockAccount || !spCostClearingAccount) {
          throw new Error("SP Stock / Cost Clearing accounts not found. Run SP Setup first.");
        }
        if (validAgentLines.length > 0) {
          if (!hadiSpInterco) throw new Error("HADI L'SHI intercompany account not found. Contact admin.");
          if (!spHadiIcAccount) throw new Error("SP intercompany account (SP-HADI-IC) not found. Run SP Setup first.");
          if (!spPrepaidExpenseAccount) throw new Error("SP Prepaid Expenses account not found. Run SP Setup first.");
        }

        await db.transaction(async (tx) => {
          if (totalOtw.isPositive()) {
            const totalOtwAmount = inventoryMoney(totalOtw);
            const [voucherA] = await tx
              .insert(vouchers)
              .values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-OTW-REV-ERP-${containerId}-${Date.now()}`,
                voucherDate,
                description: `Goods OTW Reversal — ERP container #${containerId}`,
                totalAmount: totalOtwAmount,
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();

            const transactionPurchaseOrders = await tx
              .select()
              .from(purchaseOrders)
              .where(eq(purchaseOrders.containerId, containerId));

            const calculatePurchaseOrderTotal = (purchaseOrder: any) =>
              subtractInventoryValues(
                addInventoryValues(
                  purchaseOrder.itemsTotal,
                  purchaseOrder.freight,
                  purchaseOrder.otherCharges,
                  purchaseOrder.surcharge,
                  purchaseOrder.fumigation,
                  purchaseOrder.documentCharges
                ),
                purchaseOrder.discount
              );

            if (transactionPurchaseOrders.length === 0) {
              await tx.insert(voucherEntries).values({
                voucherId: voucherA.id,
                ledgerAccountId: otwClearingAccount.id,
                supplierId: null,
                debitAmount: totalOtwAmount,
                creditAmount: "0",
                narration: `OTW Clearing reversal — ERP container #${containerId}`,
              });
            } else {
              for (const purchaseOrder of transactionPurchaseOrders) {
                const purchaseOrderTotal = calculatePurchaseOrderTotal(purchaseOrder);
                if (!purchaseOrderTotal.isPositive()) continue;
                await tx.insert(voucherEntries).values({
                  voucherId: voucherA.id,
                  ledgerAccountId: otwClearingAccount.id,
                  supplierId: purchaseOrder.supplierId || null,
                  debitAmount: inventoryMoney(purchaseOrderTotal),
                  creditAmount: "0",
                  narration: `OTW Clearing reversal — ERP container #${containerId}`,
                });
              }
            }

            await tx.insert(voucherEntries).values({
              voucherId: voucherA.id,
              ledgerAccountId: otwAccount.id,
              debitAmount: "0",
              creditAmount: totalOtwAmount,
              narration: `Goods OTW reversal — ERP container #${containerId}`,
            });

            const [voucherB] = await tx
              .insert(vouchers)
              .values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-STOCK-ERP-${containerId}-${Date.now()}`,
                voucherDate,
                description: `Stock cost recognition — ERP container #${containerId}`,
                totalAmount: totalOtwAmount,
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();

            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: spStockAccount.id,
              debitAmount: totalOtwAmount,
              creditAmount: "0",
              narration: `Stock on floor — ERP container #${containerId}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: spCostClearingAccount.id,
              debitAmount: "0",
              creditAmount: totalOtwAmount,
              narration: `Base goods cost payable — ERP container #${containerId}`,
            });
          }

          if (validAgentLines.length > 0 && spHadiIcAccount && spPrepaidExpenseAccount && hadiSpInterco) {
            const totalAgentAmountString = inventoryMoney(totalAgentAmount);
            const [settlementVoucher] = await tx
              .insert(vouchers)
              .values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-AGENT-SETTLE-${containerId}-${Date.now()}`,
                voucherDate,
                description: `Agent charge settlement via HADI L'SHI — container #${containerId}`,
                totalAmount: totalAgentAmountString,
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();

            await tx.insert(voucherEntries).values({
              voucherId: settlementVoucher.id,
              ledgerAccountId: spHadiIcAccount.id,
              debitAmount: totalAgentAmountString,
              creditAmount: "0",
              narration: `Agent charges via HADI L'SHI — ERP container #${containerId}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: settlementVoucher.id,
              ledgerAccountId: spPrepaidExpenseAccount.id,
              debitAmount: "0",
              creditAmount: totalAgentAmountString,
              narration: `Prepaid expenses used for agent charges — ERP container #${containerId}`,
            });

            const [voucherC] = await tx
              .insert(vouchers)
              .values({
                companyId: 1,
                voucherType: "Journal",
                voucherNumber: `SP-AGENT-ERP-${containerId}-${Date.now()}`,
                voucherDate,
                description: `Agent charges for ERP offload — container #${containerId}`,
                totalAmount: totalAgentAmountString,
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              })
              .returning();

            await tx.insert(voucherEntries).values({
              voucherId: voucherC.id,
              ledgerAccountId: hadiSpInterco.id,
              debitAmount: totalAgentAmountString,
              creditAmount: "0",
              narration: `ERP container offload agent charges — container #${containerId}`,
            });

            for (const line of validAgentLines) {
              await tx.insert(voucherEntries).values({
                voucherId: voucherC.id,
                ledgerAccountId: line.parentAgentAccountId,
                debitAmount: "0",
                creditAmount: inventoryMoney(line.amountUsd),
                narration: `Agent credit for ERP container #${containerId}${line.description ? ` — ${line.description}` : ""}`,
              });
            }
          }
        });
      }

      logger.info("Container offload succeeded", {
        module: "containers",
        action: "offload",
        userId,
        companyId: sessionCompanyId,
        containerId: req.params.id,
        durationMs: Date.now() - startedAt,
      });
      res.json(offload);

      Promise.resolve().then(async () => {
        try {
          const offloadItems = await db
            .select({ stockItemId: containerOffloadItems.stockItemId })
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, offload.id));

          const stockItemIds = [...new Set(offloadItems.map((item) => item.stockItemId))];
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
        } catch (syncError: unknown) {
          logger.error("Failed to sync sales item costs after offload (non-fatal)", {
            module: "containers",
            action: "sync-sales-costs",
            containerId,
            error: getErrorMessage(syncError),
          });
        }
      });
    } catch (error: unknown) {
      logger.error("Container offload failed", {
        module: "containers",
        action: "offload",
        userId,
        companyId: sessionCompanyId,
        containerId: req.params.id,
        durationMs: Date.now() - startedAt,
        error,
      });
      logger.error("Container offload error:", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
