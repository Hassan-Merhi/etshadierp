import Decimal from "decimal.js";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import {
  applyOffloadMovingAverage,
  getAuthoritativeSupplierRemainingKg,
  getLockedSupplierRate,
} from "../../../services/factory/rawStockLockedRate";
import { resolveStoredFxRate, resolveStoredFxRateOrThrow } from "../../../services/factory/currencyConversion";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
} from "../_helpers";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryDailyUsages,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  baleLabelPrints,
  stockItems,
  stockGroups,
  users,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerInvoiceSequences,
  customerBalances,
  customers,
  insertCustomerSchema,
  ledgerAccounts,
  voucherEntries,
  companies,
  locations,
  userCompanyRoles,
  insertCustomerProformaSchema,
  insertCustomerProformaLineSchema,
  insertCustomerOrderSchema,
  factoryFxRates,
  insertFactoryFxRateSchema,
  factoryDaybookEntries,
  containerDocumentTypes,
  containerDocuments,
  containerFreight,
  containerFreightPayments,
  factoryDaybookEntryEdits,
  containers,
  factoryUserProfiles,
  factoryUserPageAccess,
  insertUserSchema,
  directMessages,
  insertDirectMessageSchema,
  userPresence,
  factoryDutyAuditLog,
  factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges,
  companySettings,
  factorySettings,
  factoryWorkers,
  factoryWorkerCategories,
  insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryAlerts,
  employees,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  bankAccounts,
  inventory,
  exchangeRates,
  vouchers,
  suppliers,
  containerSales,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
  baleRecodeSessions,
  baleRecodeItems,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryBaleWasteDispatches,
  factoryPosSales,
  factoryPosSaleItems,
  proformaStockReservations,
  factorySupplierCategories,
  factoryContainerReceipts,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerRawStockOffloadRoutes(app: Express) {
  app.post("/api/factory/raw-stock/offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        containerId,
        receivedKg,
        costPerKg,
        commission,
        currencyCode: reqCurrencyCode,
        fxRateToUsd: reqFxRate,
        freight: reqFreight,
        freightAccountId: reqFreightAccountId,
        freightSupplierId: reqFreightSupplierId,
        freightCurrencyCode: reqFreightCurrencyCode,
        freightFxRate: reqFreightFxRate,
        otherCharges: reqOtherCharges,
        otherChargesAccountId: reqOtherChargesAccountId,
        otherChargesSupplierId: reqOtherChargesSupplierId,
        otherChargesCurrencyCode: reqOtherChargesCurrencyCode,
        otherChargesFxRate: reqOtherChargesFxRate,
        dutyAmount: reqDutyAmount,
        dutyAccountId: reqDutyAccountId,
        dutyStatus: reqDutyStatus,
        dutyNotes: reqDutyNotes,
        additionalCharges: reqAdditionalCharges,
        offloadDate: reqOffloadDate,
        mixBatchAllocations: reqMixBatchAllocations,
        destination: reqDestination,
      } = req.body;
      if (!containerId) return res.status(400).json({ message: "Container ID is required" });

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });

      const [existingRawStock] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      // A PARTIALLY_RECEIVED container may receive additional kg (subsequent receipt).
      // A fully OFFLOADED container (cumulative received >= declared) must not.
      const isSubsequentReceipt = !!existingRawStock;
      if (isSubsequentReceipt && container.status === "OFFLOADED") {
        return res.status(400).json({ message: "This container has already been fully offloaded" });
      }

      const currencyCode = reqCurrencyCode || container.currencyCode || "USD";
      const today = getClientDate(req);
      const offloadDate = reqOffloadDate || today;
      const mixBatchAllocationsArr = Array.isArray(reqMixBatchAllocations) ? reqMixBatchAllocations : [];

      let fxRate: number;
      if (reqFxRate && parseFloat(reqFxRate) > 0) {
        // User explicitly set the FX rate — always honour it
        fxRate = parseFloat(reqFxRate);
      } else if (currencyCode === "USD") {
        fxRate = 1;
      } else {
        try {
          fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, currencyCode, offloadDate));
        } catch (err: any) {
          // Do NOT silently default to 1 for a non-USD offload — that would understate
          // (or overstate) the USD landed cost by the entire FX differential with no
          // trace of why. The container's own fxRateToUsd is only a legitimate fallback
          // if it was itself explicitly set (not left at the schema default of "1" for
          // a non-USD currency, which means "never actually set").
          const { fxRate: containerRate, looksSet: containerRateLooksSet } = resolveStoredFxRate(
            container.currencyCode,
            container.fxRateToUsd,
            (container as any).fxRateConfirmed
          );
          if (!containerRateLooksSet) {
            return res.status(400).json({
              message: `No valid FX rate available for ${currencyCode} on ${offloadDate}, and the container has no explicitly-set fxRateToUsd to fall back on. Provide fxRateToUsd explicitly to offload this container. (${err.message})`,
            });
          }
          fxRate = containerRate;
        }
      }

      const declaredKg = container.totalKg || "0";
      const actualKg = receivedKg || declaredKg;
      const baseCostPerKg = costPerKg || container.ratePerKg || "0";
      const differenceKg = String(parseFloat(declaredKg) - parseFloat(actualKg));
      // basePayable uses the FULL declared weight, not just the kg received this trip.
      // All fixed costs (freight, commission, duty, other charges) are contracted for the
      // full container — spreading them over only the partial received weight inflates the
      // per-kg rate on first receipt and means the rate changes on each subsequent receipt,
      // making it impossible to establish a stable locked rate for mix-batch costing.
      const basePayable = parseFloat(declaredKg) * parseFloat(baseCostPerKg);

      // Fall back to the container's own supplier for freight payee when the offload
      // request didn't explicitly resend one. Container creation and the PATCH freight-sync
      // route both credit container.supplierId whenever freightPaidBy='supplier' (the
      // default) without requiring a separate freightSupplierId to be selected again — the
      // offload form should honor the same default, or freight silently falls into the
      // no-payee ledger branch (Dr Factory Charges Payable / Cr Freight), which nets the
      // freight expense to zero and leaves an unresolved balance in Charges Payable.
      const effectiveFreightSupplierId: number | null = reqFreightSupplierId
        ? parseInt(reqFreightSupplierId)
        : !reqFreightAccountId && ((container as any).freightPaidBy || "supplier") === "supplier" && container.supplierId
          ? container.supplierId
          : null;

      const freightVal = parseFloat(reqFreight || "0");
      const otherChargesVal = parseFloat(reqOtherCharges || "0");
      const additionalChargesArr = Array.isArray(reqAdditionalCharges) ? reqAdditionalCharges : [];
      // Each charge may be in its own currency; convert each to container currency for totalCost
      const additionalChargesTotal = additionalChargesArr.reduce((sum: number, c: any) => {
        const amt = parseFloat(c.amount || "0");
        const chargeCcy = c.currencyCode || currencyCode;
        const chargeFx = parseFloat(c.fxRateToUsd || String(fxRate));
        if (chargeCcy === currencyCode) return sum + amt;
        const amtUsd = chargeCcy === "USD" ? amt : amt * chargeFx;
        const amtInContainerCcy = currencyCode === "USD" ? amtUsd : fxRate > 0 ? amtUsd / fxRate : amtUsd;
        return sum + amtInContainerCcy;
      }, 0);
      const dutyVal = reqDutyStatus === "CONFIRMED" ? parseFloat(reqDutyAmount || "0") : 0;
      const dutyStatus = reqDutyStatus || "NONE";

      // ── Commission computation (must happen before totalCost calculation) ──────
      // The DB insert is deferred into the transaction below; only the math runs here.
      let commissionRecord: any = null;
      let commTotalVal = 0;
      let commInContainerCcy = 0;
      let commCurrencyForUsd = currencyCode;
      let commFxRateForUsd = fxRate;
      let commInsertValues: any = null;
      if (commission && commission.personName && commission.commissionRate) {
        const commType = commission.commissionType || "PER_KG";
        const commRate = parseFloat(commission.commissionRate) || 0;
        // Commission PER_KG is computed on the full declared weight — the commission
        // is agreed for the whole container, not just the portion received so far.
        commTotalVal = commType === "PER_KG" ? commRate * parseFloat(declaredKg) : commRate;
        const commCurrency = (commission.currencyCode || currencyCode).toUpperCase();
        commCurrencyForUsd = commCurrency;

        // ── Commission FX: resolve independently from the container FX ──────────
        // The commission may be denominated in a currency different from both USD
        // and the container currency (e.g. AUD container with EUR commission).
        // Using the container fxRate for a different-currency commission produces
        // a wrong commissionTotalUsd and cascades all the way to bale cost.
        let resolvedCommFxRate: number;
        if (commCurrency === "USD") {
          resolvedCommFxRate = 1;
        } else if (commCurrency === currencyCode.toUpperCase()) {
          // Same currency as container — confirmed container FX is correct.
          resolvedCommFxRate = fxRate;
        } else {
          // Different non-USD currency: must resolve independently.
          try {
            resolvedCommFxRate = parseFloat(
              await getOrFetchFxRateToUsd(companyId, commCurrency, offloadDate)
            );
          } catch (err: any) {
            return res.status(400).json({
              message: `Cannot resolve FX rate for commission currency ${commCurrency} on ${offloadDate}. ${err.message}`,
            });
          }
        }
        commFxRateForUsd = resolvedCommFxRate;
        const commTotalUsd = commCurrency === "USD" ? commTotalVal : commTotalVal * resolvedCommFxRate;
        commInContainerCcy =
          commCurrency === currencyCode.toUpperCase()
            ? commTotalVal
            : fxRate > 0
              ? commTotalUsd / fxRate
              : commTotalUsd;
        commInsertValues = {
          companyId,
          containerId,
          personName: commission.personName,
          commissionType: commType,
          commissionRate: String(commRate),
          commissionTotal: String(commTotalVal),
          currencyCode: commCurrency,
          fxRateToUsd: String(resolvedCommFxRate),
          // The rate was resolved above (USD=1, same-ccy=confirmed container rate, or a
          // real live fetch) — flag it confirmed so resolveStoredFxRateOrThrow does not
          // reject it when booking the commission daybook entry.
          fxRateConfirmed: true,
          commissionTotalUsd: String(commTotalUsd),
          ledgerAccountId: commission.ledgerAccountId ? parseInt(commission.ledgerAccountId) : null,
        };
      }

      // Compute per-component USD values (each charge may be in its own currency)
      const freightCcy = reqFreightCurrencyCode || currencyCode;
      const freightFxRateVal = parseFloat(reqFreightFxRate || String(fxRate));
      const freightUsd = freightCcy === "USD" ? freightVal : freightVal * freightFxRateVal;
      // Convert freight to container currency for totalCost
      const freightInContainerCcy =
        freightCcy === currencyCode ? freightVal : fxRate > 0 ? freightUsd / fxRate : freightVal;

      const ocCcy = reqOtherChargesCurrencyCode || currencyCode;
      const ocFxRateVal = parseFloat(reqOtherChargesFxRate || String(fxRate));
      const ocUsd = ocCcy === "USD" ? otherChargesVal : otherChargesVal * ocFxRateVal;
      // Convert OC to container currency for totalCost
      const ocInContainerCcy = ocCcy === currencyCode ? otherChargesVal : fxRate > 0 ? ocUsd / fxRate : otherChargesVal;

      const totalCost =
        basePayable + freightInContainerCcy + ocInContainerCcy + additionalChargesTotal + commInContainerCcy + dutyVal;
      // Divide by declared kg — the fixed denominator — not by this receipt's actual kg.
      // This is the FIXED landed cost/kg: established once at first offload, unchanged
      // by subsequent partial receipts, and correct for mix-batch cost inheritance.
      const dDeclaredKg = new Decimal(declaredKg);
      const dActualKg = new Decimal(actualKg); // kept for moving-average (incremental kg)
      const dInclusiveCostPerKg = dDeclaredKg.gt(0) ? new Decimal(totalCost).div(dDeclaredKg) : new Decimal(0);
      // finalPayableAmount is always the FULL container value (what we agreed to pay)
      const finalPayableAmount = String(totalCost);

      const commUsd = commCurrencyForUsd === "USD" ? commTotalVal : commTotalVal * commFxRateForUsd;

      const baseMaterialUsd = currencyCode === "USD" ? basePayable : basePayable * fxRate;
      const addlUsd = additionalChargesArr.reduce((sum: number, c: any) => {
        const amt = parseFloat(c.amount || "0");
        const chargeCcy = c.currencyCode || currencyCode;
        const chargeFx = parseFloat(c.fxRateToUsd || String(fxRate));
        return sum + (chargeCcy === "USD" ? amt : amt * chargeFx);
      }, 0);
      const dutyUsd = currencyCode === "USD" ? dutyVal : dutyVal * fxRate;

      const totalUsd = baseMaterialUsd + freightUsd + commUsd + ocUsd + addlUsd + dutyUsd;
      const dCostPerKgUsd = dDeclaredKg.gt(0) ? new Decimal(totalUsd).div(dDeclaredKg) : new Decimal(0);
      const finalPayableAmountUsd = String(totalUsd);

      const newStatus = parseFloat(actualKg) < parseFloat(declaredKg) ? "PARTIALLY_RECEIVED" : "OFFLOADED";

      // ── Pre-fetch ledger accounts BEFORE opening the transaction ──────────────
      // getOrCreateLedgerAccount uses the raw db connection and must not run inside
      // a transaction (it performs its own upsert). We resolve all IDs here so the
      // transaction body only uses tx.* calls and stays fully atomic.
      const chargesPayableAcctId = await getOrCreateLedgerAccount(
        companyId,
        "FACTORY_CHARGES_PAYABLE",
        "Factory Charges Payable"
      );
      const freightExpenseAcctId =
        freightVal > 0 && effectiveFreightSupplierId
          ? reqFreightAccountId
            ? parseInt(reqFreightAccountId)
            : await getOrCreateLedgerAccount(companyId, "FACTORY_FREIGHT_EXPENSE", "Freight Expense")
          : null;
      const ocExpenseAcctId =
        otherChargesVal > 0 && reqOtherChargesSupplierId
          ? reqOtherChargesAccountId
            ? parseInt(reqOtherChargesAccountId)
            : await getOrCreateLedgerAccount(companyId, "FACTORY_OC_EXPENSE", "Other Charges Expense")
          : null;

      // ── Single atomic transaction: all DB writes happen here or not at all ────
      let rawStock: any;

      await db.transaction(async (tx) => {
        // ── SUBSEQUENT RECEIPT PATH ───────────────────────────────────────────────
        // When a raw-stock row already exists (PARTIALLY_RECEIVED container), we only:
        //   1. Apply the moving-average using the FIXED rate from the first offload
        //   2. Increment raw-stock receivedKg
        //   3. Optionally insert mix-batch sources at the same fixed rate
        //   4. Update the container's cumulative actualReceivedKg and status
        //   5. Record this event in factory_container_receipts
        // Financial posting (commission, daybook, freight/OC vouchers) already happened
        // on the first receipt — do NOT repeat it here.
        if (isSubsequentReceipt) {
          const fixedCostPerKg = parseFloat((existingRawStock as any).costPerKg || "0");
          const fixedCostPerKgUsd = parseFloat((existingRawStock as any).costPerKgUsd || "0");
          const prevReceivedKg = parseFloat((existingRawStock as any).receivedKg || "0");
          const thisReceiptKg = parseFloat(actualKg);
          const newCumulativeKg = prevReceivedKg + thisReceiptKg;
          const declaredKgNum = parseFloat(declaredKg);

          // Validate kg within remaining bounds
          const remainingKg = declaredKgNum - prevReceivedKg;
          if (thisReceiptKg > remainingKg + 0.001) {
            throw new Error(
              `Cannot receive ${thisReceiptKg.toFixed(3)} kg — only ${remainingKg.toFixed(3)} kg remaining from declared ${declaredKgNum.toFixed(3)} kg`
            );
          }

          // 0. Moving average with incremental kg + fixed rate (same as first receipt)
          if (container.supplierId) {
            await applyOffloadMovingAverage(tx, {
              companyId,
              supplierId: container.supplierId,
              newReceivedKg: thisReceiptKg,
              newContainerLandedCostPerKgUsd: fixedCostPerKgUsd,
            });
          }

          // 1. Update raw-stock receivedKg (cumulative)
          await tx
            .update(factoryRawStock)
            .set({ receivedKg: String(newCumulativeKg) })
            .where(eq(factoryRawStock.id, (existingRawStock as any).id));
          rawStock = { ...existingRawStock, receivedKg: String(newCumulativeKg) };

          // 2. Mix-batch sources at fixed rate
          for (const alloc of mixBatchAllocationsArr) {
            const allocKg = parseFloat(alloc.weightKg || "0");
            if (!alloc.mixBatchId || allocKg <= 0) continue;
            const dAllocKg = new Decimal(allocKg);
            const dFixedUsd = new Decimal(fixedCostPerKgUsd);
            await tx.insert(factoryMixBatchSources).values({
              mixBatchId: parseInt(alloc.mixBatchId),
              containerId,
              supplierId: container.supplierId || null,
              sourceType: "container",
              weightKg: String(allocKg),
              costPerKg: dFixedUsd.toDecimalPlaces(6).toFixed(6),
              totalCost: dAllocKg.times(dFixedUsd).toDecimalPlaces(6).toFixed(6),
            });
          }

          // 3. Update container cumulative actualReceivedKg and status
          const subsequentStatus = newCumulativeKg >= declaredKgNum - 0.001 ? "OFFLOADED" : "PARTIALLY_RECEIVED";
          await tx
            .update(factoryContainers)
            .set({
              actualReceivedKg: String(newCumulativeKg),
              differenceKg: String(Math.max(0, declaredKgNum - newCumulativeKg)),
              status: subsequentStatus,
              destination: reqDestination ? String(reqDestination).trim() : container.destination || null,
              updatedAt: new Date(),
            })
            .where(eq(factoryContainers.id, containerId));

          // 4. Record this receipt event
          await tx.insert(factoryContainerReceipts).values({
            companyId,
            containerId,
            receiptDate: offloadDate,
            receivedKg: String(thisReceiptKg),
            cumulativeReceivedKg: String(newCumulativeKg),
            fixedCostPerKg: String(fixedCostPerKg),
            fixedCostPerKgUsd: String(fixedCostPerKgUsd),
            receiptValue: String(thisReceiptKg * fixedCostPerKg),
            receiptValueUsd: String(thisReceiptKg * fixedCostPerKgUsd),
            currencyCode,
            fxRateToUsd: String(fxRate),
            createdBy: (req.session as any).userId || null,
          });

          // 5. Daybook entry for this incremental receipt — records the economic
          //    event of receiving additional kg at the fixed landed cost/kg.
          //    Financial charges (freight, commission, duty) were fully posted on
          //    the first receipt and must NOT be re-posted here.
          await writeDaybookEntry(tx, {
            companyId,
            txDate: offloadDate,
            txType: "OFFLOAD_RAW_STOCK",
            referenceId: (existingRawStock as any).id,
            description: `Continuation receipt — container ${container.containerNumber}: ${thisReceiptKg.toFixed(3)} kg at ${new Decimal(fixedCostPerKg).toDecimalPlaces(6).toFixed(6)}/kg (fixed landed rate)`,
            currencyCode,
            amountCurrency: new Decimal(thisReceiptKg).times(new Decimal(fixedCostPerKg)).toNumber(),
            fxRateToUsd: fxRate,
            metaJson: JSON.stringify({ containerId, sourceType: "BASE_MATERIAL", receiptKg: thisReceiptKg }),
          });

          return; // Skip all other financial posting — already done on first receipt
        }

        // ── FIRST RECEIPT PATH ───────────────────────────────────────────────────
        // 0. Update the supplier's locked raw-material rate using the moving-average
        //    formula, BEFORE inserting the new raw-stock row, so "remaining kg" reflects
        //    stock immediately before this offload (already-consumed stock never
        //    re-enters the average). Row-locks the supplier to serialize concurrent
        //    offloads. Only applies to a real supplier — manual/no-supplier containers
        //    have no locked rate to maintain.
        if (container.supplierId) {
          await applyOffloadMovingAverage(tx, {
            companyId,
            supplierId: container.supplierId,
            newReceivedKg: parseFloat(actualKg),
            newContainerLandedCostPerKgUsd: dCostPerKgUsd.toNumber(),
          });
        }

        // 1. Commission INSERT
        if (commInsertValues) {
          [commissionRecord] = await tx.insert(factoryContainerCommissions).values(commInsertValues).returning();
        }

        // 2. Raw stock INSERT
        [rawStock] = await tx
          .insert(factoryRawStock)
          .values({
            companyId,
            containerId,
            receivedKg: String(actualKg),
            costPerKg: dInclusiveCostPerKg.toDecimalPlaces(6).toFixed(6),
            costPerKgUsd: dCostPerKgUsd.toDecimalPlaces(6).toFixed(6),
          })
          .returning();

        // 3. Mix batch source INSERTs
        for (const alloc of mixBatchAllocationsArr) {
          const allocKg = parseFloat(alloc.weightKg || "0");
          if (!alloc.mixBatchId || allocKg <= 0) continue;
          // Mix-batch sources are valued in USD (cascade uses USD for blended
          // cost; writing native-currency cost here would skew multi-container
          // batches that blend different base currencies).
          const dAllocKg = new Decimal(allocKg);
          const dAllocCostUsd = dCostPerKgUsd.times(dAllocKg);
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: parseInt(alloc.mixBatchId),
            containerId,
            supplierId: container.supplierId || null,
            sourceType: "container",
            weightKg: String(allocKg),
            costPerKg: dCostPerKgUsd.toDecimalPlaces(6).toFixed(6),
            totalCost: dAllocCostUsd.toDecimalPlaces(6).toFixed(6),
          });
        }

        // 4. Container UPDATE (status + financials + pre-offload snapshot)
        await tx
          .update(factoryContainers)
          .set({
            status: newStatus,
            declaredKg: String(declaredKg),
            actualReceivedKg: String(actualKg),
            finalPayableAmount,
            differenceKg,
            currencyCode,
            fxRateToUsd: String(fxRate),
            // fxRate was already resolved above (explicit rate, USD, a fetched live
            // rate, or the container's own already-confirmed rate) — never left at the
            // unset default — so this offload's rate is confirmed. Without this flag,
            // every freshly-offloaded non-USD container would still read back as
            // "unresolved" everywhere fxRateConfirmed is checked (recalc, reverse-offload,
            // supplier balance reconciliation), even though the rate is known-good.
            fxRateConfirmed: true,
            fxRateToUsdOffload: String(fxRate),
            fxRateDateOffload: offloadDate,
            ratePerKgUsd: dCostPerKgUsd.toDecimalPlaces(6).toFixed(6),
            finalPayableAmountUsd,
            freight: String(freightVal),
            freightAccountId: reqFreightAccountId ? parseInt(reqFreightAccountId) : null,
            freightSupplierId: effectiveFreightSupplierId,
            otherCharges: String(otherChargesVal),
            otherChargesCurrencyCode: ocCcy || null,
            otherChargesAccountId: reqOtherChargesAccountId ? parseInt(reqOtherChargesAccountId) : null,
            otherChargesSupplierId: reqOtherChargesSupplierId ? parseInt(reqOtherChargesSupplierId) : null,
            commissionAmount: commTotalVal > 0 ? String(commTotalVal) : container.commissionAmount || "0",
            commissionCurrencyCode: commTotalVal > 0 ? commCurrencyForUsd : (container as any).commissionCurrencyCode || "USD",
            // Persist the resolved commission-specific FX rate so computeCorrectContainerCost
            // and repair scripts can use it without re-fetching.  When there is no commission
            // (commTotalVal == 0) clear all three fields so stale pre-offload values don't linger.
            commissionFxRateToUsd: commTotalVal > 0 ? String(commFxRateForUsd) : null,
            commissionFxRateConfirmed: commTotalVal > 0,
            commissionFxRateDate: commTotalVal > 0 ? offloadDate : null,
            dutyAmount: dutyStatus !== "NONE" ? String(parseFloat(reqDutyAmount || "0")) : null,
            dutyAccountId: reqDutyAccountId ? parseInt(reqDutyAccountId) : null,
            dutyStatus,
            dutyNotes: reqDutyNotes || null,
            preOffloadFreight: container.freight || "0",
            preOffloadFreightCurrencyCode: (container as any).freightCurrencyCode || container.currencyCode || "USD",
            preOffloadFreightAccountId: (container as any).freightAccountId || null,
            preOffloadFreightSupplierId: (container as any).freightSupplierId || null,
            preOffloadOtherCharges: container.otherCharges || "0",
            preOffloadOtherChargesAccountId: (container as any).otherChargesAccountId || null,
            preOffloadOtherChargesSupplierId: (container as any).otherChargesSupplierId || null,
            preOffloadStatus: container.status,
            preOffloadCommissionAmount: container.commissionAmount || "0",
            preOffloadCommissionCurrencyCode: (container as any).commissionCurrencyCode || "USD",
            preOffloadCommissionAccountId: (container as any).commissionAccountId || null,
            preOffloadCommissionSupplierId: (container as any).commissionSupplierId || null,
            preOffloadCommissionNotes: (container as any).commissionNotes || null,
            destination: reqDestination ? String(reqDestination).trim() : container.destination || null,
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));

        // 5. Additional charges INSERTs
        const insertedAdditionalCharges: any[] = [];
        if (additionalChargesArr.length > 0) {
          for (const charge of additionalChargesArr) {
            if (parseFloat(charge.amount || "0") > 0) {
              const [inserted] = await tx
                .insert(factoryOffloadAdditionalCharges)
                .values({
                  companyId,
                  containerId,
                  description: charge.description || "Additional Charge",
                  amount: String(charge.amount),
                  currencyCode: charge.currencyCode || currencyCode,
                  fxRateToUsd: String(charge.fxRateToUsd || (currencyCode === "USD" ? "1" : String(fxRate))),
                  // Same reasoning as the container/commission fix above: the rate used
                  // here is either explicitly supplied on the charge or the already-
                  // resolved offload fxRate, never an unset default — mark it confirmed
                  // so downstream reads (recalc, reversal, reconciliation) don't treat
                  // a known-good rate as unresolved.
                  fxRateConfirmed: true,
                  ledgerAccountId: charge.ledgerAccountId ? parseInt(charge.ledgerAccountId) : null,
                  supplierId: charge.supplierId ? parseInt(charge.supplierId) : null,
                })
                .returning();
              insertedAdditionalCharges.push(inserted);
            }
          }
        }

        // 6. Daybook entries
        // Use the value of THIS RECEIPT's kg (incremental), not the full container
        // value. For a fully-received container actualKg == declaredKg so the result
        // is identical. For a partial first receipt, posting the full container value
        // would overstate the daybook — only what we actually received today is an
        // economic event today.
        await writeDaybookEntry(tx, {
          companyId,
          txDate: offloadDate,
          txType: "OFFLOAD_RAW_STOCK",
          referenceId: rawStock.id,
          description: `Offloaded container ${container.containerNumber}: ${actualKg} kg at ${dInclusiveCostPerKg.toDecimalPlaces(6).toFixed(6)}/kg (inclusive)`,
          currencyCode,
          amountCurrency: dActualKg.times(dInclusiveCostPerKg).toNumber(),
          fxRateToUsd: fxRate,
          metaJson: JSON.stringify({ containerId, sourceType: "BASE_MATERIAL" }),
        });
        if (commissionRecord) {
          await writeDaybookEntry(tx, {
            companyId,
            txDate: offloadDate,
            txType: "COMMISSION",
            referenceId: commissionRecord.id,
            description: `Commission for ${commissionRecord.personName} on container ${container.containerNumber}`,
            currencyCode: commissionRecord.currencyCode || "USD",
            amountCurrency: parseFloat(commissionRecord.commissionTotal),
            fxRateToUsd: resolveStoredFxRateOrThrow(
              commissionRecord.currencyCode,
              commissionRecord.fxRateToUsd,
              (commissionRecord as any).fxRateConfirmed
            ),
            metaJson: JSON.stringify({ containerId, sourceType: "COMMISSION", commissionId: commissionRecord.id }),
          });
        }
        if (freightVal > 0) {
          await writeDaybookEntry(tx, {
            companyId,
            txDate: offloadDate,
            txType: "FREIGHT",
            referenceId: containerId,
            description: `Freight on container ${container.containerNumber}`,
            currencyCode: freightCcy,
            amountCurrency: freightVal,
            fxRateToUsd: freightCcy === "USD" ? 1 : freightFxRateVal,
            metaJson: JSON.stringify({ containerId, sourceType: "FREIGHT" }),
          });
        }
        if (otherChargesVal > 0) {
          await writeDaybookEntry(tx, {
            companyId,
            txDate: offloadDate,
            txType: "OTHER_CHARGE",
            referenceId: containerId,
            description: `Other charges on container ${container.containerNumber}`,
            currencyCode: ocCcy,
            amountCurrency: otherChargesVal,
            fxRateToUsd: ocCcy === "USD" ? 1 : ocFxRateVal,
            metaJson: JSON.stringify({ containerId, sourceType: "CONTAINER_OC" }),
          });
        }
        if (dutyVal > 0) {
          await writeDaybookEntry(tx, {
            companyId,
            txDate: offloadDate,
            txType: "DUTY",
            referenceId: containerId,
            description: `Duty on container ${container.containerNumber}`,
            currencyCode,
            amountCurrency: dutyVal,
            fxRateToUsd: fxRate,
            metaJson: JSON.stringify({ containerId, sourceType: "DUTY" }),
          });
        }
        for (const insertedCharge of insertedAdditionalCharges) {
          const chargeAmount = parseFloat(insertedCharge.amount || "0");
          if (chargeAmount > 0) {
            await writeDaybookEntry(tx, {
              companyId,
              txDate: offloadDate,
              txType: "OTHER_CHARGE",
              referenceId: containerId,
              description: `${insertedCharge.description} on container ${container.containerNumber}`,
              currencyCode: insertedCharge.currencyCode || currencyCode,
              amountCurrency: chargeAmount,
              fxRateToUsd: parseFloat(insertedCharge.fxRateToUsd || String(fxRate)),
              metaJson: JSON.stringify({ containerId, sourceType: "OFFLOAD_ADDITIONAL", chargeId: insertedCharge.id }),
            });
          }
        }

        // 7. Delete any creation-time FACTORY-FREIGHT vouchers and daybook entries
        //    before posting new offload ones (prevents double-posting).
        //    Container creation (factoryContainersRoutes.ts) posts a stable, non-suffixed
        //    `FACTORY-FREIGHT-{id}` voucher number when freight is set at creation time —
        //    match that exact form too, not just the `-{timestamp}` suffixed offload form,
        //    or the creation-time voucher survives and freight gets expensed twice.
        const existingFreightVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              or(
                eq(vouchers.voucherNumber, `FACTORY-FREIGHT-${containerId}`),
                ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${containerId}-%`)
              )
            )
          );
        if (existingFreightVouchers.length > 0) {
          const vIds = existingFreightVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "FREIGHT"),
              eq(factoryDaybookEntries.referenceId, containerId)
            )
          );

        // 8. Freight voucher (double-entry)
        if (freightVal > 0 && (reqFreightAccountId || effectiveFreightSupplierId)) {
          const freightVoucherNum = `FACTORY-FREIGHT-${containerId}-${Date.now()}`;
          const freightVoucherCcy = reqFreightCurrencyCode || currencyCode;
          const freightFx = parseFloat(reqFreightFxRate || String(fxRate));
          const [freightVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Journal",
              voucherNumber: freightVoucherNum,
              voucherDate: offloadDate,
              description: `Freight on container ${container.containerNumber}`,
              totalAmount: String(freightVal),
              currency: freightVoucherCcy,
              exchangeRate: String(freightFx),
              sourceModule: "FACTORY",
            })
            .returning();
          if (effectiveFreightSupplierId) {
            // Supplier: Dr Freight Expense / Cr Supplier Balance
            await tx.insert(voucherEntries).values({
              voucherId: freightVoucher.id,
              ledgerAccountId: freightExpenseAcctId!,
              debitAmount: String(freightVal),
              creditAmount: "0",
              narration: `Freight expense - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: freightVoucher.id,
              factorySupplierId: effectiveFreightSupplierId,
              debitAmount: "0",
              creditAmount: String(freightVal),
              narration: `Freight payable to supplier - container ${container.containerNumber}`,
            });
          } else {
            // No supplier: Dr Factory Charges Payable / Cr chosen account.
            // Both legs are plain ledger accounts here (no factorySupplierId), and
            // voucherEntries has no currency/fxRate column of its own — Net Position
            // and every other GL reader sum debitAmount/creditAmount assuming USD.
            // (Supplier-linked legs are the one exception: supplier balance routes
            // re-derive USD from vouchers.currency/exchangeRate downstream, so those
            // legs correctly stay in native currency — see the `if` branch above.)
            // Posting freightVal (native currency) here would silently misstate any
            // non-USD chosen account by the entire FX differential.
            await tx.insert(voucherEntries).values({
              voucherId: freightVoucher.id,
              ledgerAccountId: chargesPayableAcctId,
              debitAmount: String(freightUsd),
              creditAmount: "0",
              narration: `Freight payable - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: freightVoucher.id,
              ledgerAccountId: parseInt(reqFreightAccountId),
              debitAmount: "0",
              creditAmount: String(freightUsd),
              narration: `Freight - container ${container.containerNumber}`,
            });
          }
        }

        // 9. Other Charges voucher (double-entry)
        if (otherChargesVal > 0 && (reqOtherChargesAccountId || reqOtherChargesSupplierId)) {
          const ocMainVoucherNum = `FACTORY-OC-${containerId}-MAIN-${Date.now()}`;
          const ocVoucherCcy = reqOtherChargesCurrencyCode || currencyCode;
          const ocFx = parseFloat(reqOtherChargesFxRate || String(fxRate));
          const [ocMainVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Journal",
              voucherNumber: ocMainVoucherNum,
              voucherDate: offloadDate,
              description: `Other charges on container ${container.containerNumber}`,
              totalAmount: String(otherChargesVal),
              currency: ocVoucherCcy,
              exchangeRate: String(ocFx),
              sourceModule: "FACTORY",
            })
            .returning();
          if (reqOtherChargesSupplierId) {
            // Supplier: Dr OC Expense / Cr Supplier Balance
            await tx.insert(voucherEntries).values({
              voucherId: ocMainVoucher.id,
              ledgerAccountId: ocExpenseAcctId!,
              debitAmount: String(otherChargesVal),
              creditAmount: "0",
              narration: `Other charges expense - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: ocMainVoucher.id,
              factorySupplierId: parseInt(reqOtherChargesSupplierId),
              debitAmount: "0",
              creditAmount: String(otherChargesVal),
              narration: `Other charges payable to supplier - container ${container.containerNumber}`,
            });
          } else {
            // No supplier: Dr Factory Charges Payable / Cr chosen account.
            // Same reasoning as the freight branch above — both legs are plain
            // ledger accounts, so they must be posted in USD (ocUsd), not the raw
            // native-currency otherChargesVal, or a non-USD chosen account silently
            // misstates the true balance in every USD-summed report (Net Position,
            // balance sheet, etc).
            await tx.insert(voucherEntries).values({
              voucherId: ocMainVoucher.id,
              ledgerAccountId: chargesPayableAcctId,
              debitAmount: String(ocUsd),
              creditAmount: "0",
              narration: `Other charges payable - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: ocMainVoucher.id,
              ledgerAccountId: parseInt(reqOtherChargesAccountId),
              debitAmount: "0",
              creditAmount: String(ocUsd),
              narration: `Other charges - container ${container.containerNumber}`,
            });
          }
        }

        // 10. Additional charges vouchers (double-entry, Dr Factory Charges Payable / Cr chosen)
        for (const inserted of insertedAdditionalCharges) {
          const chargeAmount = parseFloat(inserted.amount || "0");
          if (chargeAmount <= 0) continue;
          if (!inserted.ledgerAccountId && !inserted.supplierId) continue;
          const addlChargeCcy = inserted.currencyCode || currencyCode;
          const addlChargeFxNum = parseFloat(inserted.fxRateToUsd || String(fxRate));
          const addlChargeFx = String(addlChargeFxNum);
          const addlChargeUsd = addlChargeCcy === "USD" ? chargeAmount : chargeAmount * addlChargeFxNum;
          const ocVoucherNum = `FACTORY-OC-${containerId}-${inserted.id}-${Date.now()}`;
          const [ocVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Journal",
              voucherNumber: ocVoucherNum,
              voucherDate: offloadDate,
              description: `${inserted.description} - container ${container.containerNumber}`,
              totalAmount: String(chargeAmount),
              currency: addlChargeCcy,
              exchangeRate: addlChargeFx,
              sourceModule: "FACTORY",
            })
            .returning();
          if (inserted.ledgerAccountId) {
            // Both legs are plain ledger accounts (no factorySupplierId) — post in
            // USD (addlChargeUsd), not the raw native-currency chargeAmount, for the
            // same reason as the freight/other-charges branches above: nothing
            // downstream converts a bare ledgerAccountId leg, so a non-USD amount
            // here silently misstates Net Position and every other USD-summed report.
            await tx.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: chargesPayableAcctId,
              debitAmount: String(addlChargeUsd),
              creditAmount: "0",
              narration: `${inserted.description} payable - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: inserted.ledgerAccountId,
              debitAmount: "0",
              creditAmount: String(addlChargeUsd),
              narration: `${inserted.description} - container ${container.containerNumber}`,
            });
          } else if (inserted.supplierId) {
            // Supplier-linked leg: keep native currency. Supplier balance routes
            // re-derive USD downstream from vouchers.currency/exchangeRate, so both
            // legs of this voucher stay in the charge's own currency.
            await tx.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: chargesPayableAcctId,
              debitAmount: String(chargeAmount),
              creditAmount: "0",
              narration: `${inserted.description} payable - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              factorySupplierId: inserted.supplierId,
              debitAmount: "0",
              creditAmount: String(chargeAmount),
              narration: `${inserted.description} - container ${container.containerNumber}`,
            });
          }
        }

        // 11. Record this first receipt event
        await tx.insert(factoryContainerReceipts).values({
          companyId,
          containerId,
          receiptDate: offloadDate,
          receivedKg: String(actualKg),
          cumulativeReceivedKg: String(actualKg),
          fixedCostPerKg: dInclusiveCostPerKg.toDecimalPlaces(6).toFixed(6),
          fixedCostPerKgUsd: dCostPerKgUsd.toDecimalPlaces(6).toFixed(6),
          receiptValue: dInclusiveCostPerKg.times(new Decimal(actualKg)).toDecimalPlaces(6).toFixed(6),
          receiptValueUsd: dCostPerKgUsd.times(new Decimal(actualKg)).toDecimalPlaces(6).toFixed(6),
          currencyCode,
          fxRateToUsd: String(fxRate),
          createdBy: (req.session as any).userId || null,
        });
      }); // ── end transaction ────────────────────────────────────────────────────

      res.json({ rawStock, commission: commissionRecord });
    } catch (error: any) {
      console.error("Error offloading container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── Reverse Offload ──────────────────────────────────────────────────────────
  app.post("/api/factory/containers/:id/reverse-offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.status !== "OFFLOADED" && container.status !== "PARTIALLY_RECEIVED") {
        return res.status(400).json({ message: "Only OFFLOADED or PARTIALLY_RECEIVED containers can be reversed" });
      }

      // Safety guard: block reversal if this container's raw stock has already been
      // consumed in a mix batch that has production usage (daily usage or pressing batches recorded).
      const mixSourceLinks = await db
        .select({ mixBatchId: factoryMixBatchSources.mixBatchId })
        .from(factoryMixBatchSources)
        .where(eq(factoryMixBatchSources.containerId, containerId));

      if (mixSourceLinks.length > 0) {
        const linkedBatchIds = [...new Set(mixSourceLinks.map((s: any) => s.mixBatchId))];
        const usedBatches = await db
          .select({
            id: factoryMixBatches.id,
            batchCode: factoryMixBatches.batchCode,
            usedKg: factoryMixBatches.usedKg,
          })
          .from(factoryMixBatches)
          .where(
            and(
              eq(factoryMixBatches.companyId, companyId),
              inArray(factoryMixBatches.id, linkedBatchIds),
              sql`${factoryMixBatches.usedKg}::numeric > 0`,
              // A soft-deleted batch no longer holds live production usage — its
              // consumption of this container's stock was already reversed by the
              // delete route (factoryMixBatchRoutes.ts). Without this filter, a
              // deleted batch's stale, never-reset usedKg field permanently blocks
              // reversing the offload even though nothing is actually consuming
              // the stock anymore.
              isNull(factoryMixBatches.deletedAt)
            )
          );

        if (usedBatches.length > 0) {
          const codes = usedBatches.map((b: any) => b.batchCode).join(", ");
          return res.status(400).json({
            message: `Cannot reverse offload: stock from this container has already been consumed in mix batch(es) ${codes}. Remove it from those batches first before reversing.`,
          });
        }
      }

      await db.transaction(async (tx) => {
        // 1. Find the raw stock entry for this container (fetch full cost fields
        //    so we can compute the supplier locked-rate correction below).
        const [rawStockRow] = await tx
          .select({
            id: factoryRawStock.id,
            receivedKg: factoryRawStock.receivedKg,
            usedKg: factoryRawStock.usedKg,
            costPerKgUsd: factoryRawStock.costPerKgUsd,
          })
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

        // 2. Find commission records for this container
        const commissionRows = await tx
          .select({ id: factoryContainerCommissions.id })
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              eq(factoryContainerCommissions.containerId, containerId)
            )
          );
        const commissionIds = commissionRows.map((r: any) => r.id);
        const hadOffloadCommission = commissionRows.length > 0;

        // 3. Delete daybook entries tied to this offload:
        //    - OFFLOAD_RAW_STOCK referencing the raw stock row id
        //    - COMMISSION referencing each commission record id
        //    - FREIGHT / OTHER_CHARGE / DUTY referencing the container id
        if (rawStockRow) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
                eq(factoryDaybookEntries.referenceId, rawStockRow.id)
              )
            );
        }
        if (commissionIds.length > 0) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "COMMISSION"),
                inArray(factoryDaybookEntries.referenceId, commissionIds)
              )
            );
        }
        // FREIGHT, OTHER_CHARGE, DUTY entries all reference containerId directly
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              inArray(factoryDaybookEntries.txType, ["FREIGHT", "OTHER_CHARGE", "DUTY"]),
              eq(factoryDaybookEntries.referenceId, containerId)
            )
          );

        // 4. Delete all double-entry accounting vouchers created at or after offload for this container:
        //    FACTORY-COMM-{id}-*   commission vouchers (from offload or pre-registration)
        //    FACTORY-FREIGHT-{id}-*  freight vouchers
        //    FACTORY-OC-{id}-*       other-charge and additional-charge vouchers
        //    (FACTORY-IMPORT-{id}-* and FACTORY-PAY-* are intentionally preserved)
        const containerVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              or(
                ilike(vouchers.voucherNumber, `FACTORY-COMM-${containerId}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${containerId}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-OC-${containerId}-%`)
              )
            )
          );
        if (containerVouchers.length > 0) {
          const vIds = containerVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }

        // 4b. Correct the supplier's locked rate before removing this container's
        //     stock. The offload moving-average blended this container's cost/kg
        //     into the supplier rate; reversing the offload must undo that blend.
        //
        //     Formula:
        //       supplierRemainingKgBefore = authoritative remaining kg (includes this row)
        //       containerRemainingKg      = rawStock.receivedKg - rawStock.usedKg
        //       supplierValueBefore       = supplierRemainingKgBefore × currentLockedRate
        //       containerRemainingValue   = containerRemainingKg × rawStock.costPerKgUsd
        //       supplierRemainingKgAfter  = supplierRemainingKgBefore − containerRemainingKg
        //       newLockedRate             = (supplierValueBefore − containerRemainingValue)
        //                                    ÷ supplierRemainingKgAfter  (or 0 when denom ≤ 0)
        if (container.supplierId && rawStockRow) {
          const currentLockedRate = await getLockedSupplierRate(tx, companyId, container.supplierId, {
            forUpdate: true,
          });
          const supplierRemainingKgBefore = new Decimal(
            await getAuthoritativeSupplierRemainingKg(tx, companyId, container.supplierId)
          );
          const containerRemainingKg = new Decimal(rawStockRow.receivedKg || "0").minus(
            new Decimal(rawStockRow.usedKg || "0")
          );
          const supplierValueBefore = supplierRemainingKgBefore.times(currentLockedRate);
          const containerRemainingValue = containerRemainingKg.times(new Decimal(rawStockRow.costPerKgUsd || "0"));
          const supplierRemainingKgAfter = supplierRemainingKgBefore.minus(containerRemainingKg);
          let newLockedRate: Decimal;
          if (supplierRemainingKgAfter.lte(0)) {
            newLockedRate = new Decimal(0);
          } else {
            newLockedRate = supplierValueBefore.minus(containerRemainingValue).div(supplierRemainingKgAfter);
            // Clamp tiny floating-point negatives caused by rounding
            if (newLockedRate.lt(0)) newLockedRate = new Decimal(0);
          }
          await tx
            .update(factorySuppliers)
            .set({
              currentRawMaterialCostPerKgUsd: newLockedRate.toDecimalPlaces(8).toFixed(8),
              updatedAt: new Date(),
            })
            .where(and(eq(factorySuppliers.id, container.supplierId), eq(factorySuppliers.companyId, companyId)));
        }

        // 5. Delete offload records: raw stock, commission records, additional charges, mix-batch links
        await tx
          .delete(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
        await tx
          .delete(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              eq(factoryContainerCommissions.containerId, containerId)
            )
          );
        await tx
          .delete(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.companyId, companyId),
              eq(factoryOffloadAdditionalCharges.containerId, containerId)
            )
          );
        // Remove mix-batch source links created during offload for this container
        await tx.delete(factoryMixBatchSources).where(eq(factoryMixBatchSources.containerId, containerId));

        // 6. Restore pre-offload charges and reset container to RECEIVED status.
        //    If a pre-offload snapshot exists (set during offload), restore those values
        //    so that charges entered at container-creation time are preserved.
        //    If no snapshot exists (container was offloaded before this logic was added),
        //    fall back to zeroing out the charges (legacy behaviour).
        const preFreight = (container as any).preOffloadFreight;
        const hasSnapshot = preFreight !== null && preFreight !== undefined;
        const restoredFreight = hasSnapshot ? String(preFreight || "0") : "0";
        const restoredFreightAccountId = hasSnapshot ? (container as any).preOffloadFreightAccountId || null : null;
        const restoredFreightSupplierId = hasSnapshot ? (container as any).preOffloadFreightSupplierId || null : null;
        const restoredFreightCurrencyCode = hasSnapshot
          ? (container as any).preOffloadFreightCurrencyCode || container.currencyCode || "USD"
          : container.currencyCode || "USD";
        const restoredOtherCharges = hasSnapshot ? String((container as any).preOffloadOtherCharges || "0") : "0";
        const restoredOtherChargesAccountId = hasSnapshot
          ? (container as any).preOffloadOtherChargesAccountId || null
          : null;
        const restoredOtherChargesSupplierId = hasSnapshot
          ? (container as any).preOffloadOtherChargesSupplierId || null
          : null;

        // Re-post the original creation-time FACTORY-FREIGHT voucher if one existed before offload
        const restoredFreightAmt = parseFloat(restoredFreight || "0");
        if (restoredFreightAmt > 0 && restoredFreightAccountId) {
          const restoredFreightVoucherNum = `FACTORY-FREIGHT-${containerId}-${Date.now()}`;
          const [restoredFreightVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Journal",
              voucherNumber: restoredFreightVoucherNum,
              voucherDate: container.arrivalDate || getClientDate(req),
              description: `Freight on container ${container.containerNumber}`,
              totalAmount: String(restoredFreightAmt),
              currency: restoredFreightCurrencyCode,
              // This re-posts a voucher that already existed pre-offload, using the
              // exact rate the original offload already booked its financials with —
              // it is not a new forward-going financial decision, so we reuse the
              // container's stored rate as-is rather than requiring it to be
              // "confirmed" (which would incorrectly block reversing legacy
              // containers offloaded before the fxRateConfirmed flag existed).
              exchangeRate: String(container.fxRateToUsd ?? "1"),
              sourceModule: "FACTORY",
            })
            .returning();
          // Dr Freight Expense
          await tx.insert(voucherEntries).values({
            voucherId: restoredFreightVoucher.id,
            ledgerAccountId: restoredFreightAccountId,
            debitAmount: String(restoredFreightAmt),
            creditAmount: "0",
            narration: `Freight expense - container ${container.containerNumber}`,
          });
          // Cr Supplier Payable (use the pre-offload freight supplier, or fall back to container supplier)
          const freightCreditorSupplierId = restoredFreightSupplierId || container.supplierId;
          if (freightCreditorSupplierId) {
            await tx.insert(voucherEntries).values({
              voucherId: restoredFreightVoucher.id,
              factorySupplierId: freightCreditorSupplierId,
              debitAmount: "0",
              creditAmount: String(restoredFreightAmt),
              narration: `Freight payable to supplier - container ${container.containerNumber}`,
            });
          }
        }

        // Restore pre-offload commission snapshot (if one was saved)
        const preCommAmt = (container as any).preOffloadCommissionAmount;
        const hasCommSnapshot = preCommAmt !== null && preCommAmt !== undefined;
        const restoredCommissionAmount = hasCommSnapshot ? String(preCommAmt || "0") : "0";
        const restoredCommissionCurrencyCode = hasCommSnapshot
          ? (container as any).preOffloadCommissionCurrencyCode || "USD"
          : "USD";
        const restoredCommissionAccountId = hasCommSnapshot
          ? (container as any).preOffloadCommissionAccountId || null
          : null;
        const restoredCommissionSupplierId = hasCommSnapshot
          ? (container as any).preOffloadCommissionSupplierId || null
          : null;
        const restoredCommissionNotes = hasCommSnapshot ? (container as any).preOffloadCommissionNotes || null : null;

        // Restore pre-offload status (fallback to "ARRIVED" for legacy containers without snapshot)
        const restoredStatus = (container as any).preOffloadStatus || "ARRIVED";

        await tx
          .update(factoryContainers)
          .set({
            status: restoredStatus,
            actualReceivedKg: null,
            differenceKg: null,
            declaredKg: null,
            // Restore pre-offload freight (or zero if no snapshot)
            freight: restoredFreight,
            freightCurrencyCode: restoredFreightCurrencyCode,
            freightAccountId: restoredFreightAccountId,
            freightSupplierId: restoredFreightSupplierId,
            // Restore pre-offload other charges (or zero if no snapshot)
            otherCharges: restoredOtherCharges,
            otherChargesAccountId: restoredOtherChargesAccountId,
            otherChargesSupplierId: restoredOtherChargesSupplierId,
            // Restore pre-offload commission
            commissionAmount: restoredCommissionAmount,
            commissionCurrencyCode: restoredCommissionCurrencyCode,
            commissionAccountId: restoredCommissionAccountId,
            commissionSupplierId: restoredCommissionSupplierId,
            commissionNotes: restoredCommissionNotes,
            // Clear duty (always offload-specific)
            dutyAmount: null,
            dutyAccountId: null,
            dutyStatus: "NONE",
            dutyNotes: null,
            // Clear computed financials
            finalPayableAmount: null,
            finalPayableAmountUsd: null,
            ratePerKgUsd: null,
            fxRateToUsdOffload: null,
            fxRateDateOffload: null,
            // Clear the pre-offload snapshot columns
            preOffloadFreight: null,
            preOffloadFreightCurrencyCode: null,
            preOffloadFreightAccountId: null,
            preOffloadFreightSupplierId: null,
            preOffloadOtherCharges: null,
            preOffloadOtherChargesAccountId: null,
            preOffloadOtherChargesSupplierId: null,
            preOffloadStatus: null,
            preOffloadCommissionAmount: null,
            preOffloadCommissionCurrencyCode: null,
            preOffloadCommissionAccountId: null,
            preOffloadCommissionSupplierId: null,
            preOffloadCommissionNotes: null,
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));
      });

      res.json({ message: "Offload reversed successfully. Container is back to its previous status." });
    } catch (error: any) {
      console.error("Error reversing offload:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
