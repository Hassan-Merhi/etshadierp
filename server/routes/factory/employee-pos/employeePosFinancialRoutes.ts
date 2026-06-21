import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { buildBrokerStatement } from "./factorySuppliersRoutes";
import { adjustInventory } from "../../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "../_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
  propertyContracts, propertyMonthlyLedger, propertyPayments,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sqlArray } from "../../../lib/sqlArray";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerEmployeePosFinancialRoutes(app: Express) {
  app.get("/api/factory/pos/sales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const sales = await db
        .select()
        .from(factoryPosSales)
        .where(eq(factoryPosSales.companyId, companyId))
        .orderBy(desc(factoryPosSales.createdAt));
      res.json(sales);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/pos/sales/:id — single sale with items
  app.get("/api/factory/pos/sales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);
      const [sale] = await db.select().from(factoryPosSales).where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!sale) return res.status(404).json({ message: "Sale not found" });
      const items = await db.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
      res.json({ ...sale, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/pos/sale — create a factory POS sale
  app.post("/api/factory/pos/sale", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const rawUserId = (req.session as any).userId;
      const userId: number | null = rawUserId && !isNaN(Number(rawUserId)) ? Number(rawUserId) : null;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId, customerName, customerId, notes, txDate, currencyCode, cashAccountId, paymentType, depositAmount, items, expenses } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Validate item quantities against available stock
      for (const item of items) {
        if (!item.productId && !item.productName) return res.status(400).json({ message: "Each item needs a product" });
        if (!item.quantity || item.quantity <= 0) return res.status(400).json({ message: "Quantity must be positive" });
      }

      const isCredit = (paymentType || "CASH") === "CREDIT";
      const parsedCustomerId = customerId ? parseInt(customerId) : null;
      const depositAmt = isCredit ? Math.max(0, parseFloat(depositAmount || "0")) : 0;

      const totalAmount = items.reduce((s: number, it: any) => s + parseFloat(it.unitPrice || "0") * parseInt(it.quantity || "1"), 0);

      // Expense deductions (optional array of {accountId, description, amount})
      const expenseRows: Array<{ accountId: number; description: string; amount: number }> = [];
      if (Array.isArray(expenses)) {
        for (const exp of expenses) {
          const amt = parseFloat(exp.amount || "0");
          if (amt > 0 && exp.accountId) {
            expenseRows.push({ accountId: parseInt(exp.accountId), description: exp.description || "", amount: amt });
          }
        }
      }
      const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0);
      // For cash: netCash = total - expenses. For credit: deposit may come in as cash.
      const netCash = isCredit ? depositAmt - totalExpenses : totalAmount - totalExpenses;

      // Generate sale number
      const [seqRow] = await db.select({ count: sql<number>`count(*)` }).from(factoryPosSales).where(eq(factoryPosSales.companyId, companyId));
      const nextNum = (Number(seqRow?.count || 0) + 1).toString().padStart(4, "0");
      const saleNumber = `FPOS-${nextNum}`;

      const result = await db.transaction(async (tx: any) => {
        // 1. Create sale record
        const [sale] = await tx.insert(factoryPosSales).values({
          companyId,
          saleNumber,
          txDate: txDate || getClientDate(req),
          locationId: locationId || null,
          customerName: customerName || null,
          customerId: parsedCustomerId,
          notes: notes || null,
          totalAmount: totalAmount.toFixed(2),
          currencyCode: currencyCode || "USD",
          cashAccountId: cashAccountId || null,
          paymentType: isCredit ? "CREDIT" : "CASH",
          depositAmount: isCredit ? depositAmt.toFixed(2) : "0",
          status: "COMPLETED",
          createdBy: userId,
          expensesJson: expenseRows.length > 0 ? JSON.stringify(expenseRows) : null,
        }).returning();

        // 2. Create sale items
        for (const item of items) {
          const qty = parseInt(item.quantity || "1");
          const price = parseFloat(item.unitPrice || "0");
          await tx.insert(factoryPosSaleItems).values({
            saleId: sale.id,
            companyId,
            productId: item.productId || null,
            productName: item.productName,
            articleCode: item.articleCode || null,
            quantity: qty,
            unitPrice: price.toFixed(2),
            totalAmount: (price * qty).toFixed(2),
            currencyCode: currencyCode || "USD",
          });

          // 3. Mark N bales as SOLD (pick oldest available by id).
          // FOR UPDATE serializes concurrent POS sales: a second sale that
          // tries to grab the same rows will block on the locked rows, then
          // re-evaluate the WHERE after the first transaction commits and
          // correctly skip the now-SOLD rows. If we cannot find as many
          // physical bales as the line item claims, abort the entire sale
          // so the customer is never billed for inventory that doesn't exist.
          if (item.productId && locationId) {
            const availableBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, item.productId),
                eq(factoryBales.erpLocationId, locationId),
                eq(factoryBales.status, "IN_STOCK"),
              ))
              .orderBy(factoryBales.id)
              .limit(qty)
              .for("update");
            if (availableBales.length < qty) {
              throw new Error(
                `INSUFFICIENT_BALE_STOCK: requested ${qty} bale(s) of "${item.productName || item.articleCode || item.productId}" at this location, only ${availableBales.length} available`,
              );
            }
            const baleIds = availableBales.map((b: any) => b.id);
            await tx.update(factoryBales)
              .set({ status: "SOLD", updatedAt: new Date() })
              .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
          }
        }

        // 4. Create daybook entry for the sale
        await tx.insert(factoryDaybookEntries).values({
          companyId,
          txDate: txDate || getClientDate(req),
          txType: "BALE_SALE",
          referenceId: sale.id,
          referenceTable: "factory_pos_sales",
          description: `Factory POS Sale ${saleNumber}${customerName ? ` – ${customerName}` : ""}${isCredit ? " [CREDIT]" : ""}`,
          currencyCode: currencyCode || "USD",
          amountCurrency: totalAmount.toFixed(2),
          fxRateToUsd: "1",
          amountUsd: totalAmount.toFixed(2),
          createdBy: userId,
        });

        // 4b. Create daybook entries for each expense/deduction
        for (const exp of expenseRows) {
          await tx.insert(factoryDaybookEntries).values({
            companyId,
            txDate: txDate || getClientDate(req),
            txType: "POS_EXPENSE",
            referenceId: sale.id,
            referenceTable: "factory_pos_sales",
            description: `${exp.description || "Deduction"} – POS ${saleNumber}${customerName ? ` (${customerName})` : ""}`,
            currencyCode: currencyCode || "USD",
            amountCurrency: exp.amount.toFixed(2),
            fxRateToUsd: "1",
            amountUsd: exp.amount.toFixed(2),
            createdBy: userId,
          });
        }

        // 5a. CREDIT sale — update customer balance
        if (isCredit && parsedCustomerId) {
          // Compute current running balance for this customer
          const [balRow] = await tx
            .select({ net: sql<string>`COALESCE(SUM(debit_amount::numeric - credit_amount::numeric), 0)` })
            .from(customerBalances)
            .where(and(eq(customerBalances.customerId, parsedCustomerId), eq(customerBalances.companyId, companyId)));
          const runningBefore = parseFloat(balRow?.net || "0");

          // DR customer for full sale amount
          const balAfterSale = runningBefore + totalAmount;
          await tx.insert(customerBalances).values({
            companyId,
            customerId: parsedCustomerId,
            transactionDate: txDate || getClientDate(req),
            transactionType: "SALE",
            referenceId: sale.id,
            referenceType: "FACTORY_POS_SALE",
            debitAmount: totalAmount.toFixed(2),
            creditAmount: "0",
            balance: balAfterSale.toFixed(2),
            currency: currencyCode || "USD",
            description: `POS Sale ${saleNumber}`,
          });

          // CR customer for any deposit received
          if (depositAmt > 0) {
            const balAfterDeposit = balAfterSale - depositAmt;
            await tx.insert(customerBalances).values({
              companyId,
              customerId: parsedCustomerId,
              transactionDate: txDate || getClientDate(req),
              transactionType: "PAYMENT",
              referenceId: sale.id,
              referenceType: "FACTORY_POS_DEPOSIT",
              debitAmount: "0",
              creditAmount: depositAmt.toFixed(2),
              balance: balAfterDeposit.toFixed(2),
              currency: currencyCode || "USD",
              description: `Deposit on POS Sale ${saleNumber}`,
            });
          }
        }

        // 5b. Cash receipt ERP voucher
        // For cash sales: full amount. For credit sales with deposit: deposit only.
        const voucherCashAmt = isCredit ? depositAmt : totalAmount;
        if (cashAccountId && voucherCashAmt > 0) {
          const voucherNum = `FPOS-${sale.id}-${Date.now()}`;
          const [vch] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Receipt",
            voucherNumber: voucherNum,
            voucherDate: txDate || getClientDate(req),
            description: `Factory POS Sale ${saleNumber}${customerName ? ` – ${customerName}` : ""}`,
            totalAmount: voucherCashAmt.toFixed(2),
            currency: currencyCode || "USD",
            exchangeRate: "1",
            sourceModule: "FACTORY_POS",
          }).returning();
          // DR Cash (net of deposit after expense deductions)
          const netDeposit = Math.max(0, netCash);
          if (netDeposit > 0) {
            await tx.insert(voucherEntries).values({
              voucherId: vch.id,
              ledgerAccountId: cashAccountId,
              debitAmount: netDeposit.toFixed(2),
              creditAmount: "0",
              narration: isCredit ? `Deposit on credit sale – ${saleNumber}` : `Factory POS cash receipt – ${saleNumber}`,
            });
          }
          // DR each expense account
          for (const exp of expenseRows) {
            await tx.insert(voucherEntries).values({
              voucherId: vch.id,
              ledgerAccountId: exp.accountId,
              debitAmount: exp.amount.toFixed(2),
              creditAmount: "0",
              narration: exp.description || `POS deduction – ${saleNumber}`,
            });
          }
          // CR Factory Sales Income (gross amount entering cash)
          const salesIncomeAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_BALE_SALES_INCOME", "Factory Bale Sales Income", "Revenue");
          await tx.insert(voucherEntries).values({
            voucherId: vch.id,
            ledgerAccountId: salesIncomeAccId,
            debitAmount: "0",
            creditAmount: voucherCashAmt.toFixed(2),
            narration: `Factory POS sales income – ${saleNumber}`,
          });
        }

        return sale;
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating factory POS sale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // PUT /api/factory/pos/sales/:id — edit an existing factory POS sale
  app.put("/api/factory/pos/sales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);

      const [existingSale] = await db.select().from(factoryPosSales).where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!existingSale) return res.status(404).json({ message: "Sale not found" });
      if (existingSale.status === "VOIDED") return res.status(400).json({ message: "Cannot edit a voided sale" });

      const { locationId, customerName, customerId, notes, txDate, currencyCode, cashAccountId, paymentType, depositAmount, items, expenses } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const isCredit = (paymentType || "CASH") === "CREDIT";
      const parsedCustomerId = customerId ? parseInt(customerId) : null;
      const depositAmt = isCredit ? Math.max(0, parseFloat(depositAmount || "0")) : 0;
      const totalAmount = items.reduce((s: number, it: any) => s + parseFloat(it.unitPrice || "0") * parseInt(it.quantity || "1"), 0);

      const expenseRows: Array<{ accountId: number; description: string; amount: number }> = [];
      if (Array.isArray(expenses)) {
        for (const exp of expenses) {
          const amt = parseFloat(exp.amount || "0");
          if (amt > 0 && exp.accountId) {
            expenseRows.push({ accountId: parseInt(exp.accountId), description: exp.description || "", amount: amt });
          }
        }
      }
      const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0);
      const netCash = isCredit ? depositAmt - totalExpenses : totalAmount - totalExpenses;

      const result = await db.transaction(async (tx: any) => {
        // Step 1: Restore bales for old items
        const oldItems = await tx.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
        for (const oldItem of oldItems) {
          if (oldItem.productId && existingSale.locationId) {
            const soldBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, oldItem.productId),
                eq(factoryBales.erpLocationId, existingSale.locationId),
                eq(factoryBales.status, "SOLD"),
              ))
              .orderBy(desc(factoryBales.id))
              .limit(oldItem.quantity)
              .for("update");
            const baleIds = soldBales.map((b: any) => b.id);
            if (baleIds.length > 0) {
              await tx.update(factoryBales)
                .set({ status: "IN_STOCK", updatedAt: new Date() })
                .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
            }
          }
        }

        // Step 2: Delete old items
        await tx.delete(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));

        // Step 3: Update sale record
        const [updatedSale] = await tx.update(factoryPosSales)
          .set({
            txDate: txDate || existingSale.txDate,
            locationId: locationId || null,
            customerName: customerName || null,
            customerId: parsedCustomerId,
            notes: notes || null,
            totalAmount: totalAmount.toFixed(2),
            currencyCode: currencyCode || "USD",
            cashAccountId: cashAccountId || null,
            paymentType: isCredit ? "CREDIT" : "CASH",
            depositAmount: isCredit ? depositAmt.toFixed(2) : "0",
            expensesJson: expenseRows.length > 0 ? JSON.stringify(expenseRows) : null,
          })
          .where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)))
          .returning();

        // Step 4: Insert new items and mark bales as SOLD
        for (const item of items) {
          const qty = parseInt(item.quantity || "1");
          const price = parseFloat(item.unitPrice || "0");
          await tx.insert(factoryPosSaleItems).values({
            saleId,
            companyId,
            productId: item.productId || null,
            productName: item.productName,
            articleCode: item.articleCode || null,
            quantity: qty,
            unitPrice: price.toFixed(2),
            totalAmount: (price * qty).toFixed(2),
            currencyCode: currencyCode || "USD",
          });

          if (item.productId && locationId) {
            const availableBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, item.productId),
                eq(factoryBales.erpLocationId, locationId),
                eq(factoryBales.status, "IN_STOCK"),
              ))
              .orderBy(factoryBales.id)
              .limit(qty)
              .for("update");
            if (availableBales.length < qty) {
              throw new Error(
                `INSUFFICIENT_BALE_STOCK: requested ${qty} bale(s) of "${item.productName || item.articleCode || item.productId}" at this location, only ${availableBales.length} available`,
              );
            }
            const baleIds = availableBales.map((b: any) => b.id);
            await tx.update(factoryBales)
              .set({ status: "SOLD", updatedAt: new Date() })
              .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
          }
        }

        // Step 5: Update factory daybook BALE_SALE entry and rebuild POS_EXPENSE entries
        await tx.update(factoryDaybookEntries)
          .set({
            amountCurrency: totalAmount.toFixed(2),
            amountUsd: totalAmount.toFixed(2),
            txDate: txDate || existingSale.txDate,
            description: `Factory POS Sale ${existingSale.saleNumber}${customerName ? ` – ${customerName}` : ""}${isCredit ? " [CREDIT]" : ""}`,
          })
          .where(and(
            eq(factoryDaybookEntries.referenceTable, "factory_pos_sales"),
            eq(factoryDaybookEntries.referenceId, saleId),
            eq(factoryDaybookEntries.txType, "BALE_SALE"),
          ));

        // Delete old expense daybook rows, then re-insert fresh ones
        await tx.delete(factoryDaybookEntries)
          .where(and(
            eq(factoryDaybookEntries.referenceTable, "factory_pos_sales"),
            eq(factoryDaybookEntries.referenceId, saleId),
            eq(factoryDaybookEntries.txType, "POS_EXPENSE"),
          ));
        for (const exp of expenseRows) {
          await tx.insert(factoryDaybookEntries).values({
            companyId,
            txDate: txDate || existingSale.txDate,
            txType: "POS_EXPENSE",
            referenceId: saleId,
            referenceTable: "factory_pos_sales",
            description: `${exp.description || "Deduction"} – POS ${existingSale.saleNumber}${customerName ? ` (${customerName})` : ""}`,
            currencyCode: currencyCode || "USD",
            amountCurrency: exp.amount.toFixed(2),
            fxRateToUsd: "1",
            amountUsd: exp.amount.toFixed(2),
          });
        }

        // Step 6: Update customer balance entries if applicable
        if (isCredit && parsedCustomerId) {
          // Remove old SALE and DEPOSIT balance entries for this sale
          await tx.delete(customerBalances)
            .where(and(
              eq(customerBalances.referenceId, saleId),
              eq(customerBalances.companyId, companyId),
              or(
                eq(customerBalances.referenceType, "FACTORY_POS_SALE"),
                eq(customerBalances.referenceType, "FACTORY_POS_DEPOSIT"),
              ),
            ));

          // Re-compute running balance and re-insert
          const [balRow] = await tx
            .select({ net: sql<string>`COALESCE(SUM(debit_amount::numeric - credit_amount::numeric), 0)` })
            .from(customerBalances)
            .where(and(eq(customerBalances.customerId, parsedCustomerId), eq(customerBalances.companyId, companyId)));
          const runningBefore = parseFloat(balRow?.net || "0");
          const balAfterSale = runningBefore + totalAmount;
          await tx.insert(customerBalances).values({
            companyId,
            customerId: parsedCustomerId,
            transactionDate: txDate || existingSale.txDate,
            transactionType: "SALE",
            referenceId: saleId,
            referenceType: "FACTORY_POS_SALE",
            debitAmount: totalAmount.toFixed(2),
            creditAmount: "0",
            balance: balAfterSale.toFixed(2),
            currency: currencyCode || "USD",
            description: `POS Sale ${existingSale.saleNumber} (edited)`,
          });
          if (depositAmt > 0) {
            const balAfterDeposit = balAfterSale - depositAmt;
            await tx.insert(customerBalances).values({
              companyId,
              customerId: parsedCustomerId,
              transactionDate: txDate || existingSale.txDate,
              transactionType: "PAYMENT",
              referenceId: saleId,
              referenceType: "FACTORY_POS_DEPOSIT",
              debitAmount: "0",
              creditAmount: depositAmt.toFixed(2),
              balance: balAfterDeposit.toFixed(2),
              currency: currencyCode || "USD",
              description: `Deposit on POS Sale ${existingSale.saleNumber} (edited)`,
            });
          }
        }

        // Step 7: Update the ERP receipt voucher if it exists
        const existingVouchers = await tx.select().from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY_POS"),
            sql`voucher_number LIKE ${'FPOS-' + saleId + '-%'}`,
          ));
        if (existingVouchers.length > 0) {
          const vchId = existingVouchers[0].id;
          const voucherCashAmt = isCredit ? depositAmt : totalAmount;
          if (cashAccountId && voucherCashAmt > 0) {
            await tx.update(vouchers)
              .set({
                voucherDate: txDate || existingSale.txDate,
                description: `Factory POS Sale ${existingSale.saleNumber}${customerName ? ` – ${customerName}` : ""}`,
                totalAmount: voucherCashAmt.toFixed(2),
                currency: currencyCode || "USD",
              })
              .where(eq(vouchers.id, vchId));

            // Replace voucher entries
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, vchId));
            const netDeposit = Math.max(0, netCash);
            if (netDeposit > 0) {
              await tx.insert(voucherEntries).values({
                voucherId: vchId,
                ledgerAccountId: parseInt(cashAccountId),
                debitAmount: netDeposit.toFixed(2),
                creditAmount: "0",
                narration: isCredit ? `Deposit on credit sale – ${existingSale.saleNumber}` : `Factory POS cash receipt – ${existingSale.saleNumber}`,
              });
            }
            for (const exp of expenseRows) {
              await tx.insert(voucherEntries).values({
                voucherId: vchId,
                ledgerAccountId: exp.accountId,
                debitAmount: exp.amount.toFixed(2),
                creditAmount: "0",
                narration: exp.description || `POS deduction – ${existingSale.saleNumber}`,
              });
            }
            const salesIncomeAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_BALE_SALES_INCOME", "Factory Bale Sales Income", "Revenue");
            await tx.insert(voucherEntries).values({
              voucherId: vchId,
              ledgerAccountId: salesIncomeAccId,
              debitAmount: "0",
              creditAmount: voucherCashAmt.toFixed(2),
              narration: `Factory POS sales income – ${existingSale.saleNumber}`,
            });
          }
        }

        return updatedSale;
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error editing factory POS sale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // DELETE /api/factory/pos/sales/:id — void a factory POS sale
  app.delete("/api/factory/pos/sales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);
      const [sale] = await db.select().from(factoryPosSales).where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!sale) return res.status(404).json({ message: "Sale not found" });
      if (sale.status === "VOIDED") return res.status(400).json({ message: "Sale already voided" });

      await db.transaction(async (tx: any) => {
        // Restore bales to IN_STOCK by finding bales that were sold around the sale date/product
        const items = await tx.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
        for (const item of items) {
          if (item.productId && sale.locationId) {
            // Re-open the most recently SOLD bales for that product at that location
            const soldBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, item.productId),
                eq(factoryBales.erpLocationId, sale.locationId),
                eq(factoryBales.status, "SOLD"),
              ))
              .orderBy(desc(factoryBales.id))
              .limit(item.quantity)
              .for("update");
            const baleIds = soldBales.map((b: any) => b.id);
            if (baleIds.length > 0) {
              await tx.update(factoryBales)
                .set({ status: "IN_STOCK", updatedAt: new Date() })
                .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
            }
          }
        }
        // Mark sale as voided
        await tx.update(factoryPosSales).set({ status: "VOIDED" }).where(eq(factoryPosSales.id, saleId));
      });

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Error voiding factory POS sale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── Worker Categories ──────────────────────────────────────────────────────
  app.get("/api/factory/worker-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const cats = await db.select().from(factoryWorkerCategories)
        .where(eq(factoryWorkerCategories.companyId, companyId))
        .orderBy(factoryWorkerCategories.name);
      res.json(cats);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/factory/worker-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const body = insertFactoryWorkerCategorySchema.parse({ ...req.body, companyId });
      const [cat] = await db.insert(factoryWorkerCategories).values(body).returning();
      res.json(cat);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch("/api/factory/worker-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const body = insertFactoryWorkerCategorySchema.partial().parse(req.body);
      const [cat] = await db.update(factoryWorkerCategories)
        .set(body)
        .where(and(eq(factoryWorkerCategories.id, id), eq(factoryWorkerCategories.companyId, companyId)))
        .returning();
      if (!cat) return res.status(404).json({ message: "Not found" });
      res.json(cat);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/factory/worker-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      await db.delete(factoryWorkerCategories)
        .where(and(eq(factoryWorkerCategories.id, id), eq(factoryWorkerCategories.companyId, companyId)));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Financial Snapshot  —  single-request aggregates for the snapshot page
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/factory/financial-snapshot", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // ── 1. Raw material value (remaining kg × cost per kg USD) ────────────
      const rawStockRows = await db.select({
        receivedKg: factoryRawStock.receivedKg,
        usedKg: factoryRawStock.usedKg,
        costPerKg: factoryRawStock.costPerKg,
        costPerKgUsd: factoryRawStock.costPerKgUsd,
      }).from(factoryRawStock).where(eq(factoryRawStock.companyId, companyId));

      let rawMaterialValue = 0;
      for (const r of rawStockRows as any[]) {
        const remaining = parseFloat(r.receivedKg || "0") - parseFloat(r.usedKg || "0");
        const cost = parseFloat(r.costPerKgUsd || "0") || parseFloat(r.costPerKg || "0");
        rawMaterialValue += remaining * cost;
      }

      // ── 2. Mix batch value (non-finalized batches: not COMPLETED or CLOSED) ─
      const mixBatchRows = await db.select({
        totalWeightKg: factoryMixBatches.totalWeightKg,
        usedKg: factoryMixBatches.usedKg,
        costPerKg: factoryMixBatches.costPerKg,
        status: factoryMixBatches.status,
      }).from(factoryMixBatches).where(
        and(
          eq(factoryMixBatches.companyId, companyId),
          ne(factoryMixBatches.status, "COMPLETED"),
          ne(factoryMixBatches.status, "CLOSED"),
        )
      );

      let mixBatchValue = 0;
      for (const b of mixBatchRows as any[]) {
        const remaining = parseFloat(b.totalWeightKg || "0") - parseFloat(b.usedKg || "0");
        const cost = parseFloat(b.costPerKg || "0");
        if (remaining > 0) mixBatchValue += remaining * cost;
      }

      // ── 3. Bale stock weight — only physically-present bales ──────────────
      // IN_STOCK = available, RESERVED_FOR_ORDER = allocated to a pending order
      // but physically still in the warehouse. Excludes SOLD / DISPATCHED / etc.
      const baleAgg = await db.select({
        totalWeight: sql<string>`COALESCE(SUM(CAST(${factoryBales.weightKg} AS numeric)), 0)`,
        totalCount: sql<string>`COUNT(*)`,
        totalValue: sql<string>`COALESCE(SUM(CAST(${factoryBales.totalCost} AS numeric)), 0)`,
      }).from(factoryBales).where(
        and(
          eq(factoryBales.companyId, companyId),
          inArray(factoryBales.status, ["IN_STOCK", "RESERVED_FOR_ORDER"]),
        )
      );

      const baleWeightTotal = parseFloat((baleAgg[0] as any)?.totalWeight || "0");
      const baleCount = parseInt((baleAgg[0] as any)?.totalCount || "0");
      const baleValueTotal = parseFloat((baleAgg[0] as any)?.totalValue || "0");

      // ── 4. Outstanding worker advances ────────────────────────────────────
      const advanceAgg = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${factoryWorkerAdvances.remainingBalance} AS numeric)), 0)`,
        count: sql<string>`COUNT(*)`,
      }).from(factoryWorkerAdvances).where(
        and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.fullyPaid, false),
        )
      );

      const outstandingAdvances = parseFloat((advanceAgg[0] as any)?.total || "0");
      const advanceCount = parseInt((advanceAgg[0] as any)?.count || "0");

      // ── 5. Active worker count ────────────────────────────────────────────
      const workerAgg = await db.select({
        total: sql<string>`COUNT(*)`,
      }).from(factoryWorkers).where(
        and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true))
      );
      const activeWorkerCount = parseInt((workerAgg[0] as any)?.total || "0");

      // ── 6. Equity / Capital ledger accounts with balances ─────────────────
      const equityAccounts = await db.select({
        id: ledgerAccounts.id,
        name: ledgerAccounts.name,
        code: ledgerAccounts.code,
        accountType: ledgerAccounts.accountType,
        openingBalance: ledgerAccounts.openingBalance,
        openingBalanceSide: ledgerAccounts.openingBalanceSide,
      }).from(ledgerAccounts).where(
        and(
          eq(ledgerAccounts.companyId, companyId),
          or(
            sql`LOWER(${ledgerAccounts.accountType}) IN ('equity', 'capital', 'owner equity', 'owners equity', 'share capital')`,
            sql`LOWER(${ledgerAccounts.name}) ILIKE '%capital%'`,
          )
        )
      );

      // Get voucher entries for equity accounts
      let capitalTotal = 0;
      if ((equityAccounts as any[]).length > 0) {
        const equityIds = (equityAccounts as any[]).map((a: any) => a.id);
        const equityEntries = await db.select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debit: sql<string>`SUM(CAST(${voucherEntries.debitAmount} AS numeric))`,
          credit: sql<string>`SUM(CAST(${voucherEntries.creditAmount} AS numeric))`,
        }).from(voucherEntries)
          .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)))
          .where(inArray(voucherEntries.ledgerAccountId, equityIds))
          .groupBy(voucherEntries.ledgerAccountId);

        const balMap = new Map<number, { debit: number; credit: number }>();
        for (const e of equityEntries as any[]) {
          balMap.set(e.ledgerAccountId, { debit: parseFloat(e.debit || "0"), credit: parseFloat(e.credit || "0") });
        }

        for (const acc of equityAccounts as any[]) {
          const opening = parseFloat(acc.openingBalance || "0");
          const openingSide = acc.openingBalanceSide === "Dr" ? 1 : acc.openingBalanceSide === "Cr" ? -1 : -1;
          const signedOpening = opening * openingSide;
          const bal = balMap.get(acc.id) || { debit: 0, credit: 0 };
          const net = signedOpening + bal.debit - bal.credit;
          capitalTotal += net;
        }
      }

      res.json({
        rawMaterialValue: round2(rawMaterialValue),
        mixBatchValue: round2(mixBatchValue),
        baleWeightTotal: round2(baleWeightTotal),
        baleCount,
        baleValueTotal: round2(baleValueTotal),
        outstandingAdvances: round2(outstandingAdvances),
        advanceCount,
        activeWorkerCount,
        capitalTotal: round2(capitalTotal),
        equityAccounts: (equityAccounts as any[]).map((a: any) => ({ id: a.id, name: a.name, code: a.code, accountType: a.accountType })),
      });
    } catch (error: any) {
      console.error("Factory financial-snapshot error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Net Position  —  "What We Have" vs "What We Owe"
  // Same logic as ERP /api/stats/net-profit but uses factory supplier tables
  // ─────────────────────────────────────────────────────────────────────────
}
