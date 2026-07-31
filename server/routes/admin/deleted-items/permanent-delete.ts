/**
 * deletedItemsRoutes: DeletedItemsPermanentDelete endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { requireAuth, requireNonPOS } from "../../../auth";
import {
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryRawMaterialAdjustments,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryBales,
  factoryContainerCommissions,
  factoryDutyAuditLog,
  factoryFxAllocations,
  factoryWasteEntries,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  proformaStockReservations,
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockTransferRevisionItems,
  stockGroupLocationArchiveItems,
  stockAdjustmentItems,
  containerOffloadItems,
  containerSales,
  bankAccounts,
  purchaseOrders,
  poLineItems,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  locations,
  employees,
  interCompanyTransfers,
  ledgerAccounts,
  fiscalPeriodClosures,
  wasteDispatches,
  wasteDispatchItems,
  creditNoteItems,
  salaryAdvances,
  employeeGroupMembers,
  employeeBaleRates,
  employeeBalePctRates,
  erpWorkerDocs,
  erpPayrollRunItems,
  propertyPayments,
  factoryTransporterTransactions,
} from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

export function registerDeletedItemsPermanentDeleteRoutes(app: Express) {
  // Permanently delete an item
  app.delete("/api/deleted-items/:type/:id/permanent", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const { type, id } = req.params;
      const itemId = parseInt(id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      switch (type) {
        case "location":
          await db.delete(locations).where(and(eq(locations.id, itemId), eq(locations.companyId, companyId)));
          break;
        case "stockItem":
          // Delete all FK-dependent rows before removing the stock item itself
          await db.delete(salesItems).where(eq(salesItems.stockItemId, itemId));
          await db.delete(stockAdjustmentItems).where(eq(stockAdjustmentItems.stockItemId, itemId));
          await db.delete(stockTransferItems).where(eq(stockTransferItems.stockItemId, itemId));
          await db.delete(stockTransferRevisionItems).where(eq(stockTransferRevisionItems.stockItemId, itemId));
          await db.delete(poLineItems).where(eq(poLineItems.stockItemId, itemId));
          await db.delete(containerOffloadItems).where(eq(containerOffloadItems.stockItemId, itemId));
          await db.delete(creditNoteItems).where(eq(creditNoteItems.stockItemId, itemId));
          await db.delete(inventory).where(eq(inventory.stockItemId, itemId));
          await db.delete(wasteDispatchItems).where(eq(wasteDispatchItems.stockItemId, itemId));
          await db.delete(stockGroupLocationArchiveItems).where(eq(stockGroupLocationArchiveItems.stockItemId, itemId));
          await db.delete(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, itemId));
          await db.delete(stockItemLocationPrices).where(eq(stockItemLocationPrices.stockItemId, itemId));
          await db.delete(stockItems).where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId)));
          break;
        case "stockGroup":
          await db.delete(stockGroups).where(and(eq(stockGroups.id, itemId), eq(stockGroups.companyId, companyId)));
          break;
        case "ledgerAccount":
          await db
            .delete(ledgerAccounts)
            .where(and(eq(ledgerAccounts.id, itemId), eq(ledgerAccounts.companyId, companyId)));
          break;
        case "employee":
          // Delete all FK-dependent rows before removing the employee
          await db.delete(employeeGroupMembers).where(eq(employeeGroupMembers.employeeId, itemId));
          await db.delete(employeeBaleRates).where(eq(employeeBaleRates.employeeId, itemId));
          await db.delete(employeeBalePctRates).where(eq(employeeBalePctRates.employeeId, itemId));
          await db.delete(salaryAdvances).where(eq(salaryAdvances.employeeId, itemId));
          await db.delete(erpWorkerDocs).where(eq(erpWorkerDocs.employeeId, itemId));
          await db.delete(erpPayrollRunItems).where(eq(erpPayrollRunItems.employeeId, itemId));
          // Null-out the optional employee FK on voucher entries (don't delete the vouchers)
          await db.update(voucherEntries).set({ employeeId: null }).where(eq(voucherEntries.employeeId, itemId));
          await db.delete(employees).where(and(eq(employees.id, itemId), eq(employees.companyId, companyId)));
          break;
        case "customer": {
          // Permanent customer delete — must clear all FK references first.
          // Use db.transaction() + tx.execute(sql`...`) matching the established
          // pattern in this file (pool.connect parameterized queries fail here).
          await db.transaction(async (tx) => {
            // 1. Null out nullable FKs (keep vouchers/bales intact)
            await tx.execute(sql`UPDATE voucher_entries SET customer_id = NULL WHERE customer_id = ${itemId}`);
            await tx.execute(sql`UPDATE bales SET customer_id = NULL WHERE customer_id = ${itemId}`);
            await tx.execute(sql`UPDATE factory_pos_sales SET customer_id = NULL WHERE customer_id = ${itemId}`);

            // 2. Delete dispatch sub-rows (deepest first)
            await tx.execute(sql`
              DELETE FROM customer_dispatch_bale_scans
              WHERE batch_id IN (SELECT id FROM customer_dispatch_batches WHERE customer_id = ${itemId})`);
            await tx.execute(sql`
              DELETE FROM customer_dispatch_truck_rides
              WHERE batch_id IN (SELECT id FROM customer_dispatch_batches WHERE customer_id = ${itemId})`);
            await tx.execute(sql`DELETE FROM customer_dispatch_batches WHERE customer_id = ${itemId}`);

            // 3. Delete invoice loading sessions
            await tx.execute(sql`DELETE FROM factory_invoice_loading_sessions WHERE customer_id = ${itemId}`);

            // 4. Delete container sales
            await tx.execute(sql`DELETE FROM container_sales WHERE customer_id = ${itemId}`);

            // 5. Delete customer order children then orders
            await tx.execute(sql`
              DELETE FROM customer_order_bales_history
              WHERE order_id IN (SELECT id FROM customer_orders WHERE customer_id = ${itemId})`);
            await tx.execute(sql`
              DELETE FROM customer_order_bales
              WHERE order_id IN (SELECT id FROM customer_orders WHERE customer_id = ${itemId})`);
            await tx.execute(sql`
              DELETE FROM customer_order_lines
              WHERE order_id IN (SELECT id FROM customer_orders WHERE customer_id = ${itemId})`);
            await tx.execute(sql`
              DELETE FROM customer_order_charges
              WHERE order_id IN (SELECT id FROM customer_orders WHERE customer_id = ${itemId})`);
            await tx.execute(sql`DELETE FROM customer_orders WHERE customer_id = ${itemId}`);

            // 6. Delete customer proforma children then proformas
            await tx.execute(sql`
              DELETE FROM proforma_stock_reservations
              WHERE proforma_id IN (SELECT id FROM customer_proformas WHERE customer_id = ${itemId})`);
            await tx.execute(sql`
              DELETE FROM customer_proforma_lines
              WHERE proforma_id IN (SELECT id FROM customer_proformas WHERE customer_id = ${itemId})`);
            await tx.execute(sql`DELETE FROM customer_proformas WHERE customer_id = ${itemId}`);

            // 7. Delete the customer (customerBalances + customerLogos cascade automatically)
            await tx.execute(sql`DELETE FROM customers WHERE id = ${itemId} AND company_id = ${companyId}`);
          });
          break;
        }
        case "supplier":
          await db.delete(suppliers).where(eq(suppliers.id, itemId));
          break;
        case "bankAccount":
          await db.delete(bankAccounts).where(and(eq(bankAccounts.id, itemId), eq(bankAccounts.companyId, companyId)));
          break;
        case "voucher": {
          // ── Step 1: Null out nullable FKs in tables with onDelete: "restrict" ──
          await db.update(purchaseOrders).set({ voucherId: null }).where(eq(purchaseOrders.voucherId, itemId));
          await db.update(containerSales).set({ voucherId: null }).where(eq(containerSales.voucherId, itemId));
          await db
            .update(interCompanyTransfers)
            .set({ fromVoucherId: null })
            .where(eq(interCompanyTransfers.fromVoucherId, itemId));
          await db
            .update(interCompanyTransfers)
            .set({ toVoucherId: null })
            .where(eq(interCompanyTransfers.toVoucherId, itemId));
          await db.update(salaryAdvances).set({ voucherId: null }).where(eq(salaryAdvances.voucherId, itemId));
          await db
            .update(customerOrderCharges)
            .set({ voucherId: null })
            .where(eq(customerOrderCharges.voucherId, itemId));
          await db.update(wasteDispatches).set({ voucherId: null }).where(eq(wasteDispatches.voucherId, itemId));
          await db.update(propertyPayments).set({ voucherId: null }).where(eq(propertyPayments.voucherId, itemId));
          await db
            .update(factoryTransporterTransactions)
            .set({ voucherId: null })
            .where(eq(factoryTransporterTransactions.voucherId, itemId));

          // ── Step 2: Delete rows with notNull FKs ──────────────────────────
          // stock_transfer_vouchers.voucherId is notNull — delete its items first
          const stvRows = await db
            .select({ id: stockTransferVouchers.id })
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, itemId));
          if (stvRows.length > 0) {
            const stvIds = stvRows.map((r) => r.id);
            // transferId is the correct FK column on stock_transfer_items
            await db.delete(stockTransferItems).where(inArray(stockTransferItems.transferId, stvIds));
            await db.delete(stockTransferVouchers).where(inArray(stockTransferVouchers.id, stvIds));
          }
          // fiscal_period_closures.closingVoucherId is notNull — delete the closure row if it exists
          try {
            await db.delete(fiscalPeriodClosures).where(eq(fiscalPeriodClosures.closingVoucherId, itemId));
          } catch {
            // If no matching row or table schema differs in production, continue safely
          }

          // ── Step 3: Delete voucher entries (also cascade, but be explicit) ─
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));

          // ── Step 4: Delete the voucher itself ────────────────────────────
          await db.delete(vouchers).where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        }
        case "orphanedPosSale":
          // Permanently delete an orphaned voucher and its entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, itemId));
          await db.delete(vouchers).where(and(eq(vouchers.id, itemId), eq(vouchers.companyId, companyId)));
          break;
        // === Wave 1 permanent deletes ===
        // Note: these only remove the row + immediate dependent rows. They do NOT
        // attempt to reverse historical financial vouchers/daybook entries — that
        // would require running the original cascade logic and is left for a future
        // wave. For full financial unwind, perform a manual reversal voucher.
        case "factoryCategory":
          await db
            .delete(factoryCategories)
            .where(and(eq(factoryCategories.id, itemId), eq(factoryCategories.companyId, companyId)));
          break;
        case "factoryBaleProduct":
          await db
            .delete(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.id, itemId), eq(factoryBaleProducts.companyId, companyId)));
          break;
        case "factoryContainer": {
          // Delete child rows in FK dependency order before the parent.
          // RESTRICT tables must be cleared manually; CASCADE tables
          // (factory_offload_additional_charges, factory_container_other_charges,
          //  factory_container_profit_snapshots) are handled automatically.
          await db.delete(factoryWasteEntries).where(eq(factoryWasteEntries.containerId, itemId));
          await db.delete(factoryDutyAuditLog).where(eq(factoryDutyAuditLog.containerId, itemId));
          await db.delete(factoryFxAllocations).where(eq(factoryFxAllocations.containerId, itemId));
          await db.delete(factoryContainerCommissions).where(eq(factoryContainerCommissions.containerId, itemId));
          // mix_batch_sources refs both container and raw_stock — delete before raw_stock
          await db.delete(factoryMixBatchSources).where(eq(factoryMixBatchSources.containerId, itemId));
          await db.delete(factoryRawStock).where(eq(factoryRawStock.containerId, itemId));
          await db
            .delete(factoryContainers)
            .where(and(eq(factoryContainers.id, itemId), eq(factoryContainers.companyId, companyId)));
          break;
        }
        case "factoryRawStock":
          await db
            .delete(factoryRawStock)
            .where(and(eq(factoryRawStock.id, itemId), eq(factoryRawStock.companyId, companyId)));
          break;
        case "factoryRawMaterialAdjustment":
          await db
            .delete(factoryRawMaterialAdjustments)
            .where(
              and(eq(factoryRawMaterialAdjustments.id, itemId), eq(factoryRawMaterialAdjustments.companyId, companyId))
            );
          break;
        case "factoryMixBatch":
          await db
            .delete(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, itemId), eq(factoryMixBatches.companyId, companyId)));
          break;
        case "factoryBale":
          await db.delete(factoryBales).where(and(eq(factoryBales.id, itemId), eq(factoryBales.companyId, companyId)));
          break;
        case "customerProforma":
          await db.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, itemId));
          await db.delete(proformaStockReservations).where(eq(proformaStockReservations.proformaId, itemId));
          await db
            .delete(customerProformas)
            .where(and(eq(customerProformas.id, itemId), eq(customerProformas.companyId, companyId)));
          break;
        case "customerOrder":
          await db.delete(customerOrderBales).where(eq(customerOrderBales.orderId, itemId));
          await db.delete(customerOrderLines).where(eq(customerOrderLines.orderId, itemId));
          await db.delete(customerOrderCharges).where(eq(customerOrderCharges.orderId, itemId));
          await db
            .delete(customerOrders)
            .where(and(eq(customerOrders.id, itemId), eq(customerOrders.companyId, companyId)));
          break;
        default:
          return res.status(400).json({ message: "Invalid item type" });
      }

      res.json({ message: `${type} permanently deleted` });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ============ AI Chatbot API Endpoints ============

  // Check if chatbot is enabled for current user
}
