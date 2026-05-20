import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "./_helpers";
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
  factorySupplierCategories,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerFactoryRawStockRoutes(app: Express) {
  app.get("/api/factory/raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Pre-fetch all suppliers with their category info for this company
      const supplierRows = await db
        .select({
          id: factorySuppliers.id,
          supplierCategoryId: factorySuppliers.supplierCategoryId,
          categoryName: factorySupplierCategories.name,
        })
        .from(factorySuppliers)
        .leftJoin(factorySupplierCategories, eq(factorySuppliers.supplierCategoryId, factorySupplierCategories.id))
        .where(eq(factorySuppliers.companyId, companyId));
      const supplierCategoryMap = new Map<number, { categoryId: number | null; categoryName: string | null }>();
      for (const s of supplierRows) {
        supplierCategoryMap.set(s.id, {
          categoryId: s.supplierCategoryId ?? null,
          categoryName: s.categoryName ?? null,
        });
      }

      const results = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
          origin: factoryContainers.origin,
          containerStatus: factoryContainers.status,
          currencyCode: factoryContainers.currencyCode,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(
          eq(factoryRawStock.companyId, companyId),
          sql`${factoryContainers.status} != 'DELETED'`,
          isNull(factoryRawStock.deletedAt),
          isNull(factoryContainers.deletedAt),
        ));

      const supplierMap = new Map<string, any>();
      for (const r of results) {
        const isOB = r.containerStatus === "OPENING_BALANCE";
        // Always merge by supplier — one row per supplier regardless of OB vs Container
        const key = r.supplierId ? `supplier-${r.supplierId}` : (r.supplierName || `unknown-${r.containerId}`);
        const received = parseFloat(r.receivedKg as string) || 0;
        const used = parseFloat(r.usedKg as string) || 0;
        const costPerKg = parseFloat(r.costPerKg as string) || 0;

        const costPerKgUsd = parseFloat(r.costPerKgUsd as string) || costPerKg;
        if (supplierMap.has(key)) {
          const existing = supplierMap.get(key)!;
          const prevTotalCost = existing._totalReceived * existing._avgCostPerKg;
          const newTotalCost = received * costPerKg;
          const prevTotalCostUsd = existing._totalReceived * existing._avgCostPerKgUsd;
          const newTotalCostUsd = received * costPerKgUsd;
          existing._totalReceived += received;
          existing._totalUsed += used;
          existing._avgCostPerKg = existing._totalReceived > 0
            ? (prevTotalCost + newTotalCost) / existing._totalReceived
            : 0;
          existing._avgCostPerKgUsd = existing._totalReceived > 0
            ? (prevTotalCostUsd + newTotalCostUsd) / existing._totalReceived
            : 0;
          if (new Date(r.offloadedAt) > new Date(existing.lastOffloaded)) {
            existing.lastOffloaded = r.offloadedAt;
          }
          // If any container for this supplier is not OB, show as Container
          if (!isOB) existing.sourceType = "CONTAINER";
        } else {
          const catInfo = r.supplierId ? (supplierCategoryMap.get(r.supplierId) || { categoryId: null, categoryName: null }) : { categoryId: null, categoryName: null };
          supplierMap.set(key, {
            supplierName: r.supplierName || "Unknown",
            supplierId: r.supplierId,
            categoryId: catInfo.categoryId,
            categoryName: catInfo.categoryName,
            sourceType: isOB ? "OPENING_BALANCE" : "CONTAINER",
            currencyCode: r.currencyCode || "USD",
            _totalReceived: received,
            _totalUsed: used,
            _avgCostPerKg: costPerKg,
            _avgCostPerKgUsd: costPerKgUsd,
            lastOffloaded: r.offloadedAt,
          });
        }
      }

      // Fetch manual adjustments and merge into supplierMap
      const adjustments = await db.select().from(factoryRawMaterialAdjustments)
        .where(and(eq(factoryRawMaterialAdjustments.companyId, companyId), isNull(factoryRawMaterialAdjustments.deletedAt)));

      for (const adj of adjustments) {
        if (adj.type === "DEDUCT") continue; // DEDUCT is history-only; receivedKg on rows already reduced
        const kg = parseFloat(adj.kg as string) || 0;
        const costPerKgAdj = parseFloat(adj.costPerKg as string) || 0;
        const isAdd = adj.type === "ADD";
        let key: string;
        let supplierName: string;
        let supplierId: number | null = null;
        if (adj.supplierId) {
          supplierId = adj.supplierId;
          // Use the same unified supplier key (matches container key generation above)
          key = `supplier-${adj.supplierId}`;
          const anyEntry = supplierMap.get(key);
          if (anyEntry) {
            supplierName = anyEntry.supplierName;
          } else {
            const [sup] = await db.select({ name: factorySuppliers.name })
              .from(factorySuppliers)
              .where(and(eq(factorySuppliers.id, adj.supplierId), eq(factorySuppliers.companyId, companyId)))
              .limit(1);
            supplierName = sup?.name || `Supplier #${adj.supplierId}`;
          }
        } else {
          // Standalone manual material (no supplier)
          supplierName = adj.materialLabel || "Manual Stock";
          key = `MANUAL__${supplierName}`;
        }

        if (supplierMap.has(key)) {
          const existing = supplierMap.get(key)!;
          if (isAdd) {
            const prevCost = existing._totalReceived * existing._avgCostPerKg;
            const newCost = kg * costPerKgAdj;
            existing._totalReceived += kg;
            existing._avgCostPerKg = existing._totalReceived > 0
              ? (prevCost + newCost) / existing._totalReceived : 0;
            existing._avgCostPerKgUsd = existing._avgCostPerKg;
          } else {
            existing._totalUsed += kg;
          }
        } else {
          const adjCatInfo = supplierId ? (supplierCategoryMap.get(supplierId) || { categoryId: null, categoryName: null }) : { categoryId: null, categoryName: null };
          supplierMap.set(key, {
            supplierName,
            supplierId,
            categoryId: adjCatInfo.categoryId,
            categoryName: adjCatInfo.categoryName,
            sourceType: "MANUAL",
            currencyCode: adj.currencyCode || "USD",
            _totalReceived: isAdd ? kg : 0,
            _totalUsed: isAdd ? 0 : kg,
            _avgCostPerKg: costPerKgAdj,
            _avgCostPerKgUsd: costPerKgAdj,
            lastOffloaded: adj.createdAt,
            _adjustmentIds: [adj.id],
          });
        }

        // Track adjustment IDs on existing MANUAL entries too
        if (supplierMap.has(key)) {
          const entry = supplierMap.get(key)!;
          if (entry.sourceType === "MANUAL") {
            entry._adjustmentIds = entry._adjustmentIds || [];
            if (!entry._adjustmentIds.includes(adj.id)) entry._adjustmentIds.push(adj.id);
          }
        }
      }

      const reservedRows = await db
        .select({
          supplierId: factoryMixBatchSources.supplierId,
          reservedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
        })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .where(and(
          eq(factoryMixBatches.companyId, companyId),
          sql`${factoryMixBatchSources.supplierId} IS NOT NULL`,
          sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`,
        ))
        .groupBy(factoryMixBatchSources.supplierId);

      const reservedBySupplierId = new Map<number, number>();
      for (const r of reservedRows) {
        if (r.supplierId) reservedBySupplierId.set(r.supplierId, parseFloat(r.reservedKg as string) || 0);
      }

      // Track which supplierIds have actual container raw stock records (those already
      // have usedKg properly maintained on the factoryRawStock rows).
      const supplierIdsWithContainerStock = new Set<number>(
        results.filter(r => r.supplierId).map(r => r.supplierId as number)
      );

      // For MANUAL-only suppliers (no factoryRawStock container records), usedKg is never
      // incremented on any DB row when a batch is completed. We must count kg from ALL
      // COMPLETED/CLOSED batch sources for those suppliers.
      // NOTE: do NOT filter by containerId here — a manual-supplier batch source may still
      // store a containerId value even though the supplier has no container stock rows.
      // We rely on supplierIdsWithContainerStock to skip suppliers already tracked.
      const completedBatchRows = await db
        .select({
          supplierId: factoryMixBatchSources.supplierId,
          consumedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
        })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .where(and(
          eq(factoryMixBatches.companyId, companyId),
          sql`${factoryMixBatchSources.supplierId} IS NOT NULL`,
          sql`${factoryMixBatches.status} IN ('CLOSED', 'COMPLETED')`,
        ))
        .groupBy(factoryMixBatchSources.supplierId);

      // Apply completed-batch consumption to MANUAL-only suppliers only
      for (const r of completedBatchRows) {
        if (!r.supplierId) continue;
        if (supplierIdsWithContainerStock.has(r.supplierId)) continue; // container stock handles it
        const consumed = parseFloat(r.consumedKg as string) || 0;
        const key = `supplier-${r.supplierId}`;
        if (supplierMap.has(key)) {
          supplierMap.get(key)!._totalUsed += consumed;
        }
      }

      // Build aggregated rows (reservedKg / freeKg will be fixed below for multi-row suppliers)
      const aggregated = Array.from(supplierMap.values()).map((s: any) => {
        const remainingKg = s._totalReceived - s._totalUsed;
        const valueRemaining = remainingKg * s._avgCostPerKg;
        const valueRemainingUsd = remainingKg * s._avgCostPerKgUsd;
        return {
          supplierName: s.supplierName,
          supplierId: s.supplierId,
          categoryId: s.categoryId ?? null,
          categoryName: s.categoryName ?? null,
          sourceType: s.sourceType,
          currencyCode: s.currencyCode,
          receivedKg: s._totalReceived.toFixed(3),
          usedKg: s._totalUsed.toFixed(3),
          remainingKg: remainingKg.toFixed(3),
          reservedKg: "0.000",
          freeKg: "0.000",
          costPerKg: s._avgCostPerKg.toFixed(4),
          costPerKgUsd: s._avgCostPerKgUsd.toFixed(4),
          valueRemaining: valueRemaining.toFixed(2),
          valueRemainingUsd: valueRemainingUsd.toFixed(2),
          lastOffloaded: s.lastOffloaded,
          adjustmentIds: s._adjustmentIds || [],
        };
      });

      // Distribute reserved kg across rows for the same supplier proportionally.
      // A supplier may have multiple rows (e.g. OPENING_BALANCE + MANUAL) — the total
      // reserved amount is shared across those rows so free kg remains correct.
      const rowsBySupplierId = new Map<number, typeof aggregated>();
      for (const row of aggregated) {
        if (row.supplierId) {
          if (!rowsBySupplierId.has(row.supplierId)) rowsBySupplierId.set(row.supplierId, []);
          rowsBySupplierId.get(row.supplierId)!.push(row);
        }
      }
      for (const [suppId, rows] of rowsBySupplierId) {
        const reserved = reservedBySupplierId.get(suppId) || 0;
        const totalRemaining = rows.reduce((sum, r) => sum + parseFloat(r.remainingKg), 0);
        // Allow negative freeKg so over-used stock is visible in the UI
        const totalFree = totalRemaining - reserved;
        if (rows.length === 1) {
          rows[0].reservedKg = reserved.toFixed(3);
          rows[0].freeKg = totalFree.toFixed(3);
        } else {
          // Proportional distribution across multiple rows
          for (const row of rows) {
            const rem = parseFloat(row.remainingKg);
            const proportion = totalRemaining > 0 ? rem / totalRemaining : 0;
            row.reservedKg = (reserved * proportion).toFixed(3);
            row.freeKg = (totalFree * proportion).toFixed(3);
          }
        }
      }

      res.json(aggregated);
    } catch (error: any) {
      console.error("Error fetching factory raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST update cost per kg for a supplier and cascade to mix batches + bales
  app.post("/api/factory/raw-stock/update-cost", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierId, newCostPerKg } = req.body;
      if (!supplierId) return res.status(400).json({ message: "supplierId is required" });
      const newCost = parseFloat(newCostPerKg);
      if (isNaN(newCost) || newCost < 0) return res.status(400).json({ message: "newCostPerKg must be a non-negative number" });

      await db.transaction(async (tx) => {
        // 1. Update costPerKg on all factory_raw_stock rows for this supplier
        const rawStockRows = await tx
          .select({ id: factoryRawStock.id })
          .from(factoryRawStock)
          .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
          .where(and(
            eq(factoryRawStock.companyId, companyId),
            eq(factoryContainers.supplierId, Number(supplierId)),
            sql`${factoryContainers.status} != 'DELETED'`
          ));

        for (const row of rawStockRows) {
          await tx.update(factoryRawStock)
            .set({ costPerKg: String(newCost), costPerKgUsd: String(newCost) })
            .where(eq(factoryRawStock.id, row.id));
        }

        // 1b. Also update ADD adjustments for this supplier so the weighted avg isn't pulled back
        await tx.update(factoryRawMaterialAdjustments)
          .set({ costPerKg: String(newCost) })
          .where(and(
            eq(factoryRawMaterialAdjustments.companyId, companyId),
            eq(factoryRawMaterialAdjustments.supplierId, Number(supplierId)),
            eq(factoryRawMaterialAdjustments.type, "ADD"),
          ));

        // 2. Update costPerKg + totalCost on factory_mix_batch_sources for this supplier
        const batchSources = await tx
          .select({
            id: factoryMixBatchSources.id,
            mixBatchId: factoryMixBatchSources.mixBatchId,
            weightKg: factoryMixBatchSources.weightKg,
          })
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.supplierId, Number(supplierId)));

        const affectedBatchIds = new Set<number>();
        for (const src of batchSources) {
          const wt = parseFloat(src.weightKg as string) || 0;
          await tx.update(factoryMixBatchSources)
            .set({
              costPerKg: String(newCost),
              totalCost: String((wt * newCost).toFixed(2)),
            })
            .where(eq(factoryMixBatchSources.id, src.id));
          affectedBatchIds.add(src.mixBatchId);
        }

        // 3. Recalculate blended cost for each affected mix batch
        for (const batchId of affectedBatchIds) {
          const allSources = await tx
            .select({
              weightKg: factoryMixBatchSources.weightKg,
              costPerKg: factoryMixBatchSources.costPerKg,
            })
            .from(factoryMixBatchSources)
            .where(eq(factoryMixBatchSources.mixBatchId, batchId));

          const totalWt = allSources.reduce((s, r) => s + (parseFloat(r.weightKg as string) || 0), 0);
          const totalCostSum = allSources.reduce((s, r) => {
            const wt = parseFloat(r.weightKg as string) || 0;
            const c = parseFloat(r.costPerKg as string) || 0;
            return s + wt * c;
          }, 0);
          const blendedCost = totalWt > 0 ? totalCostSum / totalWt : 0;

          await tx.update(factoryMixBatches)
            .set({
              costPerKg: String(blendedCost.toFixed(4)),
              totalCost: String(totalCostSum.toFixed(2)),
              updatedAt: new Date(),
            })
            .where(and(eq(factoryMixBatches.id, batchId), eq(factoryMixBatches.companyId, companyId)));

          // 4. Update costPerKg + totalCost on all bales belonging to this batch
          const balesInBatch = await tx
            .select({ id: factoryBales.id, weightKg: factoryBales.weightKg })
            .from(factoryBales)
            .where(and(
              eq(factoryBales.mixBatchId, batchId),
              eq(factoryBales.companyId, companyId),
              sql`${factoryBales.status} NOT IN ('DELETED','REMOVED')`
            ));

          for (const bale of balesInBatch) {
            const baleWt = parseFloat(bale.weightKg as string) || 0;
            await tx.update(factoryBales)
              .set({
                costPerKg: String(blendedCost.toFixed(2)),
                totalCost: String((baleWt * blendedCost).toFixed(2)),
                updatedAt: new Date(),
              })
              .where(eq(factoryBales.id, bale.id));
          }
        }
      });

      res.json({ success: true, message: "Cost updated and cascaded to mix batches and bales" });
    } catch (error: any) {
      console.error("Error updating raw stock cost:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST deduct from received_kg directly on factory_raw_stock rows for a supplier
  app.post("/api/factory/raw-stock/deduct-received", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierId, kg, notes, reference, costPerKg, currencyCode, txDate } = req.body;
      if (!supplierId) return res.status(400).json({ message: "supplierId is required" });
      if (!kg || parseFloat(kg) <= 0) return res.status(400).json({ message: "kg must be > 0" });

      const deductKg = parseFloat(kg);
      const costPerKgNum = costPerKg ? parseFloat(costPerKg) : 0;
      const ccy = currencyCode || "USD";
      const today = txDate || getClientDate(req);

      // Find all raw_stock rows for this supplier, ordered newest first
      const rows = await db
        .select({
          id: factoryRawStock.id,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .where(and(
          eq(factoryRawStock.companyId, companyId),
          eq(factoryContainers.supplierId, Number(supplierId)),
          sql`${factoryContainers.status} != 'DELETED'`
        ))
        .orderBy(desc(factoryRawStock.offloadedAt));

      // Free kg from actual rows
      const totalFreeFromRows = rows.reduce(
        (sum, r) => sum + Math.max(0, parseFloat(r.receivedKg as string) - parseFloat(r.usedKg as string)),
        0
      );

      // Free kg from ADD/REMOVE adjustments for this supplier
      const adjRows = await db
        .select({ type: factoryRawMaterialAdjustments.type, kg: factoryRawMaterialAdjustments.kg })
        .from(factoryRawMaterialAdjustments)
        .where(and(
          eq(factoryRawMaterialAdjustments.companyId, companyId),
          eq(factoryRawMaterialAdjustments.supplierId, Number(supplierId))
        ));
      const adjFree = adjRows.reduce((sum, a) => {
        if (a.type === "DEDUCT") return sum; // DEDUCT is history-only; receivedKg on rows already reduced
        const k = parseFloat(a.kg as string) || 0;
        return a.type === "ADD" ? sum + k : sum - k;
      }, 0);

      const totalFree = totalFreeFromRows + Math.max(0, adjFree);

      // Allow over-use: no guard here — deduction can drive remaining stock negative

      // Deduct from rows newest-first; allow received to go below used (negative stock)
      let remaining = deductKg;
      const updates: { id: number; newReceived: number }[] = [];
      for (const row of rows) {
        if (remaining <= 0) break;
        const received = parseFloat(row.receivedKg as string);
        // Allow over-use: deduct from received up to its full amount (may leave usedKg > receivedKg)
        const take = Math.min(remaining, received);
        if (take > 0) {
          updates.push({ id: row.id, newReceived: received - take });
          remaining -= take;
        }
      }

      // Any remaining kg after row deductions → create a REMOVE adjustment
      const adjDeductKg = remaining > 0.001 ? remaining : 0;

      let fxRate = 1;
      if (ccy !== "USD" && costPerKgNum > 0) {
        try { fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, ccy, today)); } catch { fxRate = 1; }
      }

      await db.transaction(async (tx) => {
        // 1. Update actual rows
        for (const u of updates) {
          await tx.update(factoryRawStock)
            .set({ receivedKg: String(u.newReceived.toFixed(3)) })
            .where(eq(factoryRawStock.id, u.id));
        }

        // 1b. Record a DEDUCT history entry for the amount taken from container rows
        // DEDUCT type is skipped in all balance calculations — it only exists for history visibility.
        const rowDeductKg = deductKg - adjDeductKg;
        if (rowDeductKg > 0.001) {
          await tx.insert(factoryRawMaterialAdjustments).values({
            companyId,
            date: today,
            type: "DEDUCT",
            kg: rowDeductKg.toFixed(3),
            costPerKg: costPerKgNum > 0 ? String(costPerKgNum) : "0",
            currencyCode: ccy,
            supplierId: Number(supplierId),
            notes: notes || null,
            reference: reference || null,
          });
        }

        // 2. REMOVE adjustment for any overflow (from adjustment-sourced free)
        let insertedAdj: any = null;
        if (adjDeductKg > 0) {
          [insertedAdj] = await tx.insert(factoryRawMaterialAdjustments).values({
            companyId,
            date: today,
            type: "REMOVE",
            kg: adjDeductKg.toFixed(3),
            costPerKg: costPerKgNum > 0 ? String(costPerKgNum) : "0",
            currencyCode: ccy,
            supplierId: Number(supplierId),
            notes: notes ? `${notes} (auto-adj)` : "Deduct from received (auto-adj)",
            reference: reference || null,
          }).returning();
        }

        // 3. Write daybook entry for the balance update (if costPerKg provided)
        if (costPerKgNum > 0) {
          const totalValue = deductKg * costPerKgNum;
          const totalValueUsd = totalValue * fxRate;

          const [sup] = await tx.select({ name: factorySuppliers.name })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, Number(supplierId)), eq(factorySuppliers.companyId, companyId)))
            .limit(1);
          const supplierName = sup?.name || `Supplier #${supplierId}`;

          await writeDaybookEntry(tx, {
            companyId,
            txDate: today,
            txType: "RAW_DEDUCT_RECEIVED",
            referenceId: Number(supplierId),
            description: `Deduct from received: ${deductKg} kg @ ${costPerKgNum} ${ccy} — ${supplierName}${notes ? ` (${notes})` : ""}`,
            currencyCode: ccy,
            amountCurrency: -totalValue,
            fxRateToUsd: fxRate,
            amountUsd: -totalValueUsd,
          });
        }
      });

      res.json({ deducted: deductKg, rowsUpdated: updates.length, adjCreated: adjDeductKg > 0 });
    } catch (error: any) {
      console.error("Error deducting received kg:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET all adjustments for display/audit
  app.get("/api/factory/raw-stock/adjustments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db.select({
        id: factoryRawMaterialAdjustments.id,
        companyId: factoryRawMaterialAdjustments.companyId,
        date: factoryRawMaterialAdjustments.date,
        type: factoryRawMaterialAdjustments.type,
        kg: factoryRawMaterialAdjustments.kg,
        costPerKg: factoryRawMaterialAdjustments.costPerKg,
        currencyCode: factoryRawMaterialAdjustments.currencyCode,
        supplierId: factoryRawMaterialAdjustments.supplierId,
        supplierName: factorySuppliers.name,
        materialLabel: factoryRawMaterialAdjustments.materialLabel,
        notes: factoryRawMaterialAdjustments.notes,
        createdAt: factoryRawMaterialAdjustments.createdAt,
      })
        .from(factoryRawMaterialAdjustments)
        .leftJoin(factorySuppliers, and(
          eq(factoryRawMaterialAdjustments.supplierId, factorySuppliers.id),
          eq(factorySuppliers.companyId, companyId)
        ))
        .where(and(
          eq(factoryRawMaterialAdjustments.companyId, companyId),
          isNull(factoryRawMaterialAdjustments.deletedAt),
        ))
        .orderBy(desc(factoryRawMaterialAdjustments.createdAt));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET combined history for a specific supplier's raw material
  // Returns adjustments + mix batch usage sorted newest-first
  app.get("/api/factory/raw-stock/history/:supplierId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseId(req.params.supplierId);
      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
      if (!supplierId) return res.status(400).json({ message: "supplierId required" });

      // 1. Manual adjustments for this supplier
      const adjRows = await db.select({
        id: factoryRawMaterialAdjustments.id,
        date: factoryRawMaterialAdjustments.date,
        type: factoryRawMaterialAdjustments.type,
        kg: factoryRawMaterialAdjustments.kg,
        costPerKg: factoryRawMaterialAdjustments.costPerKg,
        currencyCode: factoryRawMaterialAdjustments.currencyCode,
        notes: factoryRawMaterialAdjustments.notes,
        reference: factoryRawMaterialAdjustments.reference,
        materialLabel: factoryRawMaterialAdjustments.materialLabel,
        createdAt: factoryRawMaterialAdjustments.createdAt,
      })
        .from(factoryRawMaterialAdjustments)
        .where(and(
          eq(factoryRawMaterialAdjustments.companyId, companyId),
          eq(factoryRawMaterialAdjustments.supplierId, supplierId),
        ))
        .orderBy(desc(factoryRawMaterialAdjustments.createdAt));

      // 2. Mix batch usage: batch sources referencing this supplier (aggregate per batch)
      const batchSourceRows = await db.select({
        batchId: factoryMixBatches.id,
        batchCode: factoryMixBatches.batchCode,
        batchName: factoryMixBatches.name,
        batchStatus: factoryMixBatches.status,
        batchDate: factoryMixBatches.batchDate,
        createdAt: factoryMixBatches.createdAt,
        weightKg: factoryMixBatchSources.weightKg,
        costPerKg: factoryMixBatchSources.costPerKg,
      })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .where(and(
          eq(factoryMixBatches.companyId, companyId),
          eq(factoryMixBatchSources.supplierId, supplierId),
        ))
        .orderBy(desc(factoryMixBatches.createdAt));

      // Aggregate multiple source rows for the same batch into one timeline entry
      const batchAggMap = new Map<number, any>();
      for (const r of batchSourceRows) {
        if (batchAggMap.has(r.batchId)) {
          batchAggMap.get(r.batchId).kg += parseFloat(r.weightKg as string) || 0;
        } else {
          batchAggMap.set(r.batchId, {
            kind: "batch" as const,
            date: r.batchDate || r.createdAt,
            createdAt: r.createdAt,
            type: "USED",
            kg: parseFloat(r.weightKg as string) || 0,
            costPerKg: parseFloat(r.costPerKg as string) || 0,
            currencyCode: "USD",
            notes: null,
            label: `Mix Batch — ${r.batchName || r.batchCode}`,
            ref: r.batchCode,
            batchStatus: r.batchStatus,
            batchId: r.batchId,
          });
        }
      }
      const batches = Array.from(batchAggMap.values());

      // 3. Container-based raw stock receipts for this supplier
      const containerRows = await db.select({
        id: factoryRawStock.id,
        receivedKg: factoryRawStock.receivedKg,
        usedKg: factoryRawStock.usedKg,
        costPerKg: factoryRawStock.costPerKg,
        offloadedAt: factoryRawStock.offloadedAt,
        containerNumber: factoryContainers.containerNumber,
        origin: factoryContainers.origin,
        currencyCode: factoryContainers.currencyCode,
      })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .where(and(
          eq(factoryRawStock.companyId, companyId),
          eq(factoryContainers.supplierId, supplierId),
          sql`${factoryContainers.status} != 'DELETED'`,
        ))
        .orderBy(desc(factoryRawStock.offloadedAt));

      const receipts = containerRows.map(r => ({
        kind: "receipt" as const,
        date: r.offloadedAt,
        createdAt: r.offloadedAt,
        type: "RECEIPT",
        kg: parseFloat(r.receivedKg as string) || 0,
        usedKg: parseFloat(r.usedKg as string) || 0,
        rawStockId: r.id,
        costPerKg: parseFloat(r.costPerKg as string) || 0,
        currencyCode: r.currencyCode || "USD",
        notes: r.origin ? `Origin: ${r.origin}` : null,
        label: `Container Receipt — ${r.containerNumber || `#${r.id}`}`,
        ref: r.containerNumber || `CONTAINER-${r.id}`,
        batchStatus: null,
        batchId: null,
      }));

      // Also expose adjId on adjustments
      const adjustmentsWithId = adjRows.map(r => ({
        kind: "adjustment" as const,
        adjId: r.id,
        date: r.date || r.createdAt,
        createdAt: r.createdAt,
        type: r.type,
        kg: parseFloat(r.kg as string) || 0,
        costPerKg: parseFloat(r.costPerKg as string) || 0,
        currencyCode: r.currencyCode || "USD",
        notes: r.notes,
        reference: r.reference || null,
        label: r.type === "ADD" ? "Manual Addition" : r.type === "DEDUCT" ? "Deduct from Received" : "Manual Deduction",
        ref: r.reference ? r.reference : `ADJ-${r.id}`,
      }));

      const all = [...adjustmentsWithId, ...batches, ...receipts]
        .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());

      res.json(all);
    } catch (error: any) {
      console.error("Raw material history error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST create a new adjustment (ADD or REMOVE), or create a new standalone manual material
  app.post("/api/factory/raw-stock/adjustment", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { type, kg, costPerKg, currencyCode, supplierId, materialLabel, notes, reference, date, createVoucher } = req.body;
      if (!type || !["ADD", "REMOVE"].includes(type)) return res.status(400).json({ message: "type must be ADD or REMOVE" });
      if (!kg || parseFloat(kg) <= 0) return res.status(400).json({ message: "kg must be > 0" });
      if (!date) return res.status(400).json({ message: "date is required" });

      const kgNum = parseFloat(kg);
      const costNum = costPerKg ? parseFloat(costPerKg) : 0;
      const ccy = currencyCode || "USD";
      const resolvedSupplierId = supplierId ? Number(supplierId) : null;
      const totalAmount = kgNum * costNum;

      // Pre-fetch ledger account IDs before transaction (getOrCreateLedgerAccount must run outside tx)
      let rawMaterialAcctId: number | null = null;
      if (createVoucher && resolvedSupplierId && type === "ADD" && costNum > 0) {
        rawMaterialAcctId = await getOrCreateLedgerAccount(companyId, "FACTORY_RAW_MATERIAL_STOCK", "Factory Raw Material Stock", "ASSET");
      }

      let fxRate = 1;
      if (ccy !== "USD") {
        try { fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, ccy, date)); } catch { fxRate = 1; }
      }

      let inserted: any;
      await db.transaction(async (tx) => {
        [inserted] = await tx.insert(factoryRawMaterialAdjustments).values({
          companyId,
          date,
          type,
          kg: String(kgNum),
          costPerKg: costNum > 0 ? String(costNum) : "0",
          currencyCode: ccy,
          supplierId: resolvedSupplierId,
          materialLabel: materialLabel || null,
          notes: notes || null,
          reference: reference || null,
        }).returning();

        // Accounting voucher: Dr Raw Material Stock / Cr Supplier Account
        if (createVoucher && resolvedSupplierId && rawMaterialAcctId && totalAmount > 0) {
          // Look up supplier name for description
          const [sup] = await tx.select({ name: factorySuppliers.name })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, resolvedSupplierId), eq(factorySuppliers.companyId, companyId)))
            .limit(1);
          const supplierName = sup?.name || `Supplier #${resolvedSupplierId}`;

          const voucherNum = `FACTORY-MANUAL-${inserted.id}-${Date.now()}`;
          const [voucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: voucherNum,
            voucherDate: date,
            description: `Manual raw material purchase: ${kgNum} kg @ ${costNum}/${ccy} — ${supplierName}`,
            totalAmount: String(totalAmount),
            currency: ccy,
            exchangeRate: String(fxRate),
            sourceModule: "FACTORY",
          }).returning();

          // Dr Raw Material Stock
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: rawMaterialAcctId,
            debitAmount: String(totalAmount),
            creditAmount: "0",
            narration: `Raw material stock — ${kgNum} kg from ${supplierName}`,
          });

          // Cr Supplier
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            factorySupplierId: resolvedSupplierId,
            debitAmount: "0",
            creditAmount: String(totalAmount),
            narration: `Payable to ${supplierName} for raw material`,
          });

          await writeDaybookEntry(tx, {
            companyId,
            txDate: date,
            txType: "OFFLOAD_RAW_STOCK",
            referenceId: inserted.id,
            description: `Manual purchase: ${kgNum} kg @ ${costNum} ${ccy} from ${supplierName}`,
            currencyCode: ccy,
            amountCurrency: totalAmount,
            fxRateToUsd: fxRate,
          });
        }
      });

      res.json(inserted);
    } catch (error: any) {
      console.error("Error creating raw stock adjustment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE a specific adjustment
  app.delete("/api/factory/raw-stock/adjustments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      // Fetch the adjustment to know whether it has linked accounting
      const [adj] = await db.select().from(factoryRawMaterialAdjustments)
        .where(and(eq(factoryRawMaterialAdjustments.id, id), eq(factoryRawMaterialAdjustments.companyId, companyId), isNull(factoryRawMaterialAdjustments.deletedAt)))
        .limit(1);
      if (!adj) return res.status(404).json({ message: "Adjustment not found" });

      if (adj.type === "DEDUCT" && adj.supplierId) {
        // For DEDUCT: restore receivedKg on the supplier's raw stock rows (LIFO — newest first),
        // then hard-delete the record so it no longer appears in the list.
        const stockRows = await db
          .select({ id: factoryRawStock.id, receivedKg: factoryRawStock.receivedKg })
          .from(factoryRawStock)
          .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
          .where(and(
            eq(factoryRawStock.companyId, companyId),
            eq(factoryContainers.supplierId, adj.supplierId),
            sql`${factoryContainers.status} != 'DELETED'`,
          ))
          .orderBy(desc(factoryRawStock.offloadedAt));

        await db.transaction(async (tx) => {
          let remaining = parseFloat(String(adj.kg));
          for (const row of stockRows) {
            if (remaining <= 0.001) break;
            const received = parseFloat(String(row.receivedKg));
            // Add back all remaining to this row (newest first)
            await tx.update(factoryRawStock)
              .set({ receivedKg: String((received + remaining).toFixed(3)) })
              .where(eq(factoryRawStock.id, row.id));
            remaining = 0;
          }
          // Hard-delete the DEDUCT record
          await tx.delete(factoryRawMaterialAdjustments)
            .where(and(
              eq(factoryRawMaterialAdjustments.id, id),
              eq(factoryRawMaterialAdjustments.companyId, companyId),
            ));
        });
      } else {
        // For ADD / REMOVE: soft-delete (vouchers and daybook stay intact)
        await db.update(factoryRawMaterialAdjustments)
          .set({ deletedAt: new Date() })
          .where(and(eq(factoryRawMaterialAdjustments.id, id), eq(factoryRawMaterialAdjustments.companyId, companyId)));
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting raw stock adjustment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE a batch source entry for a supplier from a batch (reverses usedKg on raw stock)
  app.delete("/api/factory/raw-stock/batch-source", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batchId = parseId(req.body.batchId) ?? -1;
      const supplierId = parseId(req.body.supplierId) ?? -1;
      if (isNaN(batchId) || isNaN(supplierId)) return res.status(400).json({ message: "batchId and supplierId are required" });

      await db.transaction(async (tx: any) => {
        // Verify batch belongs to this company
        const [batch] = await tx.select().from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, batchId), eq(factoryMixBatches.companyId, companyId)))
          .limit(1);
        if (!batch) throw new Error("Batch not found");

        // Find all source records for this supplier in this batch
        const sources = await tx.select().from(factoryMixBatchSources)
          .where(and(
            eq(factoryMixBatchSources.mixBatchId, batchId),
            eq(factoryMixBatchSources.supplierId, supplierId),
          ));
        if (sources.length === 0) throw new Error("No source records found for this supplier in this batch");

        let totalKgToReverse = 0;
        let totalCostToReverse = 0;

        for (const src of sources) {
          const srcKg = parseFloat(src.weightKg as string) || 0;
          const srcCost = parseFloat(src.totalCost as string) || 0;
          totalKgToReverse += srcKg;
          totalCostToReverse += srcCost;

          // If this source references a container raw stock row, reverse usedKg
          if (src.containerId) {
            await tx.update(factoryRawStock)
              .set({ usedKg: sql`GREATEST(0, ${factoryRawStock.usedKg} - ${srcKg})` })
              .where(and(
                eq(factoryRawStock.companyId, companyId),
                eq(factoryRawStock.containerId, src.containerId),
              ));
          }
        }

        // Delete all source records for this supplier in this batch
        await tx.delete(factoryMixBatchSources)
          .where(and(
            eq(factoryMixBatchSources.mixBatchId, batchId),
            eq(factoryMixBatchSources.supplierId, supplierId),
          ));

        // Update the batch totals
        const newTotalKg = Math.max(0, parseFloat(batch.totalWeightKg as string) - totalKgToReverse);
        const newTotalCost = Math.max(0, parseFloat(batch.totalCost as string) - totalCostToReverse);
        const newCostPerKg = newTotalKg > 0 ? newTotalCost / newTotalKg : 0;

        await tx.update(factoryMixBatches)
          .set({
            totalWeightKg: String(newTotalKg),
            totalCost: String(newTotalCost),
            costPerKg: String(newCostPerKg),
            updatedAt: new Date(),
          })
          .where(eq(factoryMixBatches.id, batchId));
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting batch source:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE a container raw stock receipt (only if no kg has been used yet)
  app.delete("/api/factory/raw-stock/receipts/:rawStockId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawStockId = parseId(req.params.rawStockId);

      if (rawStockId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(rawStockId)) return res.status(400).json({ message: "Invalid rawStockId" });

      const [row] = await db.select().from(factoryRawStock)
        .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Raw stock record not found" });

      const usedKg = parseFloat(row.usedKg as string) || 0;
      if (usedKg > 0.001) {
        return res.status(400).json({
          message: `Cannot delete: ${usedKg.toFixed(3)} kg have already been used from this receipt in batches. Delete the batch sources first or edit the balance instead.`,
        });
      }

      // Soft-delete (recoverable from Settings → Deleted Items)
      await db.update(factoryRawStock)
        .set({ deletedAt: new Date() })
        .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting raw stock receipt:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH update receivedKg on a container raw stock record (fixes balance going forward)
  app.patch("/api/factory/raw-stock/receipts/:rawStockId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawStockId = parseId(req.params.rawStockId);

      if (rawStockId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(rawStockId)) return res.status(400).json({ message: "Invalid rawStockId" });

      const { receivedKg } = req.body;
      const newKg = parseFloat(receivedKg);
      if (isNaN(newKg) || newKg < 0) return res.status(400).json({ message: "receivedKg must be a non-negative number" });

      const [row] = await db.select().from(factoryRawStock)
        .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Raw stock record not found" });

      const usedKg = parseFloat(row.usedKg as string) || 0;
      if (newKg < usedKg - 0.001) {
        return res.status(400).json({
          message: `Cannot set receivedKg below already-used amount (${usedKg.toFixed(3)} kg used). Delete the batch sources first or set a higher value.`,
        });
      }

      await db.update(factoryRawStock)
        .set({ receivedKg: String(newKg) })
        .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating raw stock receipt:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/raw-stock/by-container", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
          containerNumber: factoryContainers.containerNumber,
          containerStatus: factoryContainers.status,
          supplierName: factorySuppliers.name,
          supplierId: factoryContainers.supplierId,
          origin: factoryContainers.origin,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(
          eq(factoryRawStock.companyId, companyId),
          sql`${factoryContainers.status} != 'DELETED'`,
          isNull(factoryRawStock.deletedAt),
          isNull(factoryContainers.deletedAt),
        ));

      const enriched = results.map((r: any) => {
        const received = parseFloat(r.receivedKg) || 0;
        const used = parseFloat(r.usedKg) || 0;
        const costPerKg = parseFloat(r.costPerKg) || 0;
        const remainingKg = received - used;
        return { ...r, remainingKg: remainingKg.toFixed(3) };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching factory raw stock by container:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/raw-stock/available-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const offloaded = await db
        .select({ containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const offloadedIds = offloaded.map((o: any) => o.containerId).filter(Boolean);

      const baseConditions = [
        eq(factoryContainers.companyId, companyId),
        sql`${factoryContainers.status} NOT IN ('DELETED', 'OPENING_BALANCE')`,
      ];

      if (offloadedIds.length > 0) {
        baseConditions.push(
          sql`${factoryContainers.id} NOT IN (${sql.join(offloadedIds.map((id: number) => sql`${id}`), sql`, `)})`
        );
      }

      const results = await db
        .select()
        .from(factoryContainers)
        .where(and(...baseConditions));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching available containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/raw-stock/offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        containerId, receivedKg, costPerKg, commission,
        currencyCode: reqCurrencyCode, fxRateToUsd: reqFxRate,
        freight: reqFreight, freightAccountId: reqFreightAccountId,
        freightSupplierId: reqFreightSupplierId,
        freightCurrencyCode: reqFreightCurrencyCode,
        freightFxRate: reqFreightFxRate,
        otherCharges: reqOtherCharges, otherChargesAccountId: reqOtherChargesAccountId,
        otherChargesSupplierId: reqOtherChargesSupplierId,
        otherChargesCurrencyCode: reqOtherChargesCurrencyCode,
        otherChargesFxRate: reqOtherChargesFxRate,
        dutyAmount: reqDutyAmount, dutyAccountId: reqDutyAccountId,
        dutyStatus: reqDutyStatus, dutyNotes: reqDutyNotes,
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

      const [existing] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      if (existing) return res.status(400).json({ message: "This container has already been offloaded" });

      const currencyCode = reqCurrencyCode || container.currencyCode || "USD";
      const today = getClientDate(req);
      const offloadDate = reqOffloadDate || today;
      const mixBatchAllocationsArr = Array.isArray(reqMixBatchAllocations) ? reqMixBatchAllocations : [];

      let fxRate: number;
      if (reqFxRate && parseFloat(reqFxRate) > 0) {
        // User explicitly set the FX rate — always honour it
        fxRate = parseFloat(reqFxRate);
      } else {
        try {
          fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, currencyCode, offloadDate));
        } catch {
          fxRate = parseFloat(container.fxRateToUsd || "1");
        }
      }

      const declaredKg = container.totalKg || "0";
      const actualKg = receivedKg || declaredKg;
      const baseCostPerKg = costPerKg || container.ratePerKg || "0";
      const differenceKg = String(parseFloat(declaredKg) - parseFloat(actualKg));
      const basePayable = parseFloat(actualKg) * parseFloat(baseCostPerKg);

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
        const amtInContainerCcy = currencyCode === "USD" ? amtUsd : (fxRate > 0 ? amtUsd / fxRate : amtUsd);
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
        commTotalVal = commType === "PER_KG"
          ? commRate * parseFloat(actualKg)
          : commRate;
        const commCurrency = commission.currencyCode || currencyCode;
        const commFxRate = parseFloat(commission.fxRateToUsd || String(fxRate));
        commCurrencyForUsd = commCurrency;
        commFxRateForUsd = commFxRate;
        const commTotalUsd = commCurrency === "USD" ? commTotalVal : commTotalVal * commFxRate;
        commInContainerCcy = commCurrency === currencyCode ? commTotalVal : (fxRate > 0 ? commTotalUsd / fxRate : commTotalUsd);
        commInsertValues = {
          companyId,
          containerId,
          personName: commission.personName,
          commissionType: commType,
          commissionRate: String(commRate),
          commissionTotal: String(commTotalVal),
          currencyCode: commCurrency,
          fxRateToUsd: String(commFxRate),
          commissionTotalUsd: String(commTotalUsd),
          ledgerAccountId: commission.ledgerAccountId ? parseInt(commission.ledgerAccountId) : null,
        };
      }

      // Compute per-component USD values (each charge may be in its own currency)
      const freightCcy = reqFreightCurrencyCode || currencyCode;
      const freightFxRateVal = parseFloat(reqFreightFxRate || String(fxRate));
      const freightUsd = freightCcy === "USD" ? freightVal : freightVal * freightFxRateVal;
      // Convert freight to container currency for totalCost
      const freightInContainerCcy = (freightCcy === currencyCode) ? freightVal : (fxRate > 0 ? freightUsd / fxRate : freightVal);

      const ocCcy = reqOtherChargesCurrencyCode || currencyCode;
      const ocFxRateVal = parseFloat(reqOtherChargesFxRate || String(fxRate));
      const ocUsd = ocCcy === "USD" ? otherChargesVal : otherChargesVal * ocFxRateVal;
      // Convert OC to container currency for totalCost
      const ocInContainerCcy = (ocCcy === currencyCode) ? otherChargesVal : (fxRate > 0 ? ocUsd / fxRate : otherChargesVal);

      const totalCost = basePayable + freightInContainerCcy + ocInContainerCcy + additionalChargesTotal + commInContainerCcy + dutyVal;
      const inclusiveCostPerKg = parseFloat(actualKg) > 0 ? totalCost / parseFloat(actualKg) : 0;
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
      const costPerKgUsd = parseFloat(actualKg) > 0 ? totalUsd / parseFloat(actualKg) : 0;
      const finalPayableAmountUsd = String(totalUsd);

      const newStatus = parseFloat(actualKg) < parseFloat(declaredKg) ? "PARTIALLY_RECEIVED" : "OFFLOADED";

      // ── Pre-fetch ledger accounts BEFORE opening the transaction ──────────────
      // getOrCreateLedgerAccount uses the raw db connection and must not run inside
      // a transaction (it performs its own upsert). We resolve all IDs here so the
      // transaction body only uses tx.* calls and stays fully atomic.
      const chargesPayableAcctId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
      const freightExpenseAcctId = (freightVal > 0 && reqFreightSupplierId)
        ? (reqFreightAccountId
            ? parseInt(reqFreightAccountId)
            : await getOrCreateLedgerAccount(companyId, "FACTORY_FREIGHT_EXPENSE", "Freight Expense"))
        : null;
      const ocExpenseAcctId = (otherChargesVal > 0 && reqOtherChargesSupplierId)
        ? (reqOtherChargesAccountId
            ? parseInt(reqOtherChargesAccountId)
            : await getOrCreateLedgerAccount(companyId, "FACTORY_OC_EXPENSE", "Other Charges Expense"))
        : null;

      // ── Single atomic transaction: all DB writes happen here or not at all ────
      let rawStock: any;

      await db.transaction(async (tx) => {
        // 1. Commission INSERT
        if (commInsertValues) {
          [commissionRecord] = await tx
            .insert(factoryContainerCommissions)
            .values(commInsertValues)
            .returning();
        }

        // 2. Raw stock INSERT
        [rawStock] = await tx
          .insert(factoryRawStock)
          .values({
            companyId,
            containerId,
            receivedKg: String(actualKg),
            costPerKg: String(inclusiveCostPerKg),
            costPerKgUsd: String(costPerKgUsd),
          })
          .returning();

        // 3. Mix batch source INSERTs
        for (const alloc of mixBatchAllocationsArr) {
          const allocKg = parseFloat(alloc.weightKg || "0");
          if (!alloc.mixBatchId || allocKg <= 0) continue;
          const allocCost = inclusiveCostPerKg * allocKg;
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: parseInt(alloc.mixBatchId),
            containerId,
            supplierId: container.supplierId || null,
            sourceType: "container",
            weightKg: String(allocKg),
            costPerKg: String(inclusiveCostPerKg),
            totalCost: String(allocCost),
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
            fxRateToUsdOffload: String(fxRate),
            fxRateDateOffload: offloadDate,
            ratePerKgUsd: String(costPerKgUsd),
            finalPayableAmountUsd,
            freight: String(freightVal),
            freightAccountId: reqFreightAccountId ? parseInt(reqFreightAccountId) : null,
            freightSupplierId: reqFreightSupplierId ? parseInt(reqFreightSupplierId) : null,
            otherCharges: String(otherChargesVal),
            otherChargesCurrencyCode: ocCcy || null,
            otherChargesAccountId: reqOtherChargesAccountId ? parseInt(reqOtherChargesAccountId) : null,
            otherChargesSupplierId: reqOtherChargesSupplierId ? parseInt(reqOtherChargesSupplierId) : null,
            commissionAmount: commTotalVal > 0 ? String(commTotalVal) : (container.commissionAmount || "0"),
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
            destination: reqDestination ? String(reqDestination).trim() : (container.destination || null),
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
                  ledgerAccountId: charge.ledgerAccountId ? parseInt(charge.ledgerAccountId) : null,
                  supplierId: charge.supplierId ? parseInt(charge.supplierId) : null,
                })
                .returning();
              insertedAdditionalCharges.push(inserted);
            }
          }
        }

        // 6. Daybook entries
        await writeDaybookEntry(tx, {
          companyId,
          txDate: offloadDate,
          txType: "OFFLOAD_RAW_STOCK",
          referenceId: rawStock.id,
          description: `Offloaded container ${container.containerNumber}: ${actualKg} kg at ${inclusiveCostPerKg.toFixed(4)}/kg (inclusive)`,
          currencyCode,
          amountCurrency: totalCost,
          fxRateToUsd: fxRate,
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
            fxRateToUsd: parseFloat(commissionRecord.fxRateToUsd || "1"),
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
          });
        }
        for (const charge of additionalChargesArr) {
          const chargeAmount = parseFloat(charge.amount || "0");
          if (charge.description && chargeAmount > 0) {
            await writeDaybookEntry(tx, {
              companyId,
              txDate: offloadDate,
              txType: "OTHER_CHARGE",
              referenceId: containerId,
              description: `${charge.description} on container ${container.containerNumber}`,
              currencyCode: charge.currencyCode || currencyCode,
              amountCurrency: chargeAmount,
              fxRateToUsd: parseFloat(charge.fxRateToUsd || String(fxRate)),
            });
          }
        }

        // 7. Delete any creation-time FACTORY-FREIGHT vouchers and daybook entries
        //    before posting new offload ones (prevents double-posting).
        const existingFreightVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY"),
            ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${containerId}-%`)
          ));
        if (existingFreightVouchers.length > 0) {
          const vIds = existingFreightVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }
        await tx.delete(factoryDaybookEntries).where(and(
          eq(factoryDaybookEntries.companyId, companyId),
          eq(factoryDaybookEntries.txType, "FREIGHT"),
          eq(factoryDaybookEntries.referenceId, containerId)
        ));

        // 8. Freight voucher (double-entry)
        if (freightVal > 0 && (reqFreightAccountId || reqFreightSupplierId)) {
          const freightVoucherNum = `FACTORY-FREIGHT-${containerId}-${Date.now()}`;
          const freightVoucherCcy = reqFreightCurrencyCode || currencyCode;
          const freightFx = parseFloat(reqFreightFxRate || String(fxRate));
          const [freightVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: freightVoucherNum,
            voucherDate: offloadDate,
            description: `Freight on container ${container.containerNumber}`,
            totalAmount: String(freightVal),
            currency: freightVoucherCcy,
            exchangeRate: String(freightFx),
            sourceModule: "FACTORY",
          }).returning();
          if (reqFreightSupplierId) {
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
              factorySupplierId: parseInt(reqFreightSupplierId),
              debitAmount: "0",
              creditAmount: String(freightVal),
              narration: `Freight payable to supplier - container ${container.containerNumber}`,
            });
          } else {
            // No supplier: Dr Factory Charges Payable / Cr chosen account
            await tx.insert(voucherEntries).values({
              voucherId: freightVoucher.id,
              ledgerAccountId: chargesPayableAcctId,
              debitAmount: String(freightVal),
              creditAmount: "0",
              narration: `Freight payable - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: freightVoucher.id,
              ledgerAccountId: parseInt(reqFreightAccountId),
              debitAmount: "0",
              creditAmount: String(freightVal),
              narration: `Freight - container ${container.containerNumber}`,
            });
          }
        }

        // 9. Other Charges voucher (double-entry)
        if (otherChargesVal > 0 && (reqOtherChargesAccountId || reqOtherChargesSupplierId)) {
          const ocMainVoucherNum = `FACTORY-OC-${containerId}-MAIN-${Date.now()}`;
          const ocVoucherCcy = reqOtherChargesCurrencyCode || currencyCode;
          const ocFx = parseFloat(reqOtherChargesFxRate || String(fxRate));
          const [ocMainVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: ocMainVoucherNum,
            voucherDate: offloadDate,
            description: `Other charges on container ${container.containerNumber}`,
            totalAmount: String(otherChargesVal),
            currency: ocVoucherCcy,
            exchangeRate: String(ocFx),
            sourceModule: "FACTORY",
          }).returning();
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
            // No supplier: Dr Factory Charges Payable / Cr chosen account
            await tx.insert(voucherEntries).values({
              voucherId: ocMainVoucher.id,
              ledgerAccountId: chargesPayableAcctId,
              debitAmount: String(otherChargesVal),
              creditAmount: "0",
              narration: `Other charges payable - container ${container.containerNumber}`,
            });
            await tx.insert(voucherEntries).values({
              voucherId: ocMainVoucher.id,
              ledgerAccountId: parseInt(reqOtherChargesAccountId),
              debitAmount: "0",
              creditAmount: String(otherChargesVal),
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
          const addlChargeFx = String(parseFloat(inserted.fxRateToUsd || String(fxRate)));
          const ocVoucherNum = `FACTORY-OC-${containerId}-${inserted.id}-${Date.now()}`;
          const [ocVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: ocVoucherNum,
            voucherDate: offloadDate,
            description: `${inserted.description} - container ${container.containerNumber}`,
            totalAmount: String(chargeAmount),
            currency: addlChargeCcy,
            exchangeRate: addlChargeFx,
            sourceModule: "FACTORY",
          }).returning();
          await tx.insert(voucherEntries).values({
            voucherId: ocVoucher.id,
            ledgerAccountId: chargesPayableAcctId,
            debitAmount: String(chargeAmount),
            creditAmount: "0",
            narration: `${inserted.description} payable - container ${container.containerNumber}`,
          });
          if (inserted.ledgerAccountId) {
            await tx.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: inserted.ledgerAccountId,
              debitAmount: "0",
              creditAmount: String(chargeAmount),
              narration: `${inserted.description} - container ${container.containerNumber}`,
            });
          } else if (inserted.supplierId) {
            await tx.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              factorySupplierId: inserted.supplierId,
              debitAmount: "0",
              creditAmount: String(chargeAmount),
              narration: `${inserted.description} - container ${container.containerNumber}`,
            });
          }
        }
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
          .select({ id: factoryMixBatches.id, batchCode: factoryMixBatches.batchCode, usedKg: factoryMixBatches.usedKg })
          .from(factoryMixBatches)
          .where(and(
            eq(factoryMixBatches.companyId, companyId),
            inArray(factoryMixBatches.id, linkedBatchIds),
            sql`${factoryMixBatches.usedKg}::numeric > 0`
          ));

        if (usedBatches.length > 0) {
          const codes = usedBatches.map((b: any) => b.batchCode).join(", ");
          return res.status(400).json({
            message: `Cannot reverse offload: stock from this container has already been consumed in mix batch(es) ${codes}. Remove it from those batches first before reversing.`,
          });
        }
      }

      await db.transaction(async (tx) => {
        // 1. Find the raw stock entry for this container
        const [rawStockRow] = await tx
          .select({ id: factoryRawStock.id })
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

        // 2. Find commission records for this container
        const commissionRows = await tx
          .select({ id: factoryContainerCommissions.id })
          .from(factoryContainerCommissions)
          .where(and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId)));
        const commissionIds = commissionRows.map((r: any) => r.id);
        const hadOffloadCommission = commissionRows.length > 0;

        // 3. Delete daybook entries tied to this offload:
        //    - OFFLOAD_RAW_STOCK referencing the raw stock row id
        //    - COMMISSION referencing each commission record id
        //    - FREIGHT / OTHER_CHARGE / DUTY referencing the container id
        if (rawStockRow) {
          await tx.delete(factoryDaybookEntries).where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
              eq(factoryDaybookEntries.referenceId, rawStockRow.id)
            )
          );
        }
        if (commissionIds.length > 0) {
          await tx.delete(factoryDaybookEntries).where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "COMMISSION"),
              inArray(factoryDaybookEntries.referenceId, commissionIds)
            )
          );
        }
        // FREIGHT, OTHER_CHARGE, DUTY entries all reference containerId directly
        await tx.delete(factoryDaybookEntries).where(
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

        // 5. Delete offload records: raw stock, commission records, additional charges, mix-batch links
        await tx.delete(factoryRawStock).where(
          and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId))
        );
        await tx.delete(factoryContainerCommissions).where(
          and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId))
        );
        await tx.delete(factoryOffloadAdditionalCharges).where(
          and(eq(factoryOffloadAdditionalCharges.companyId, companyId), eq(factoryOffloadAdditionalCharges.containerId, containerId))
        );
        // Remove mix-batch source links created during offload for this container
        await tx.delete(factoryMixBatchSources).where(
          eq(factoryMixBatchSources.containerId, containerId)
        );

        // 6. Restore pre-offload charges and reset container to RECEIVED status.
        //    If a pre-offload snapshot exists (set during offload), restore those values
        //    so that charges entered at container-creation time are preserved.
        //    If no snapshot exists (container was offloaded before this logic was added),
        //    fall back to zeroing out the charges (legacy behaviour).
        const preFreight = (container as any).preOffloadFreight;
        const hasSnapshot = preFreight !== null && preFreight !== undefined;
        const restoredFreight = hasSnapshot ? String(preFreight || "0") : "0";
        const restoredFreightAccountId = hasSnapshot ? ((container as any).preOffloadFreightAccountId || null) : null;
        const restoredFreightSupplierId = hasSnapshot ? ((container as any).preOffloadFreightSupplierId || null) : null;
        const restoredFreightCurrencyCode = hasSnapshot ? ((container as any).preOffloadFreightCurrencyCode || container.currencyCode || "USD") : (container.currencyCode || "USD");
        const restoredOtherCharges = hasSnapshot ? String((container as any).preOffloadOtherCharges || "0") : "0";
        const restoredOtherChargesAccountId = hasSnapshot ? ((container as any).preOffloadOtherChargesAccountId || null) : null;
        const restoredOtherChargesSupplierId = hasSnapshot ? ((container as any).preOffloadOtherChargesSupplierId || null) : null;

        // Re-post the original creation-time FACTORY-FREIGHT voucher if one existed before offload
        const restoredFreightAmt = parseFloat(restoredFreight || "0");
        if (restoredFreightAmt > 0 && restoredFreightAccountId) {
          const restoredFreightVoucherNum = `FACTORY-FREIGHT-${containerId}-${Date.now()}`;
          const [restoredFreightVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: restoredFreightVoucherNum,
            voucherDate: container.arrivalDate || getClientDate(req),
            description: `Freight on container ${container.containerNumber}`,
            totalAmount: String(restoredFreightAmt),
            currency: restoredFreightCurrencyCode,
            exchangeRate: String(parseFloat(container.fxRateToUsd || "1")),
            sourceModule: "FACTORY",
          }).returning();
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
        const restoredCommissionCurrencyCode = hasCommSnapshot ? ((container as any).preOffloadCommissionCurrencyCode || "USD") : "USD";
        const restoredCommissionAccountId = hasCommSnapshot ? ((container as any).preOffloadCommissionAccountId || null) : null;
        const restoredCommissionSupplierId = hasCommSnapshot ? ((container as any).preOffloadCommissionSupplierId || null) : null;
        const restoredCommissionNotes = hasCommSnapshot ? ((container as any).preOffloadCommissionNotes || null) : null;

        // Restore pre-offload status (fallback to "ARRIVED" for legacy containers without snapshot)
        const restoredStatus = (container as any).preOffloadStatus || "ARRIVED";

        await tx.update(factoryContainers).set({
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
        }).where(eq(factoryContainers.id, containerId));
      });

      res.json({ message: "Offload reversed successfully. Container is back to its previous status." });
    } catch (error: any) {
      console.error("Error reversing offload:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/containers/:id/confirm-duty", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const { dutyAmount, dutyNotes } = req.body;
      const userId = String((req.session as any).userId || (req.user as any)?.id || "system");

      if (!dutyAmount || parseFloat(dutyAmount) <= 0) {
        return res.status(400).json({ message: "Valid duty amount is required" });
      }

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.dutyStatus !== "PENDING") {
        return res.status(400).json({ message: "Only containers with PENDING duty can be confirmed" });
      }

      const oldDutyAmount = container.dutyAmount;
      const newDutyAmount = parseFloat(dutyAmount);

      await db.insert(factoryDutyAuditLog).values({
        companyId,
        containerId,
        oldDutyAmount: oldDutyAmount || "0",
        newDutyAmount: String(newDutyAmount),
        oldDutyStatus: container.dutyStatus,
        newDutyStatus: "CONFIRMED",
        notes: dutyNotes || null,
        updatedByUserId: userId,
      });

      const actualKg = parseFloat(container.actualReceivedKg || "0");
      const baseRate = parseFloat(container.ratePerKg || "0");
      const basePayable = actualKg * baseRate;
      const freightVal = parseFloat(container.freight || "0");
      const otherChargesVal = parseFloat(container.otherCharges || "0");
      const commissionVal = parseFloat(container.commissionAmount || "0");

      const additionalChargesRows = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(and(eq(factoryOffloadAdditionalCharges.containerId, containerId), eq(factoryOffloadAdditionalCharges.companyId, companyId)));
      const additionalChargesTotal = additionalChargesRows.reduce((sum: number, c: any) => sum + parseFloat(c.amount || "0"), 0);

      const totalCost = basePayable + freightVal + otherChargesVal + additionalChargesTotal + commissionVal + newDutyAmount;
      const newInclusiveCostPerKg = actualKg > 0 ? totalCost / actualKg : 0;
      const fxRate = parseFloat(container.fxRateToUsd || "1");
      const costPerKgUsd = (container.currencyCode || "USD") === "USD" ? newInclusiveCostPerKg : newInclusiveCostPerKg * fxRate;
      const finalPayableAmountUsd = String(actualKg * costPerKgUsd);

      await db
        .update(factoryContainers)
        .set({
          dutyAmount: String(newDutyAmount),
          dutyStatus: "CONFIRMED",
          dutyNotes: dutyNotes || container.dutyNotes,
          finalPayableAmount: String(totalCost),
          ratePerKgUsd: String(costPerKgUsd),
          finalPayableAmountUsd,
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      const [rawStock] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      if (rawStock) {
        await db
          .update(factoryRawStock)
          .set({
            costPerKg: String(newInclusiveCostPerKg),
            costPerKgUsd: String(costPerKgUsd),
          })
          .where(eq(factoryRawStock.id, rawStock.id));
      }

      // Propagate the updated cost to any mix batch sources that drew from this container,
      // then recalculate the weighted-average costPerKg on the parent mix batches.
      const containerMixSources = await db
        .select()
        .from(factoryMixBatchSources)
        .where(eq(factoryMixBatchSources.containerId, containerId));

      if (containerMixSources.length > 0) {
        for (const src of containerMixSources) {
          const newSourceTotalCost = parseFloat(src.weightKg) * newInclusiveCostPerKg;
          await db
            .update(factoryMixBatchSources)
            .set({
              costPerKg: String(newInclusiveCostPerKg),
              totalCost: String(newSourceTotalCost.toFixed(2)),
            })
            .where(eq(factoryMixBatchSources.id, src.id));
        }

        // Recalculate the weighted cost for every affected mix batch
        const affectedBatchIds = [...new Set(containerMixSources.map((s: any) => s.mixBatchId))];
        for (const batchId of affectedBatchIds) {
          const allSources = await db
            .select()
            .from(factoryMixBatchSources)
            .where(eq(factoryMixBatchSources.mixBatchId, batchId));
          const batchTotalCost = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.totalCost || "0"), 0);
          const batchTotalWeight = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.weightKg || "0"), 0);
          const batchCostPerKg = batchTotalWeight > 0 ? batchTotalCost / batchTotalWeight : 0;
          await db
            .update(factoryMixBatches)
            .set({
              costPerKg: String(batchCostPerKg.toFixed(4)),
              totalCost: String(batchTotalCost.toFixed(2)),
              updatedAt: new Date(),
            })
            .where(eq(factoryMixBatches.id, batchId));
        }
      }

      const today = req.body.txDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "DUTY",
        referenceId: containerId,
        description: `Duty confirmed for container ${container.containerNumber}: $${newDutyAmount.toFixed(2)}`,
        currencyCode: container.currencyCode || "USD",
        amountCurrency: newDutyAmount,
        fxRateToUsd: fxRate,
      });

      res.json({ message: "Duty confirmed and costs recalculated", newCostPerKg: newInclusiveCostPerKg });
    } catch (error: any) {
      console.error("Error confirming duty:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/containers/:id/duty-audit-log", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const logs = await db
        .select()
        .from(factoryDutyAuditLog)
        .where(and(eq(factoryDutyAuditLog.companyId, companyId), eq(factoryDutyAuditLog.containerId, containerId)))
        .orderBy(desc(factoryDutyAuditLog.createdAt));

      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching duty audit log:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/container-commissions/:containerId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.containerId);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const results = await db
        .select()
        .from(factoryContainerCommissions)
        .where(and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId)));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching commissions:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/raw-stock/opening-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierName, supplierId: reqSupplierId, receivedKg, costPerKg, currencyCode: reqCurrency, fxRateToUsd: reqFxRate, notes,
        commissionAmount: reqCommAmount, commissionCurrencyCode: reqCommCurrency,
        commissionFxRateToUsd: reqCommFxRate } = req.body;

      if (!supplierName || !String(supplierName).trim()) return res.status(400).json({ message: "Supplier name is required" });
      if (!receivedKg || parseFloat(receivedKg) <= 0) return res.status(400).json({ message: "Received KG must be positive" });
      if (!costPerKg || parseFloat(costPerKg) < 0) return res.status(400).json({ message: "Cost per KG must be non-negative" });

      const currencyCode = reqCurrency || "USD";
      const fxRate = parseFloat(reqFxRate || "1");
      const kgVal = parseFloat(receivedKg);
      const rateVal = parseFloat(costPerKg);
      const costPerKgUsd = currencyCode === "USD" ? rateVal : rateVal * fxRate;
      const totalPayable = kgVal * rateVal;
      const totalPayableUsd = kgVal * costPerKgUsd;
      const trimmedSupplierName = String(supplierName).trim();

      const result = await db.transaction(async (tx: any) => {
        // Use supplierId directly if provided, otherwise find-or-create by name
        let existingSupplier: any = null;
        if (reqSupplierId) {
          const [found] = await tx
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, parseInt(reqSupplierId)), eq(factorySuppliers.companyId, companyId)))
            .limit(1);
          existingSupplier = found;
          if (!existingSupplier) return res.status(404).json({ message: "Supplier not found" });
        } else {
          const [found] = await tx
            .select()
            .from(factorySuppliers)
            .where(and(
              eq(factorySuppliers.companyId, companyId),
              sql`lower(${factorySuppliers.name}) = lower(${trimmedSupplierName})`
            ))
            .limit(1);
          if (found) {
            existingSupplier = found;
          } else {
            const [newSupplier] = await tx
              .insert(factorySuppliers)
              .values({ companyId, name: trimmedSupplierName, isActive: true })
              .returning();
            existingSupplier = newSupplier;
          }
        }

        const year = new Date().getFullYear();
        const existingOBs = await tx
          .select({ containerNumber: factoryContainers.containerNumber })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), sql`${factoryContainers.containerNumber} LIKE ${"OB-" + year + "-%"}`));

        let nextNum = 1;
        for (const c of existingOBs) {
          const parts = c.containerNumber.split("-");
          const num = parseInt(parts[2]) || 0;
          if (num >= nextNum) nextNum = num + 1;
        }
        const containerNumber = `OB-${year}-${String(nextNum).padStart(4, "0")}`;

        const [container] = await tx
          .insert(factoryContainers)
          .values({
            companyId,
            containerNumber,
            supplierId: existingSupplier.id,
            origin: "Opening Balance",
            totalKg: String(kgVal),
            ratePerKg: String(rateVal),
            declaredKg: String(kgVal),
            actualReceivedKg: String(kgVal),
            finalPayableAmount: String(totalPayable),
            differenceKg: "0",
            currencyCode,
            fxRateToUsd: String(fxRate),
            ratePerKgUsd: String(costPerKgUsd),
            finalPayableAmountUsd: String(totalPayableUsd),
            notes: notes || "Opening balance import",
            status: "OPENING_BALANCE",
          })
          .returning();

        // Commission processing — auto-create/reuse "[SupplierName] Commission" sub-account
        const hasCommission = reqCommAmount && parseFloat(reqCommAmount) > 0;
        const commCurrency = reqCommCurrency || "USD";
        const commFxRate = parseFloat(reqCommFxRate || "1");
        const commAmountNum = hasCommission ? parseFloat(reqCommAmount) : 0;
        const commAmountUsd = hasCommission ? (commCurrency === "USD" ? commAmountNum : commAmountNum * commFxRate) : 0;

        let commissionSupplierId: number | null = null;
        if (hasCommission && existingSupplier) {
          const commName = `${existingSupplier.name} Commission`;
          const [existing] = await tx
            .select()
            .from(factorySuppliers)
            .where(and(
              eq(factorySuppliers.companyId, companyId),
              eq((factorySuppliers as any).parentId, existingSupplier.id),
              sql`lower(${factorySuppliers.name}) = lower(${commName})`
            ))
            .limit(1);
          if (existing) {
            commissionSupplierId = existing.id;
          } else {
            const [created] = await tx
              .insert(factorySuppliers)
              .values({ companyId, name: commName, isActive: true, parentId: existingSupplier.id } as any)
              .returning();
            commissionSupplierId = created.id;
          }
        }

        const [rawStock] = await tx
          .insert(factoryRawStock)
          .values({
            companyId,
            containerId: container.id,
            receivedKg: String(kgVal),
            costPerKg: String(rateVal),
            costPerKgUsd: String(costPerKgUsd),
            ...(hasCommission ? {
              commissionAmount: String(commAmountNum),
              commissionCurrencyCode: commCurrency,
              commissionFxRateToUsd: String(commFxRate),
              commissionAmountUsd: String(commAmountUsd),
              commissionSupplierId,
            } : {}),
          })
          .returning();

        const today = req.body.txDate || getClientDate(req);
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: "OPENING_BALANCE_RAW",
          referenceId: rawStock.id,
          description: `Opening balance: ${containerNumber} - ${kgVal} kg at ${rateVal}/kg (${currencyCode})`,
          currencyCode,
          amountCurrency: totalPayable,
          fxRateToUsd: fxRate,
        });

        return { container, rawStock };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating opening balance:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // GET a single opening-balance raw stock record
  app.get("/api/factory/raw-stock/opening-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [row] = await db
        .select({
          id: factoryRawStock.id,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          containerNumber: factoryContainers.containerNumber,
          containerStatus: factoryContainers.status,
          currencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          notes: factoryContainers.notes,
          origin: factoryContainers.origin,
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.id, id), eq(factoryRawStock.companyId, companyId)))
        .limit(1);

      if (!row) return res.status(404).json({ message: "Raw stock record not found" });
      if (row.containerStatus !== "OPENING_BALANCE") {
        return res.status(400).json({ message: "This record is not an opening balance entry" });
      }

      const received = parseFloat(row.receivedKg as string) || 0;
      const used = parseFloat(row.usedKg as string) || 0;

      res.json({ ...row, remainingKg: (received - used).toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching opening balance record:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH a single opening-balance raw stock record
  app.patch("/api/factory/raw-stock/opening-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const { supplierId: reqSupplierId, supplierName, receivedKg, costPerKg, currencyCode, fxRateToUsd, notes,
              commissionAmount, commissionCurrencyCode, commissionPersonName, commissionNotes, commissionFxRateToUsd } = req.body;

      if (receivedKg !== undefined && parseFloat(receivedKg) <= 0) {
        return res.status(400).json({ message: "Received KG must be positive" });
      }
      if (costPerKg !== undefined && parseFloat(costPerKg) < 0) {
        return res.status(400).json({ message: "Cost per KG must be non-negative" });
      }
      if (fxRateToUsd !== undefined && parseFloat(fxRateToUsd) <= 0) {
        return res.status(400).json({ message: "FX rate must be positive" });
      }

      const [rawStockRow] = await db
        .select({ id: factoryRawStock.id, containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .where(and(
          eq(factoryRawStock.id, id),
          eq(factoryRawStock.companyId, companyId),
          eq(factoryContainers.status, "OPENING_BALANCE")
        ))
        .limit(1);

      if (!rawStockRow) return res.status(404).json({ message: "Opening balance record not found" });

      await db.transaction(async (tx: any) => {
        const rawUpdates: Record<string, any> = {};
        const containerUpdates: Record<string, any> = {};

        if (receivedKg !== undefined) {
          rawUpdates.receivedKg = String(parseFloat(receivedKg));
          containerUpdates.totalKg = String(parseFloat(receivedKg));
          containerUpdates.declaredKg = String(parseFloat(receivedKg));
          containerUpdates.actualReceivedKg = String(parseFloat(receivedKg));
        }

        const effectiveCurrency = currencyCode || undefined;
        const effectiveFx = fxRateToUsd !== undefined ? parseFloat(fxRateToUsd) : undefined;
        const effectiveCost = costPerKg !== undefined ? parseFloat(costPerKg) : undefined;

        if (effectiveCost !== undefined) {
          rawUpdates.costPerKg = String(effectiveCost);
          containerUpdates.ratePerKg = String(effectiveCost);
        }
        if (effectiveCurrency !== undefined) containerUpdates.currencyCode = effectiveCurrency;
        if (effectiveFx !== undefined) containerUpdates.fxRateToUsd = String(effectiveFx);

        if (effectiveCost !== undefined || effectiveFx !== undefined || effectiveCurrency !== undefined) {
          const [current] = await tx
            .select({ costPerKg: factoryRawStock.costPerKg, currencyCode: factoryContainers.currencyCode, fxRateToUsd: factoryContainers.fxRateToUsd })
            .from(factoryRawStock)
            .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
            .where(eq(factoryRawStock.id, id))
            .limit(1);

          const resolvedCost = effectiveCost ?? parseFloat(current?.costPerKg || "0");
          const resolvedFx = effectiveFx ?? parseFloat(current?.fxRateToUsd || "1");
          const resolvedCurrency = effectiveCurrency ?? current?.currencyCode ?? "USD";
          const costUsd = resolvedCurrency === "USD" ? resolvedCost : resolvedCost * resolvedFx;
          rawUpdates.costPerKgUsd = String(costUsd);
          containerUpdates.ratePerKgUsd = String(costUsd);
        }

        if (notes !== undefined) containerUpdates.notes = notes;

        // Phase 4: commission field edits on OB raw-stock
        if (commissionAmount !== undefined) rawUpdates.commissionAmount = String(parseFloat(commissionAmount));
        if (commissionCurrencyCode !== undefined) rawUpdates.commissionCurrencyCode = commissionCurrencyCode;
        if (commissionPersonName !== undefined) rawUpdates.commissionPersonName = commissionPersonName;
        if (commissionNotes !== undefined) rawUpdates.commissionNotes = commissionNotes;
        if (commissionFxRateToUsd !== undefined) rawUpdates.commissionFxRateToUsd = String(parseFloat(commissionFxRateToUsd));
        if (commissionAmount !== undefined || commissionFxRateToUsd !== undefined || commissionCurrencyCode !== undefined) {
          const [cur] = await tx.select({ commissionCurrencyCode: factoryRawStock.commissionCurrencyCode, commissionFxRateToUsd: factoryRawStock.commissionFxRateToUsd })
            .from(factoryRawStock).where(eq(factoryRawStock.id, id)).limit(1);
          const resolvedCommCurr = commissionCurrencyCode ?? cur?.commissionCurrencyCode ?? "USD";
          const resolvedCommFx = parseFloat(commissionFxRateToUsd ?? cur?.commissionFxRateToUsd ?? "1");
          const resolvedCommAmt = parseFloat(commissionAmount ?? "0");
          rawUpdates.commissionAmountUsd = resolvedCommCurr === "USD" ? String(resolvedCommAmt) : String(resolvedCommAmt * resolvedCommFx);
        }

        if (reqSupplierId !== undefined) {
          const [sup] = await tx
            .select({ id: factorySuppliers.id })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, parseInt(reqSupplierId)), eq(factorySuppliers.companyId, companyId)))
            .limit(1);
          if (!sup) throw new Error("Supplier not found");
          containerUpdates.supplierId = sup.id;
        } else if (supplierName !== undefined) {
          const trimmed = String(supplierName).trim();
          const [found] = await tx
            .select({ id: factorySuppliers.id })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), sql`lower(${factorySuppliers.name}) = lower(${trimmed})`))
            .limit(1);
          if (found) {
            containerUpdates.supplierId = found.id;
          } else {
            const [created] = await tx
              .insert(factorySuppliers)
              .values({ companyId, name: trimmed, isActive: true })
              .returning();
            containerUpdates.supplierId = created.id;
          }
        }

        if (Object.keys(rawUpdates).length > 0) {
          await tx.update(factoryRawStock).set(rawUpdates).where(eq(factoryRawStock.id, id));
        }
        if (Object.keys(containerUpdates).length > 0) {
          await tx.update(factoryContainers).set(containerUpdates).where(eq(factoryContainers.id, rawStockRow.containerId));
        }
      });

      res.json({ message: "Opening balance updated successfully" });
    } catch (error: any) {
      console.error("Error updating opening balance:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // DELETE a single opening-balance raw stock record (bale-safe)
  app.delete("/api/factory/raw-stock/opening-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [rawStockRow] = await db
        .select({ id: factoryRawStock.id, containerId: factoryRawStock.containerId, containerStatus: factoryContainers.status })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .where(and(eq(factoryRawStock.id, id), eq(factoryRawStock.companyId, companyId)))
        .limit(1);

      if (!rawStockRow) return res.status(404).json({ message: "Raw stock record not found" });
      if (rawStockRow.containerStatus !== "OPENING_BALANCE") {
        return res.status(400).json({ message: "This record is not an opening balance entry and cannot be deleted through this endpoint" });
      }

      await db.transaction(async (tx: any) => {
        // Safely detach: null out containerId on mix batch sources referencing this container
        await tx
          .update(factoryMixBatchSources)
          .set({ containerId: null })
          .where(eq(factoryMixBatchSources.containerId, rawStockRow.containerId));

        // Delete the raw stock row
        await tx.delete(factoryRawStock).where(eq(factoryRawStock.id, id));

        // Soft-delete the container by changing its status
        await tx
          .update(factoryContainers)
          .set({ status: "DELETED" })
          .where(eq(factoryContainers.id, rawStockRow.containerId));
      });

      res.json({ message: "Opening balance deleted. Linked bales remain intact." });
    } catch (error: any) {
      console.error("Error deleting opening balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all bales with no mix batch link (unlinked / not yet sourced from raw stock)
  app.get("/api/factory/bales/unlinked", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const bales = await db
        .select({
          id: factoryBales.id,
          baleCode: factoryBales.baleCode,
          referenceNumber: factoryBales.referenceNumber,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
          pressedAt: factoryBales.pressedAt,
        })
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            sql`${factoryBales.mixBatchId} IS NULL`,
            eq(factoryBales.status, "IN_STOCK"),
          ),
        )
        .orderBy(desc(factoryBales.pressedAt));

      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching unlinked bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Assign opening balance raw stock to already-pressed bales
  app.post("/api/factory/raw-stock/:rawStockId/assign-to-bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawStockId = parseId(req.params.rawStockId);

      if (rawStockId === null) return res.status(400).json({ message: "Invalid id" });
      const { baleIds } = req.body as { baleIds: number[] };

      if (!Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds must be a non-empty array" });
      }

      // Fetch the raw stock record
      const [rs] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)));

      if (!rs) return res.status(404).json({ message: "Raw stock record not found" });

      // Validate all bales exist, belong to this company, and have no mix batch
      const bales = await db
        .select({ id: factoryBales.id, weightKg: factoryBales.weightKg, mixBatchId: factoryBales.mixBatchId })
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

      if (bales.length !== baleIds.length) {
        return res.status(400).json({ message: "One or more bale IDs are invalid or belong to another company" });
      }
      const alreadyLinked = bales.filter((b) => b.mixBatchId !== null);
      if (alreadyLinked.length > 0) {
        return res.status(400).json({ message: `${alreadyLinked.length} bale(s) are already linked to a mix batch` });
      }

      const totalKg = bales.reduce((sum, b) => sum + parseFloat(b.weightKg as string), 0);
      // Allow over-use: no availability guard — stock can go negative

      const costPerKg = parseFloat(rs.costPerKg as string);
      const totalCost = totalKg * costPerKg;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        // 1. Create a completed mix batch to represent this OB assignment
        const obBatchCode = `OB-ASSIGN-${rawStockId}-${Date.now()}`;
        const [newBatch] = await tx
          .insert(factoryMixBatches)
          .values({
            companyId,
            batchCode: obBatchCode,
            batchNumber: obBatchCode,
            name: "OB Stock Assignment",
            totalWeightKg: totalKg.toFixed(3),
            usedKg: totalKg.toFixed(3),
            costPerKg: rs.costPerKg,
            totalCost: totalCost.toFixed(2),
            status: "COMPLETED",
            updatedAt: now,
          })
          .returning({ id: factoryMixBatches.id });

        // 2. Link the OB container as the source of this mix batch
        await tx.insert(factoryMixBatchSources).values({
          mixBatchId: newBatch.id,
          containerId: rs.containerId,
          weightKg: totalKg.toFixed(3),
          costPerKg: rs.costPerKg,
          totalCost: totalCost.toFixed(2),
        });

        // 3. Assign the mix batch to each bale
        await tx
          .update(factoryBales)
          .set({ mixBatchId: newBatch.id, updatedAt: now })
          .where(inArray(factoryBales.id, baleIds));

        // 4. Increment usedKg on the raw stock record
        await tx
          .update(factoryRawStock)
          .set({ usedKg: sql`${factoryRawStock.usedKg} + ${totalKg.toFixed(3)}` })
          .where(eq(factoryRawStock.id, rawStockId));

        return { mixBatchId: newBatch.id };
      });

      res.json({ success: true, mixBatchId: result.mixBatchId, totalKg, balesUpdated: baleIds.length });
    } catch (error: any) {
      console.error("Error assigning raw stock to bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Recalculate usedKg for all factory_raw_stock records based on active mix batch sources
  app.post("/api/factory/raw-stock/recalculate-used", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allRawStock = await db
        .select({ id: factoryRawStock.id, containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      if (allRawStock.length === 0) return res.json({ updated: 0 });

      const containerIds = allRawStock.map((r: any) => r.containerId);

      // Sum used kg from active mix batch source records (only existing batches, deleted batches have no sources)
      const sourceSums = await db
        .select({
          containerId: factoryMixBatchSources.containerId,
          totalUsedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
        })
        .from(factoryMixBatchSources)
        .where(inArray(factoryMixBatchSources.containerId, containerIds))
        .groupBy(factoryMixBatchSources.containerId);

      const usedByContainer: Record<number, number> = {};
      for (const row of sourceSums) {
        if (row.containerId) usedByContainer[row.containerId] = parseFloat(row.totalUsedKg || "0");
      }

      let updated = 0;
      const now = new Date();
      for (const rs of allRawStock) {
        const usedKg = usedByContainer[rs.containerId] || 0;
        await db
          .update(factoryRawStock)
          .set({ usedKg: usedKg.toFixed(3), updatedAt: now } as any)
          .where(eq(factoryRawStock.id, rs.id));
        updated++;
      }

      res.json({ updated, message: `Recalculated used KG for ${updated} raw stock records.` });
    } catch (error: any) {
      console.error("Error recalculating raw stock used:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6. Factory Mix Batches
  // ───────────────────────────────────────────────

}
