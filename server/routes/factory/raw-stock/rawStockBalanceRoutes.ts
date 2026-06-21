import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
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



export function registerRawStockBalanceRoutes(app: Express) {
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

  // ── Recalculate bale costs from current mix batch cost/kg (one-time historical fix) ──
  app.post("/api/factory/raw-stock/recalculate-bale-costs", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allBatches = await db
        .select({ id: factoryMixBatches.id, costPerKg: factoryMixBatches.costPerKg })
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.status} != 'DELETED'`));

      let balesUpdated = 0;
      const now = new Date();

      for (const batch of allBatches) {
        const batchCost = parseFloat(batch.costPerKg || "0");
        if (batchCost <= 0) continue;

        const bales = await db
          .select({ id: factoryBales.id, weightKg: factoryBales.weightKg })
          .from(factoryBales)
          .where(and(
            eq(factoryBales.mixBatchId, batch.id),
            eq(factoryBales.companyId, companyId),
            sql`${factoryBales.status} NOT IN ('DELETED','REMOVED')`
          ));

        for (const bale of bales) {
          const baleWt = parseFloat(bale.weightKg as string) || 0;
          await db.update(factoryBales)
            .set({
              costPerKg: String(batchCost.toFixed(4)),
              totalCost: String((baleWt * batchCost).toFixed(2)),
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id));
          balesUpdated++;
        }
      }

      res.json({ balesUpdated, message: `Updated cost/kg on ${balesUpdated} bale(s) across ${allBatches.length} batch(es).` });
    } catch (error: any) {
      console.error("Error recalculating bale costs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6. Factory Mix Batches
  // ───────────────────────────────────────────────

}

}
