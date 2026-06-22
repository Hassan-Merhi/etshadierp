import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
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
  factorySupplierCategories,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";



export function registerRawStockCrudRoutes(app: Express) {
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
          isNull(factoryRawMaterialAdjustments.deletedAt),
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
        // For ADD / REMOVE: soft-delete + clean up linked daybook entries and vouchers
        await db.transaction(async (tx: any) => {
          await tx.update(factoryRawMaterialAdjustments)
            .set({ deletedAt: new Date() })
            .where(and(eq(factoryRawMaterialAdjustments.id, id), eq(factoryRawMaterialAdjustments.companyId, companyId)));

          // Delete linked OFFLOAD_RAW_STOCK daybook entry (referenceId = adjustment id)
          await tx.delete(factoryDaybookEntries).where(and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
            eq(factoryDaybookEntries.referenceId, id)
          ));

          // Delete linked voucher (pattern: FACTORY-MANUAL-{id}-*)
          const linkedVouchers = await tx.select({ id: vouchers.id }).from(vouchers).where(and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY"),
            ilike(vouchers.voucherNumber, `FACTORY-MANUAL-${id}-%`)
          ));
          if (linkedVouchers.length > 0) {
            const vIds = linkedVouchers.map((v: any) => v.id);
            await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
            await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
          }
        });
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

      await db.transaction(async (tx: any) => {
        // Soft-delete the raw stock record
        await tx.update(factoryRawStock)
          .set({ deletedAt: new Date() })
          .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)));

        // Delete linked OFFLOAD_RAW_STOCK daybook entry
        await tx.delete(factoryDaybookEntries).where(and(
          eq(factoryDaybookEntries.companyId, companyId),
          eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
          eq(factoryDaybookEntries.referenceId, rawStockId)
        ));
      });

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

}
