import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import { logger } from "../../lib/logger";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import { resolveStoredFxRate, resolveStoredFxRateOrThrow, applyFxRate, UnresolvedExchangeRateError } from "../../services/factory/currencyConversion";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
  checkFactoryAdmin,
} from "./_helpers";
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
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

import { registerFactoryRawStockRoutes } from "./factoryRawStockRoutes";

export function registerFactoryContainersRoutes(app: Express) {
  app.get("/api/factory/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryContainers.id,
          companyId: factoryContainers.companyId,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          origin: factoryContainers.origin,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          currencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          fxRateToUsdImport: factoryContainers.fxRateToUsdImport,
          fxRateToUsdOffload: factoryContainers.fxRateToUsdOffload,
          fxRateSource: factoryContainers.fxRateSource,
          fxRateDateImport: factoryContainers.fxRateDateImport,
          fxRateDateOffload: factoryContainers.fxRateDateOffload,
          ratePerKgUsd: factoryContainers.ratePerKgUsd,
          finalPayableAmountUsd: factoryContainers.finalPayableAmountUsd,
          declaredKg: factoryContainers.declaredKg,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          finalPayableAmount: factoryContainers.finalPayableAmount,
          differenceKg: factoryContainers.differenceKg,
          arrivalDate: factoryContainers.arrivalDate,
          notes: factoryContainers.notes,
          status: factoryContainers.status,
          freight: factoryContainers.freight,
          freightCurrencyCode: factoryContainers.freightCurrencyCode,
          freightAccountId: factoryContainers.freightAccountId,
          otherCharges: factoryContainers.otherCharges,
          otherChargesAccountId: factoryContainers.otherChargesAccountId,
          commissionAmount: factoryContainers.commissionAmount,
          commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
          commissionAccountId: factoryContainers.commissionAccountId,
          commissionSupplierId: factoryContainers.commissionSupplierId,
          commissionNotes: factoryContainers.commissionNotes,
          createdAt: factoryContainers.createdAt,
          updatedAt: factoryContainers.updatedAt,
          supplierName: factorySuppliers.name,
          additionalChargesSum: sql<string>`COALESCE((
            SELECT SUM(
              CASE
                WHEN COALESCE(foac.currency_code, 'USD') = COALESCE(${factoryContainers.currencyCode}, 'USD')
                  THEN foac.amount::numeric
                WHEN COALESCE(foac.currency_code, 'USD') = 'USD'
                  THEN foac.amount::numeric / NULLIF(COALESCE(${factoryContainers.fxRateToUsd}, '1')::numeric, 0)
                ELSE foac.amount::numeric * COALESCE(foac.fx_rate_to_usd, '1')::numeric
                     / NULLIF(COALESCE(${factoryContainers.fxRateToUsd}, '1')::numeric, 0)
              END
            )
            FROM factory_offload_additional_charges foac
            WHERE foac.container_id = ${factoryContainers.id}
            AND foac.company_id = ${factoryContainers.companyId}
          ), 0)`,
          preRegisteredChargesSum: sql<string>`COALESCE((
            SELECT SUM(
              CASE
                WHEN COALESCE(fcoc.currency_code, 'USD') = COALESCE(${factoryContainers.currencyCode}, 'USD')
                  THEN fcoc.amount::numeric
                WHEN COALESCE(fcoc.currency_code, 'USD') = 'USD'
                  THEN fcoc.amount::numeric / NULLIF(COALESCE(${factoryContainers.fxRateToUsd}, '1')::numeric, 0)
                ELSE fcoc.amount::numeric
              END
            )
            FROM factory_container_other_charges fcoc
            WHERE fcoc.container_id = ${factoryContainers.id}
            AND fcoc.company_id = ${factoryContainers.companyId}
          ), 0)`,
          preRegisteredChargesCount: sql<number>`COALESCE((
            SELECT COUNT(*)
            FROM factory_container_other_charges fcoc
            WHERE fcoc.container_id = ${factoryContainers.id}
            AND fcoc.company_id = ${factoryContainers.companyId}
          ), 0)`,
          preRegisteredChargesByCurrency: sql<string>`COALESCE(
            (SELECT json_agg(json_build_object('currencyCode', cc, 'amount', total::text))
             FROM (
               SELECT COALESCE(currency_code, 'USD') AS cc, SUM(amount::numeric) AS total
               FROM factory_container_other_charges
               WHERE container_id = ${factoryContainers.id}
               AND company_id = ${factoryContainers.companyId}
               GROUP BY COALESCE(currency_code, 'USD')
             ) t),
            '[]'::json)`,
          destination: factoryContainers.destination,
          dutyAmount: factoryContainers.dutyAmount,
          dutyStatus: factoryContainers.dutyStatus,
          trackingEnabled: factoryContainers.trackingEnabled,
          trackingAutoUpdate: factoryContainers.trackingAutoUpdate,
          trackingCarrierHint: factoryContainers.trackingCarrierHint,
          trackingProvider: factoryContainers.trackingProvider,
          trackingLastStatus: factoryContainers.trackingLastStatus,
          trackingLastLocation: factoryContainers.trackingLastLocation,
          trackingLastCheckedAt: factoryContainers.trackingLastCheckedAt,
          trackingLastEventDate: factoryContainers.trackingLastEventDate,
          trackingLastDescription: factoryContainers.trackingLastDescription,
          trackingError: factoryContainers.trackingError,
          trackingDetectedCarrier: factoryContainers.trackingDetectedCarrier,
          trackingNextCheckAt: factoryContainers.trackingNextCheckAt,
          trackingLastSkipReason: factoryContainers.trackingLastSkipReason,
        })
        .from(factoryContainers)
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            isNull(factoryContainers.deletedAt),
            // activeOnly=true: restrict to OTW statuses (excludes PARTIALLY_RECEIVED, OFFLOADED, RECEIVED)
            req.query.activeOnly === "true"
              ? sql`${factoryContainers.status} IN ('PENDING', 'IN_TRANSIT', 'ARRIVED')`
              : undefined
          )
        )
        .orderBy(desc(factoryContainers.createdAt));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── GET single container by ID ────────────────────────────────────────────
  app.get("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const [row] = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          origin: factoryContainers.origin,
          totalKg: factoryContainers.totalKg,
          declaredKg: factoryContainers.declaredKg,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          ratePerKg: factoryContainers.ratePerKg,
          ratePerKgUsd: factoryContainers.ratePerKgUsd,
          currencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          finalPayableAmount: factoryContainers.finalPayableAmount,
          finalPayableAmountUsd: factoryContainers.finalPayableAmountUsd,
          freight: factoryContainers.freight,
          freightCurrencyCode: factoryContainers.freightCurrencyCode,
          otherCharges: factoryContainers.otherCharges,
          commissionAmount: factoryContainers.commissionAmount,
          commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
          commissionSupplierId: factoryContainers.commissionSupplierId,
          arrivalDate: factoryContainers.arrivalDate,
          status: factoryContainers.status,
          notes: factoryContainers.notes,
          supplierName: factorySuppliers.name,
        })
        .from(factoryContainers)
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)));
      if (!row) return res.status(404).json({ message: "Container not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers", requireAuth, async (req: any, res: any) => {
    const _t = Date.now();
    const _uid = (req.session as any).userId;
    const _cid = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
    try {
      logger.info("factory container create started", { module: "factoryContainers", action: "create", userId: _uid, companyId: _cid });
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryContainerSchema.parse({ ...req.body, companyId });
      const currencyCode = parsed.currencyCode || "USD";
      const fxRateSource = parsed.fxRateSource || "auto";
      const today = getClientDate(req);
      const importDate = parsed.arrivalDate || today;

      let fxRate: string;
      if (fxRateSource === "manual" && parsed.fxRateToUsd) {
        fxRate = parsed.fxRateToUsd;
      } else {
        fxRate = await getOrFetchFxRateToUsd(companyId, currencyCode, importDate);
      }

      const ratePerKg = parseFloat(parsed.ratePerKg || "0");
      const fxRateNum = parseFloat(fxRate);
      const ratePerKgUsd = currencyCode === "USD" ? ratePerKg : ratePerKg * fxRateNum;

      const values: any = {
        ...parsed,
        currencyCode,
        fxRateToUsd: fxRate,
        fxRateToUsdImport: fxRate,
        fxRateSource: fxRateSource === "manual" ? "manual" : "auto",
        fxRateDateImport: importDate,
        ratePerKgUsd: String(ratePerKgUsd),
        // Explicitly resolved above (manual user entry or a real auto-fetch) — trust it.
        fxRateConfirmed: true,
      };

      // Auto-set commissionSupplierId to broker (parentId) if supplier has one and not already set
      if (parsed.supplierId && !parsed.commissionSupplierId) {
        const [sup] = await db
          .select({ parentId: factorySuppliers.parentId })
          .from(factorySuppliers)
          .where(eq(factorySuppliers.id, parsed.supplierId));
        if (sup?.parentId) values.commissionSupplierId = sup.parentId;
      }

      // Auto-create commission ledger account for the broker if commission amount > 0
      const commissionAmt = parseFloat(values.commissionAmount || "0");
      if (!values.commissionAccountId && values.commissionSupplierId) {
        const [broker] = await db
          .select({ id: factorySuppliers.id, name: factorySuppliers.name })
          .from(factorySuppliers)
          .where(eq(factorySuppliers.id, values.commissionSupplierId));
        if (broker) {
          const safeCode = `COMM_SUP_${broker.id}`;
          values.commissionAccountId = await getOrCreateLedgerAccount(
            companyId,
            safeCode,
            `Commission Payable - ${broker.name}`,
            "LIABILITY"
          );
        }
      }

      // Auto-create freight ledger account if freight > 0 and no account selected
      if (!values.freightAccountId && parseFloat(values.freight || "0") > 0) {
        values.freightAccountId = await getOrCreateLedgerAccount(companyId, "FREIGHT", "Freight");
      }

      // Persist which supplier freight is payable to when freightPaidBy='supplier' (default).
      // Without this, factoryContainers.freightSupplierId stays null even though the freight
      // voucher below correctly credits container.supplierId — later steps (offload prefill,
      // PATCH freight-sync) read freightSupplierId, not supplierId, to know freight has a
      // supplier payee. Leaving it null makes them fall back to a no-supplier posting branch
      // and silently re-book freight against the wrong ledger.
      const freightPaidByOnCreate = values.freightPaidBy || "supplier";
      if (freightPaidByOnCreate === "supplier" && !values.freightSupplierId && values.supplierId) {
        values.freightSupplierId = values.supplierId;
      }

      const [container] = await db.insert(factoryContainers).values(values).returning();

      let supplierNameForDesc = "";
      if (container.supplierId) {
        const [sup] = await db
          .select({ name: factorySuppliers.name })
          .from(factorySuppliers)
          .where(eq(factorySuppliers.id, container.supplierId));
        supplierNameForDesc = sup?.name || "";
      }
      const kgForDesc = parseFloat(container.totalKg || "0");
      const rateForDesc = parseFloat(container.ratePerKg || "0");
      const ccyForDesc = container.currencyCode || "USD";
      const descParts = [
        container.containerNumber,
        supplierNameForDesc,
        kgForDesc > 0 ? `${kgForDesc.toLocaleString()} kg` : null,
        rateForDesc > 0 ? `${rateForDesc} ${ccyForDesc}/kg` : null,
      ].filter(Boolean);

      await writeDaybookEntry(db, {
        companyId,
        txDate: container.arrivalDate || today,
        txType: "CONTAINER_IMPORT",
        referenceId: container.id,
        description: descParts.join(" · "),
        currencyCode: ccyForDesc,
        amountCurrency: parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0"),
        fxRateToUsd: resolveStoredFxRateOrThrow(ccyForDesc, container.fxRateToUsd, (container as any).fxRateConfirmed),
      });

      // Double-entry: Goods value — Dr Factory Import Cost / Cr Supplier Payable
      const goodsValue = parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0");
      if (goodsValue > 0 && container.supplierId) {
        const importCostAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_IMPORT_COST", "Factory Import Cost");
        const importVoucherNum = `FACTORY-IMPORT-${container.id}-${Date.now()}`;
        const [importVoucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherType: "Journal",
            voucherNumber: importVoucherNum,
            voucherDate: container.arrivalDate || today,
            description: `Goods import - container ${container.containerNumber}`,
            totalAmount: String(goodsValue),
            currency: container.currencyCode || "USD",
            exchangeRate: String(
              resolveStoredFxRateOrThrow(container.currencyCode, container.fxRateToUsd, (container as any).fxRateConfirmed)
            ),
            sourceModule: "FACTORY",
          })
          .returning();
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          ledgerAccountId: importCostAccId,
          debitAmount: String(goodsValue),
          creditAmount: "0",
          narration: `Goods import cost - container ${container.containerNumber}`,
        });
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          factorySupplierId: container.supplierId,
          debitAmount: "0",
          creditAmount: String(goodsValue),
          narration: `Goods payable to supplier - container ${container.containerNumber}`,
        });
      }

      // Commission is already included in the factory supplier balance calculation
      // (via container.commissionAmount in the supplier liability formula).
      // Posting a separate journal voucher would double-count it, so we skip it here.

      // Double-entry: Freight
      // If freightPaidBy='own': Dr Freight Expense / Cr own ledger account
      // If freightPaidBy='supplier' (default): Dr Freight Expense / Cr Supplier Payable
      const freightAmt = parseFloat(container.freight || "0");
      const freightCcy = (container as any).freightCurrencyCode || container.currencyCode || "USD";
      const freightPaidBy = (container as any).freightPaidBy || "supplier";
      const freightOwnAcctId = (container as any).freightOwnAccountId ?? null;
      if (freightAmt > 0 && container.freightAccountId) {
        const freightVoucherNum = `FACTORY-FREIGHT-${container.id}`;
        const [freightVoucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherType: freightPaidBy === "own" ? "Payment" : "Journal",
            voucherNumber: freightVoucherNum,
            voucherDate: container.arrivalDate || today,
            description: `Freight on container ${container.containerNumber}`,
            totalAmount: String(freightAmt),
            currency: freightCcy,
            exchangeRate:
              freightCcy === (container.currencyCode || "USD")
                ? String(resolveStoredFxRateOrThrow(container.currencyCode, container.fxRateToUsd, (container as any).fxRateConfirmed))
                : "1",
            sourceModule: "FACTORY",
          })
          .returning();
        // Dr Freight Expense
        await db.insert(voucherEntries).values({
          voucherId: freightVoucher.id,
          ledgerAccountId: container.freightAccountId,
          debitAmount: String(freightAmt),
          creditAmount: "0",
          narration: `Freight expense - container ${container.containerNumber}`,
        });
        if (freightPaidBy === "own" && freightOwnAcctId) {
          // Cr Own account (paid by company itself)
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            ledgerAccountId: freightOwnAcctId,
            debitAmount: "0",
            creditAmount: String(freightAmt),
            narration: `Freight paid via own account - container ${container.containerNumber}`,
          });
        } else if (freightPaidBy === "supplier" && container.supplierId) {
          // Cr Supplier Payable
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            factorySupplierId: container.supplierId,
            debitAmount: "0",
            creditAmount: String(freightAmt),
            narration: `Freight payable to supplier - container ${container.containerNumber}`,
          });
        }
      }

      logger.info("factory container create succeeded", { module: "factoryContainers", action: "create", userId: _uid, companyId: _cid, containerId: container.id, durationMs: Date.now() - _t });
      res.json(container);
    } catch (error: any) {
      logger.error("factory container create failed", { module: "factoryContainers", action: "create", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      console.error("Error creating factory container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    const _t = Date.now();
    const _uid = (req.session as any).userId;
    const _cid = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
    try {
      logger.info("factory container update started", { module: "factoryContainers", action: "update", userId: _uid, companyId: _cid });
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const b = req.body;

      // Helper: coerce empty-string / undefined to null for numeric/integer columns
      const dec = (v: any) => (v === "" || v === undefined || v === null ? null : String(v));
      const int = (v: any) => {
        if (v === "" || v === undefined || v === null) return null;
        const n = parseInt(v);
        return isNaN(n) ? null : n;
      };
      const str = (v: any) => (v === "" || v === undefined ? null : String(v));

      // Build a strict whitelist — only valid factoryContainers columns
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (b.containerNumber !== undefined) updateData.containerNumber = String(b.containerNumber || "");
      if (b.supplierId !== undefined) updateData.supplierId = int(b.supplierId);
      if (b.origin !== undefined) updateData.origin = str(b.origin);
      if (b.totalKg !== undefined) updateData.totalKg = dec(b.totalKg);
      if (b.ratePerKg !== undefined) updateData.ratePerKg = dec(b.ratePerKg);
      if (b.arrivalDate !== undefined) updateData.arrivalDate = str(b.arrivalDate);
      if (b.destination !== undefined) updateData.destination = str(b.destination);
      if (b.notes !== undefined) updateData.notes = str(b.notes);
      if (b.status !== undefined) updateData.status = String(b.status || "PENDING");
      if (b.currencyCode !== undefined) updateData.currencyCode = String(b.currencyCode || "USD");
      if (b.fxRateSource !== undefined) updateData.fxRateSource = String(b.fxRateSource || "auto");
      if (b.fxRateToUsd !== undefined) updateData.fxRateToUsd = dec(b.fxRateToUsd);
      // Freight
      if (b.freight !== undefined) updateData.freight = dec(b.freight) ?? "0";
      if (b.freightCurrencyCode !== undefined) updateData.freightCurrencyCode = str(b.freightCurrencyCode);
      if (b.freightAccountId !== undefined) updateData.freightAccountId = int(b.freightAccountId);
      if (b.freightSupplierId !== undefined) updateData.freightSupplierId = int(b.freightSupplierId);
      if (b.freightPaidBy !== undefined) updateData.freightPaidBy = String(b.freightPaidBy || "supplier");
      if (b.freightOwnAccountId !== undefined)
        updateData.freightOwnAccountId = b.freightOwnAccountId === null ? null : int(b.freightOwnAccountId);
      // Other charges
      if (b.otherCharges !== undefined) updateData.otherCharges = dec(b.otherCharges) ?? "0";
      if (b.otherChargesCurrencyCode !== undefined)
        updateData.otherChargesCurrencyCode = str(b.otherChargesCurrencyCode);
      if (b.otherChargesAccountId !== undefined) updateData.otherChargesAccountId = int(b.otherChargesAccountId);
      if (b.otherChargesSupplierId !== undefined) updateData.otherChargesSupplierId = int(b.otherChargesSupplierId);
      // Commission
      if (b.commissionAmount !== undefined) updateData.commissionAmount = dec(b.commissionAmount) ?? "0";
      if (b.commissionCurrencyCode !== undefined) updateData.commissionCurrencyCode = str(b.commissionCurrencyCode);
      if (b.commissionAccountId !== undefined) updateData.commissionAccountId = int(b.commissionAccountId);
      if (b.commissionSupplierId !== undefined) updateData.commissionSupplierId = int(b.commissionSupplierId);
      if (b.commissionNotes !== undefined) updateData.commissionNotes = str(b.commissionNotes);
      // Duty
      if (b.dutyAmount !== undefined) updateData.dutyAmount = dec(b.dutyAmount);
      if (b.dutyAccountId !== undefined) updateData.dutyAccountId = int(b.dutyAccountId);
      if (b.dutyStatus !== undefined) updateData.dutyStatus = String(b.dutyStatus || "NONE");
      if (b.dutyNotes !== undefined) updateData.dutyNotes = str(b.dutyNotes);

      // FX rate computation (same logic as before)
      const needsFxCalc = updateData.currencyCode || updateData.ratePerKg || updateData.fxRateSource;
      if (needsFxCalc) {
        const [existing] = await db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)));
        if (!existing) return res.status(404).json({ message: "Container not found" });

        const currencyCode = updateData.currencyCode || existing.currencyCode || "USD";
        const fxRateSource = updateData.fxRateSource || existing.fxRateSource || "auto";
        const importDate = updateData.arrivalDate || existing.arrivalDate || getClientDate(req);

        if (fxRateSource === "auto") {
          const fxRate = await getOrFetchFxRateToUsd(companyId, currencyCode, importDate);
          updateData.fxRateToUsd = fxRate;
          updateData.fxRateToUsdImport = fxRate;
          updateData.fxRateDateImport = importDate;
          updateData.fxRateSource = "auto";
          updateData.fxRateConfirmed = true; // real auto-fetch, not a guess
          const ratePerKg = parseFloat(updateData.ratePerKg || existing.ratePerKg || "0");
          const fxRateNum = parseFloat(fxRate);
          updateData.ratePerKgUsd = String(applyFxRate(ratePerKg, currencyCode, fxRateNum));
        } else {
          // Manual: trust an fxRateToUsd explicitly provided in THIS request regardless of
          // value; otherwise fall back to the existing stored rate, but only if it's actually
          // confirmed already (or, absent the flag on this row, looks like a real explicit
          // rate under the legacy heuristic).
          const explicitRate = b.fxRateToUsd !== undefined ? parseFloat(dec(b.fxRateToUsd) ?? "") : NaN;
          let fxRateNum: number;
          if (!isNaN(explicitRate) && explicitRate > 0) {
            fxRateNum = explicitRate;
            updateData.fxRateConfirmed = true; // freshly supplied by this request
          } else {
            const { fxRate, looksSet } = resolveStoredFxRate(
              currencyCode,
              existing.fxRateToUsd,
              (existing as any).fxRateConfirmed
            );
            if (!looksSet) {
              return res.status(400).json({ message: new UnresolvedExchangeRateError(currencyCode).message });
            }
            fxRateNum = fxRate;
            // Carries forward an already-confirmed rate; leave fxRateConfirmed untouched.
          }
          const ratePerKg = parseFloat(updateData.ratePerKg || existing.ratePerKg || "0");
          updateData.fxRateToUsd = String(fxRateNum);
          updateData.fxRateToUsdImport = String(fxRateNum);
          updateData.fxRateDateImport = importDate;
          updateData.fxRateSource = "manual";
          updateData.ratePerKgUsd = String(applyFxRate(ratePerKg, currencyCode, fxRateNum));
        }
      }

      // Auto-create freight ledger account if freight > 0 and no account selected
      if (!updateData.freightAccountId && parseFloat(updateData.freight || "0") > 0) {
        updateData.freightAccountId = await getOrCreateLedgerAccount(companyId, "FREIGHT", "Freight");
      }

      const [updated] = await db
        .update(factoryContainers)
        .set(updateData)
        .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Container not found" });

      // ── Sync freight voucher ───────────────────────────────────────────────
      // Find any existing freight voucher for this container (stable or timestamped number)
      const [existingFV] = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            or(
              eq(vouchers.voucherNumber, `FACTORY-FREIGHT-${id}`),
              ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${id}-%`)
            )
          )
        )
        .limit(1);

      const newFreightAmt = parseFloat(updated.freight || "0");
      const newFreightAcctId = updated.freightAccountId ?? null;
      const newFreightPaidBy = (updated as any).freightPaidBy || "supplier";
      const newFreightOwnAcctId = (updated as any).freightOwnAccountId ?? null;
      const freightCcy = (updated as any).freightCurrencyCode || updated.currencyCode || "USD";

      if (newFreightAmt > 0 && newFreightAcctId) {
        if (existingFV) {
          // Update existing voucher amount
          await db
            .update(vouchers)
            .set({
              totalAmount: String(newFreightAmt),
              voucherType: newFreightPaidBy === "own" ? "Payment" : "Journal",
            })
            .where(eq(vouchers.id, existingFV.id));
          // Update entries
          const fEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, existingFV.id));
          for (const fe of fEntries) {
            if (parseFloat(fe.debitAmount || "0") > 0) {
              // Dr Freight Expense — update amount and account
              await db
                .update(voucherEntries)
                .set({ debitAmount: String(newFreightAmt), ledgerAccountId: newFreightAcctId })
                .where(eq(voucherEntries.id, fe.id));
            } else if (newFreightPaidBy === "own" && newFreightOwnAcctId) {
              // Cr Own account
              await db
                .update(voucherEntries)
                .set({
                  creditAmount: String(newFreightAmt),
                  ledgerAccountId: newFreightOwnAcctId,
                  factorySupplierId: null,
                })
                .where(eq(voucherEntries.id, fe.id));
            } else if (newFreightPaidBy === "supplier" && updated.supplierId) {
              // Cr Supplier
              await db
                .update(voucherEntries)
                .set({
                  creditAmount: String(newFreightAmt),
                  factorySupplierId: updated.supplierId,
                  ledgerAccountId: null,
                })
                .where(eq(voucherEntries.id, fe.id));
            }
          }
        } else {
          // Create new freight voucher — use arrivalDate if set, else fall back to the
          // container's own createdAt (NOT today) so an edit made months later doesn't
          // stamp a brand-new voucher with the current date.
          const today = getClientDate(req);
          const containerCreatedDate = updated.createdAt
            ? new Date(updated.createdAt).toISOString().slice(0, 10)
            : today;
          const [newFV] = await db
            .insert(vouchers)
            .values({
              companyId,
              voucherType: newFreightPaidBy === "own" ? "Payment" : "Journal",
              voucherNumber: `FACTORY-FREIGHT-${id}`,
              voucherDate: updated.arrivalDate || containerCreatedDate,
              description: `Freight on container ${updated.containerNumber}`,
              totalAmount: String(newFreightAmt),
              currency: freightCcy,
              sourceModule: "FACTORY",
            })
            .returning();
          await db.insert(voucherEntries).values({
            voucherId: newFV.id,
            ledgerAccountId: newFreightAcctId,
            debitAmount: String(newFreightAmt),
            creditAmount: "0",
            narration: `Freight expense - container ${updated.containerNumber}`,
          });
          if (newFreightPaidBy === "own" && newFreightOwnAcctId) {
            await db.insert(voucherEntries).values({
              voucherId: newFV.id,
              ledgerAccountId: newFreightOwnAcctId,
              debitAmount: "0",
              creditAmount: String(newFreightAmt),
              narration: `Freight paid via own account - container ${updated.containerNumber}`,
            });
          } else if (updated.supplierId) {
            await db.insert(voucherEntries).values({
              voucherId: newFV.id,
              factorySupplierId: updated.supplierId,
              debitAmount: "0",
              creditAmount: String(newFreightAmt),
              narration: `Freight payable to supplier - container ${updated.containerNumber}`,
            });
          }
        }
      } else if (existingFV) {
        // Freight removed — delete voucher
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, existingFV.id));
        await db.delete(vouchers).where(eq(vouchers.id, existingFV.id));
      }

      logger.info("factory container update succeeded", { module: "factoryContainers", action: "update", userId: _uid, companyId: _cid, containerId: id, durationMs: Date.now() - _t });
      res.json(updated);
    } catch (error: any) {
      logger.error("factory container update failed", { module: "factoryContainers", action: "update", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      const pgErr = error?.cause ?? error;
      const pgMsg = pgErr?.message ?? error?.message ?? "Unknown error";
      const pgCode = pgErr?.code;
      const pgConstraint = pgErr?.constraint;
      console.error("[factory-container PATCH] DB error:", { pgCode, pgConstraint, pgMsg, full: error?.message });
      const userMsg = pgCode
        ? `${pgMsg}${pgConstraint ? ` (constraint: ${pgConstraint})` : ""}`
        : pgMsg.split("\n\n").pop() || pgMsg;
      res.status(400).json({ message: userMsg });
    }
  });

  // ── Bulk cascade-delete containers ───────────────────────────────────────────
  app.post("/api/factory/containers/bulk-delete", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { ids } = req.body as { ids: number[] };
      if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ message: "No container IDs provided" });

      // Verify all containers belong to this company
      const owned = await db
        .select({ id: factoryContainers.id })
        .from(factoryContainers)
        .where(
          and(
            inArray(factoryContainers.id, ids),
            eq(factoryContainers.companyId, companyId),
            isNull(factoryContainers.deletedAt)
          )
        );
      const ownedIds = owned.map((c: any) => c.id);
      if (ownedIds.length === 0) return res.status(404).json({ message: "No containers found" });

      // Soft-delete: hide containers from main listings while preserving all child rows
      // (raw stock, vouchers, daybook, etc.) so they can be restored from Settings → Deleted Items.
      // Permanent deletion (with the original cascade) is performed from the admin trash UI.
      await db
        .update(factoryContainers)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(factoryContainers.id, ownedIds), eq(factoryContainers.companyId, companyId)));

      res.json({ deleted: ownedIds.length, ids: ownedIds });
      return;

      await db.transaction(async (tx: any) => {
        // 1. Gather commission record IDs and raw stock IDs before deleting (needed for daybook cleanup)
        const commRows = await tx
          .select({ id: factoryContainerCommissions.id })
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              inArray(factoryContainerCommissions.containerId, ownedIds)
            )
          );
        const commIds = commRows.map((r: any) => r.id);

        const rsRows = await tx
          .select({ id: factoryRawStock.id })
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), inArray(factoryRawStock.containerId, ownedIds)));
        const rsIds = rsRows.map((r: any) => r.id);

        // 2. Delete daybook entries linked to these containers
        //    a. OFFLOAD_RAW_STOCK / COMMISSION linked by referenceId = raw stock or commission ids
        if (rsIds.length > 0) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
                inArray(factoryDaybookEntries.referenceId, rsIds)
              )
            );
        }
        if (commIds.length > 0) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "COMMISSION"),
                inArray(factoryDaybookEntries.referenceId, commIds)
              )
            );
        }
        //    b. FREIGHT / OTHER_CHARGE / DUTY / CONTAINER_IMPORT / PURCHASE linked by referenceId = containerId
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              inArray(factoryDaybookEntries.txType, [
                "FREIGHT",
                "OTHER_CHARGE",
                "DUTY",
                "CONTAINER_IMPORT",
                "PURCHASE",
              ]),
              inArray(factoryDaybookEntries.referenceId, ownedIds)
            )
          );

        // 3. Delete accounting vouchers for these containers
        //    Patterns: FACTORY-IMPORT-{id}-*, FACTORY-COMM-{id}-*, FACTORY-FREIGHT-{id}-*, FACTORY-OC-{id}-*
        for (const cid of ownedIds) {
          const containerVouchers = await tx
            .select({ id: vouchers.id })
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, companyId),
                eq(vouchers.sourceModule, "FACTORY"),
                or(
                  ilike(vouchers.voucherNumber, `FACTORY-IMPORT-${cid}-%`),
                  ilike(vouchers.voucherNumber, `FACTORY-COMM-${cid}-%`),
                  ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${cid}-%`),
                  ilike(vouchers.voucherNumber, `FACTORY-OC-${cid}-%`)
                )
              )
            );
          if (containerVouchers.length > 0) {
            const vIds = containerVouchers.map((v: any) => v.id);
            await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
            await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
          }
        }

        // 4. Delete FX allocations and transfer records referencing these containers
        await tx
          .delete(factoryFxAllocations)
          .where(
            and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, ownedIds))
          );

        // 5. Delete mix batch sources
        await tx.delete(factoryMixBatchSources).where(inArray(factoryMixBatchSources.containerId, ownedIds));

        // 6. Delete offload additional charges
        await tx
          .delete(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.companyId, companyId),
              inArray(factoryOffloadAdditionalCharges.containerId, ownedIds)
            )
          );

        // 7. Delete pre-registered other charges (container-level charges, not offload)
        await tx
          .delete(factoryContainerOtherCharges)
          .where(
            and(
              eq(factoryContainerOtherCharges.companyId, companyId),
              inArray(factoryContainerOtherCharges.containerId, ownedIds)
            )
          );

        // 8. Delete commission records
        await tx
          .delete(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              inArray(factoryContainerCommissions.containerId, ownedIds)
            )
          );

        // 9. Delete raw stock records
        await tx
          .delete(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), inArray(factoryRawStock.containerId, ownedIds)));

        // 10. Finally delete the containers themselves
        await tx
          .delete(factoryContainers)
          .where(and(inArray(factoryContainers.id, ownedIds), eq(factoryContainers.companyId, companyId)));
      });

      res.json({ deleted: ownedIds.length, ids: ownedIds });
    } catch (error: any) {
      console.error("Error bulk-deleting factory containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      let updatedId: number | null = null;
      await db.transaction(async (tx: any) => {
        // Soft-delete the container
        const [updated] = await tx
          .update(factoryContainers)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(factoryContainers.id, id),
              eq(factoryContainers.companyId, companyId),
              isNull(factoryContainers.deletedAt)
            )
          )
          .returning({ id: factoryContainers.id });
        if (!updated) return;
        updatedId = updated.id;

        // 1. Collect child IDs for daybook cleanup
        const rsRows = await tx
          .select({ id: factoryRawStock.id })
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, id)));
        const rsIds = rsRows.map((r: any) => r.id);

        const commRows = await tx
          .select({ id: factoryContainerCommissions.id })
          .from(factoryContainerCommissions)
          .where(
            and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, id))
          );
        const commIds = commRows.map((r: any) => r.id);

        // 2. Delete daybook entries linked to this container
        if (rsIds.length > 0) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
                inArray(factoryDaybookEntries.referenceId, rsIds)
              )
            );
        }
        if (commIds.length > 0) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "COMMISSION"),
                inArray(factoryDaybookEntries.referenceId, commIds)
              )
            );
        }
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              inArray(factoryDaybookEntries.txType, [
                "FREIGHT",
                "OTHER_CHARGE",
                "DUTY",
                "CONTAINER_IMPORT",
                "PURCHASE",
              ]),
              eq(factoryDaybookEntries.referenceId, id)
            )
          );

        // 3. Delete accounting vouchers and their entries
        const containerVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              or(
                ilike(vouchers.voucherNumber, `FACTORY-IMPORT-${id}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-COMM-${id}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${id}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-OC-${id}-%`)
              )
            )
          );
        if (containerVouchers.length > 0) {
          const vIds = containerVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }
      });

      if (!updatedId) return res.status(404).json({ message: "Container not found" });
      res.json({ id: updatedId, message: "Container deleted" });
    } catch (error: any) {
      console.error("Error deleting factory container:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Backfill: create missing goods-import credits for existing containers ────
  app.post("/api/factory/containers/backfill-import-credits", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allContainers = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId)));

      let created = 0;
      let skipped = 0;
      const fxUnresolvedSkipped: string[] = [];

      for (const container of allContainers) {
        if (!container.supplierId) {
          skipped++;
          continue;
        }
        const goodsValue = parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0");
        if (goodsValue <= 0) {
          skipped++;
          continue;
        }

        // Skip if an import voucher already exists for this container
        const existing = await db
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              ilike(vouchers.voucherNumber, `FACTORY-IMPORT-${container.id}-%`)
            )
          )
          .limit(1);
        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // Unresolved non-USD rate: skip this one container (report it) rather than
        // aborting the whole bulk backfill or silently posting a mispriced voucher.
        let backfillFxRate: number;
        try {
          backfillFxRate = resolveStoredFxRateOrThrow(
            container.currencyCode,
            container.fxRateToUsd,
            (container as any).fxRateConfirmed
          );
        } catch {
          skipped++;
          fxUnresolvedSkipped.push(container.containerNumber);
          continue;
        }

        const today = getClientDate(req);
        const importCostAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_IMPORT_COST", "Factory Import Cost");
        const importVoucherNum = `FACTORY-IMPORT-${container.id}-${Date.now()}`;
        const [importVoucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherType: "Journal",
            voucherNumber: importVoucherNum,
            voucherDate: container.arrivalDate || today,
            description: `Goods import - container ${container.containerNumber}`,
            totalAmount: String(goodsValue),
            currency: container.currencyCode || "USD",
            exchangeRate: String(backfillFxRate),
            sourceModule: "FACTORY",
          })
          .returning();
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          ledgerAccountId: importCostAccId,
          debitAmount: String(goodsValue),
          creditAmount: "0",
          narration: `Goods import cost - container ${container.containerNumber}`,
        });
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          factorySupplierId: container.supplierId,
          debitAmount: "0",
          creditAmount: String(goodsValue),
          narration: `Goods payable to supplier - container ${container.containerNumber}`,
        });
        created++;
      }

      res.json({ created, skipped, total: allContainers.length, fxUnresolvedSkipped });
    } catch (error: any) {
      console.error("Error backfilling import credits:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/containers/:id/other-charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const charges = await db
        .select()
        .from(factoryContainerOtherCharges)
        .where(
          and(
            eq(factoryContainerOtherCharges.containerId, containerId),
            eq(factoryContainerOtherCharges.companyId, companyId)
          )
        )
        .orderBy(factoryContainerOtherCharges.createdAt);
      res.json(charges);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:id/other-charges/sync", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const { charges, isCreate } = req.body as {
        charges: { description: string; amount: string; currencyCode?: string; ledgerAccountId?: number | null }[];
        isCreate?: boolean;
      };

      // Void any previously created other-charge vouchers for this container (to avoid duplicates on edit)
      const ocPrefix = `FACTORY-OC-${containerId}-%`;
      const existingVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY"),
            ilike(vouchers.voucherNumber, ocPrefix)
          )
        );
      if (existingVouchers.length > 0) {
        const vIds = existingVouchers.map((v) => v.id);
        await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
        await db.delete(vouchers).where(inArray(vouchers.id, vIds));
      }

      await db
        .delete(factoryContainerOtherCharges)
        .where(
          and(
            eq(factoryContainerOtherCharges.containerId, containerId),
            eq(factoryContainerOtherCharges.companyId, companyId)
          )
        );

      let newCharges: any[] = [];
      if (charges && charges.length > 0) {
        const resolvedCharges = await Promise.all(
          charges.map(async (c) => {
            let ledgerAccountId = c.ledgerAccountId || null;
            if (!ledgerAccountId && c.description?.trim()) {
              const code = ("OC_" + c.description.toUpperCase().replace(/[^A-Z0-9]/g, "_")).slice(0, 50);
              ledgerAccountId = await getOrCreateLedgerAccount(companyId, code, c.description);
            }
            return {
              companyId,
              containerId,
              description: c.description,
              amount: c.amount,
              currencyCode: c.currencyCode || "USD",
              ledgerAccountId,
            };
          })
        );
        newCharges = await db.insert(factoryContainerOtherCharges).values(resolvedCharges).returning();
      }

      const total = charges?.reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0) ?? 0;
      await db
        .update(factoryContainers)
        .set({ otherCharges: total.toFixed(2) })
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      // Double-entry for each other charge: Dr Factory Charges Payable / Cr chosen account
      if (newCharges.length > 0) {
        const [container] = await db
          .select({
            supplierId: factoryContainers.supplierId,
            containerNumber: factoryContainers.containerNumber,
            currencyCode: factoryContainers.currencyCode,
            fxRateToUsd: factoryContainers.fxRateToUsd,
            fxRateConfirmed: (factoryContainers as any).fxRateConfirmed,
            arrivalDate: factoryContainers.arrivalDate,
            createdAt: factoryContainers.createdAt,
          })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

        if (container) {
          const today = getClientDate(req);
          const containerCreatedDate = container.createdAt
            ? new Date(container.createdAt).toISOString().slice(0, 10)
            : today;
          const voucherDate = container.arrivalDate || containerCreatedDate;
          for (const charge of newCharges) {
            const chargeAmt = parseFloat(charge.amount || "0");
            if (chargeAmt <= 0 || !charge.ledgerAccountId) continue;
            // Use the charge's own currency, not the container's currency
            const chargeCcy = charge.currencyCode || container.currencyCode || "USD";
            let chargeFxRate: string;
            if (chargeCcy === "USD") {
              chargeFxRate = "1";
            } else if (chargeCcy === (container.currencyCode || "USD")) {
              const { fxRate, looksSet } = resolveStoredFxRate(
                chargeCcy,
                container.fxRateToUsd,
                (container as any).fxRateConfirmed
              );
              if (!looksSet) {
                return res
                  .status(400)
                  .json({ message: new UnresolvedExchangeRateError(chargeCcy).message });
              }
              chargeFxRate = String(fxRate);
            } else {
              chargeFxRate = await getOrFetchFxRateToUsd(companyId, chargeCcy, voucherDate);
            }
            const ocVoucherNum = `FACTORY-OC-${containerId}-${charge.id}-${Date.now()}`;
            const [ocVoucher] = await db
              .insert(vouchers)
              .values({
                companyId,
                voucherType: "Journal",
                voucherNumber: ocVoucherNum,
                voucherDate,
                description: `${charge.description} - container ${container.containerNumber}`,
                totalAmount: String(chargeAmt),
                currency: chargeCcy,
                exchangeRate: chargeFxRate,
                sourceModule: "FACTORY",
              })
              .returning();
            // Dr Factory Charges Payable
            const payableAccId = await getOrCreateLedgerAccount(
              companyId,
              "FACTORY_CHARGES_PAYABLE",
              "Factory Charges Payable"
            );
            await db.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: payableAccId,
              debitAmount: String(chargeAmt),
              creditAmount: "0",
              narration: `${charge.description} payable - container ${container.containerNumber}`,
            });
            // Cr chosen account (credit = I owe this person)
            await db.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: charge.ledgerAccountId,
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `${charge.description} - container ${container.containerNumber}`,
            });
          }
        }
      }

      res.json({ charges: newCharges, total: total.toFixed(2) });
    } catch (error: any) {
      console.error("Error syncing container other charges:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 4b-admin. Fix Other Charges Currency (Admin)
  // ───────────────────────────────────────────────

  // Preview: list containers that have other charges NOT in USD
  app.get("/api/factory/admin/other-charges-currency-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Find containers where:
      // 1. other_charges > 0 with a supplier attributed
      // 2. No override yet (other_charges_currency_code IS NULL)
      // 3. Container itself is non-USD (so charges are being displayed in wrong currency)
      // This covers the case where offload set other_charges using the container's EUR currency
      const nonUsdContainerCharges = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          otherCharges: factoryContainers.otherCharges,
          currencyCode: factoryContainers.currencyCode,
          otherChargesSupplierId: factoryContainers.otherChargesSupplierId,
        })
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            sql`${factoryContainers.otherCharges}::numeric > 0`,
            sql`${factoryContainers.otherChargesSupplierId} IS NOT NULL`,
            sql`(other_charges_currency_code IS NULL OR other_charges_currency_code != 'USD')`,
            ne(factoryContainers.currencyCode, "USD")
          )
        )
        .orderBy(factoryContainers.containerNumber);

      // Also find multi-row charges in factoryContainerOtherCharges table with non-USD currency
      const nonUsdTableCharges = await db
        .select({
          id: factoryContainerOtherCharges.id,
          containerId: factoryContainerOtherCharges.containerId,
          description: factoryContainerOtherCharges.description,
          amount: factoryContainerOtherCharges.amount,
          currencyCode: factoryContainerOtherCharges.currencyCode,
          containerNumber: factoryContainers.containerNumber,
        })
        .from(factoryContainerOtherCharges)
        .leftJoin(factoryContainers, eq(factoryContainers.id, factoryContainerOtherCharges.containerId))
        .where(
          and(
            eq(factoryContainerOtherCharges.companyId, companyId),
            ne(factoryContainerOtherCharges.currencyCode, "USD")
          )
        );

      const grouped = new Map<
        number,
        { containerId: number; containerNumber: string; currentCurrency: string; amount: string; charges: any[] }
      >();

      for (const row of nonUsdContainerCharges as any[]) {
        grouped.set(row.id, {
          containerId: row.id,
          containerNumber: row.containerNumber,
          currentCurrency: row.currencyCode,
          amount: row.otherCharges,
          charges: [
            { description: "Container Other Charges", amount: row.otherCharges, currencyCode: row.currencyCode },
          ],
        });
      }
      for (const row of nonUsdTableCharges as any[]) {
        if (!grouped.has(row.containerId)) {
          grouped.set(row.containerId, {
            containerId: row.containerId,
            containerNumber: row.containerNumber || String(row.containerId),
            currentCurrency: row.currencyCode,
            amount: "0",
            charges: [],
          });
        }
        grouped.get(row.containerId)!.charges.push({
          id: row.id,
          description: row.description,
          amount: row.amount,
          currencyCode: row.currencyCode,
        });
      }

      res.json({ containers: Array.from(grouped.values()) });
    } catch (error: any) {
      console.error("Error previewing other charges currency:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Apply: fix other charges to USD — updates container otherChargesCurrencyCode and daybook entries
  app.post("/api/factory/admin/fix-other-charges-currency", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { containerIds } = req.body as { containerIds: number[] };
      if (!Array.isArray(containerIds) || containerIds.length === 0) {
        return res.status(400).json({ message: "No container IDs provided" });
      }

      let fixed = 0;

      for (const containerId of containerIds) {
        // 1. Set other_charges_currency_code = "USD" on the container
        await db.execute(
          sql`UPDATE factory_containers SET other_charges_currency_code = 'USD' WHERE id = ${containerId} AND company_id = ${companyId}`
        );

        // 2. Fix the factory daybook OTHER_CHARGE entry for this container
        //    (change currency from EUR/other to USD, set amount_usd = amount_currency, fx_rate = 1)
        await db
          .update(factoryDaybookEntries)
          .set({
            currencyCode: "USD",
            fxRateToUsd: "1",
            amountUsd: sql`${factoryDaybookEntries.amountCurrency}`,
          })
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "OTHER_CHARGE"),
              eq(factoryDaybookEntries.referenceId, containerId),
              ne(factoryDaybookEntries.currencyCode, "USD")
            )
          );

        // 3. Also fix multi-row charges in factoryContainerOtherCharges if any exist
        const tableCharges = await db
          .select()
          .from(factoryContainerOtherCharges)
          .where(
            and(
              eq(factoryContainerOtherCharges.containerId, containerId),
              eq(factoryContainerOtherCharges.companyId, companyId),
              ne(factoryContainerOtherCharges.currencyCode, "USD")
            )
          );

        if (tableCharges.length > 0) {
          await db
            .update(factoryContainerOtherCharges)
            .set({ currencyCode: "USD" })
            .where(
              and(
                eq(factoryContainerOtherCharges.containerId, containerId),
                eq(factoryContainerOtherCharges.companyId, companyId)
              )
            );

          // Void and re-post FACTORY-OC vouchers in USD
          const ocPrefix = `FACTORY-OC-${containerId}-%`;
          const existingVouchers = await db
            .select({ id: vouchers.id })
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, companyId),
                eq(vouchers.sourceModule, "FACTORY"),
                ilike(vouchers.voucherNumber, ocPrefix)
              )
            );
          if (existingVouchers.length > 0) {
            const vIds = existingVouchers.map((v) => v.id);
            await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
            await db.delete(vouchers).where(inArray(vouchers.id, vIds));
          }

          const [container] = await db
            .select({ containerNumber: factoryContainers.containerNumber, arrivalDate: factoryContainers.arrivalDate, createdAt: factoryContainers.createdAt })
            .from(factoryContainers)
            .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

          if (container) {
            const today = getClientDate(req);
            const containerCreatedDate = container.createdAt
              ? new Date(container.createdAt).toISOString().slice(0, 10)
              : today;
            const voucherDate = container.arrivalDate || containerCreatedDate;
            const payableAccId = await getOrCreateLedgerAccount(
              companyId,
              "FACTORY_CHARGES_PAYABLE",
              "Factory Charges Payable"
            );
            for (const charge of tableCharges) {
              const chargeAmt = parseFloat(charge.amount || "0");
              if (chargeAmt <= 0 || !charge.ledgerAccountId) continue;
              const ocVoucherNum = `FACTORY-OC-${containerId}-${charge.id}-${Date.now()}`;
              const [ocVoucher] = await db
                .insert(vouchers)
                .values({
                  companyId,
                  voucherType: "Journal",
                  voucherNumber: ocVoucherNum,
                  voucherDate,
                  description: `${charge.description} - container ${container.containerNumber}`,
                  totalAmount: String(chargeAmt),
                  currency: "USD",
                  exchangeRate: "1",
                  sourceModule: "FACTORY",
                })
                .returning();
              await db.insert(voucherEntries).values({
                voucherId: ocVoucher.id,
                ledgerAccountId: payableAccId,
                debitAmount: String(chargeAmt),
                creditAmount: "0",
                narration: `${charge.description} payable`,
              });
              await db.insert(voucherEntries).values({
                voucherId: ocVoucher.id,
                ledgerAccountId: charge.ledgerAccountId,
                debitAmount: "0",
                creditAmount: String(chargeAmt),
                narration: `${charge.description}`,
              });
            }
          }
        }

        fixed++;
      }

      res.json({ fixed });
    } catch (error: any) {
      console.error("Error fixing other charges currency:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 4b. Factory Containers - Excel Import
  // ───────────────────────────────────────────────

  app.post("/api/factory/containers/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows to import" });
      }

      const VALID_STATUSES = ["PENDING", "IN_TRANSIT", "AVAILABLE", "OFFLOADED"];
      const VALID_CURRENCIES = ["USD", "EUR", "AUD", "LBP", "GBP", "XOF", "XAF", "CFA"];

      const allSuppliers = await db.select().from(factorySuppliers).where(eq(factorySuppliers.companyId, companyId));

      const supplierMap = new Map<string, number>();
      allSuppliers.forEach((s: any) => supplierMap.set(s.name.toLowerCase().trim(), s.id));

      const results: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 1;
        try {
          if (!row.containerNumber || !row.containerNumber.trim()) {
            errors.push(`Row ${rowNum}: Missing container number`);
            continue;
          }

          const status = (row.status || "PENDING").toUpperCase();
          if (!VALID_STATUSES.includes(status)) {
            errors.push(
              `Row ${rowNum} (${row.containerNumber}): Invalid status "${row.status}". Must be one of: ${VALID_STATUSES.join(", ")}`
            );
            continue;
          }

          const currencyCode = (row.currencyCode || "USD").toUpperCase();
          if (!VALID_CURRENCIES.includes(currencyCode)) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid currency "${row.currencyCode}"`);
            continue;
          }

          const ratePerKg = parseFloat(row.ratePerKg || "0") || 0;
          const totalKg = parseFloat(row.totalKg || "0") || 0;

          if (row.totalKg && isNaN(parseFloat(row.totalKg))) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid Total Kg value`);
            continue;
          }
          if (row.ratePerKg && isNaN(parseFloat(row.ratePerKg))) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid Rate/Kg value`);
            continue;
          }

          const fxSource = (row.fxSource || "").toUpperCase() === "MANUAL" ? "manual" : "auto";
          const today = getClientDate(req);
          const importDate = row.arrivalDate || today;

          let fxRate: number;
          if (fxSource === "manual" && row.fxRateToUsd) {
            const parsedManualRate = parseFloat(row.fxRateToUsd);
            if (currencyCode !== "USD" && !(parsedManualRate > 0)) {
              errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid manual fxRateToUsd for ${currencyCode}`);
              continue;
            }
            fxRate = parsedManualRate;
          } else if (fxSource === "manual") {
            errors.push(
              `Row ${rowNum} (${row.containerNumber}): fxSource is MANUAL but fxRateToUsd was not provided`
            );
            continue;
          } else {
            try {
              fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, currencyCode, importDate));
            } catch (fxErr: any) {
              errors.push(`Row ${rowNum} (${row.containerNumber}): ${fxErr.message}`);
              continue;
            }
          }

          await db.transaction(async (tx: any) => {
            let supplierId: number | null = null;
            if (row.supplierName && row.supplierName.trim()) {
              const key = row.supplierName.toLowerCase().trim();
              if (supplierMap.has(key)) {
                supplierId = supplierMap.get(key)!;
              } else {
                const [newSupplier] = await tx
                  .insert(factorySuppliers)
                  .values({
                    companyId,
                    name: row.supplierName.trim(),
                    isActive: true,
                  })
                  .returning();
                supplierMap.set(key, newSupplier.id);
                supplierId = newSupplier.id;
              }
            }

            const ratePerKgUsd = currencyCode === "USD" ? ratePerKg : ratePerKg * fxRate;

            const commAmt = row.commissionAmount ? String(parseFloat(row.commissionAmount) || 0) : "0";
            const commCcy = (row.commissionCurrencyCode || "USD").toUpperCase();

            const [container] = await tx
              .insert(factoryContainers)
              .values({
                companyId,
                containerNumber: row.containerNumber.trim(),
                supplierId,
                origin: row.origin || null,
                totalKg: totalKg ? String(totalKg) : null,
                ratePerKg: ratePerKg ? String(ratePerKg) : null,
                currencyCode,
                fxRateToUsd: String(fxRate),
                fxRateToUsdImport: String(fxRate),
                fxRateSource: fxSource,
                fxRateDateImport: importDate,
                ratePerKgUsd: String(ratePerKgUsd),
                // Explicitly resolved above (validated manual entry or a real auto-fetch).
                fxRateConfirmed: true,
                arrivalDate: row.arrivalDate || null,
                notes: row.notes || null,
                status,
                commissionAmount: commAmt,
                commissionCurrencyCode: commCcy,
              })
              .returning();

            const excelDescParts = [
              container.containerNumber,
              row.supplierName?.trim() || null,
              totalKg > 0 ? `${totalKg.toLocaleString()} kg` : null,
              ratePerKg > 0 ? `${ratePerKg} ${currencyCode}/kg` : null,
            ].filter(Boolean);
            await writeDaybookEntry(tx, {
              companyId,
              txDate: container.arrivalDate || importDate,
              txType: "CONTAINER_IMPORT",
              referenceId: container.id,
              description: excelDescParts.join(" · "),
              currencyCode: container.currencyCode || "USD",
              amountCurrency: ratePerKg * totalKg,
              fxRateToUsd: fxRate,
            });

            results.push(container);
          });
        } catch (err: any) {
          errors.push(`Row ${rowNum} (${row.containerNumber || "unknown"}): ${err.message}`);
        }
      }

      res.json({
        imported: results.length,
        errors,
        total: rows.length,
      });
    } catch (error: any) {
      console.error("Error importing containers from Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Move a container from one supplier to another.
  // The factory balance model is derived (containers − payments), so updating
  // supplierId is sufficient to shift the payable from old → new supplier.
  // If the target supplier is a linked/child supplier (has parentId), the
  // commissionSupplierId is automatically set to that parent (the broker).
  // ───────────────────────────────────────────────
  app.post("/api/factory/containers/:id/move-supplier", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid container id" });

      const { targetSupplierId } = req.body;
      if (!targetSupplierId || isNaN(parseInt(targetSupplierId))) {
        return res.status(400).json({ message: "targetSupplierId is required" });
      }
      const targetId = parseInt(targetSupplierId);

      // Fetch container (must belong to this company and not be deleted)
      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId), isNull(factoryContainers.deletedAt)))
        .limit(1);
      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.supplierId === targetId) {
        return res.status(400).json({ message: "Container is already assigned to that supplier" });
      }

      // Fetch target supplier (must belong to same company)
      const [targetSupplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, targetId), eq(factorySuppliers.companyId, companyId)))
        .limit(1);
      if (!targetSupplier) return res.status(404).json({ message: "Target supplier not found" });

      // Get old supplier name for the response
      let fromSupplierName = "Unknown";
      if (container.supplierId) {
        const [fromSup] = await db
          .select({ name: factorySuppliers.name })
          .from(factorySuppliers)
          .where(eq(factorySuppliers.id, container.supplierId))
          .limit(1);
        if (fromSup) fromSupplierName = fromSup.name;
      }

      // If the target is a linked child supplier, auto-set commission to its parent (the broker).
      // If the target is a standalone/broker with no parent, clear commission.
      const newCommissionSupplierId = targetSupplier.parentId ?? null;

      const [updated] = await db
        .update(factoryContainers)
        .set({ supplierId: targetId, commissionSupplierId: newCommissionSupplierId, updatedAt: new Date() })
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)))
        .returning();

      res.json({ container: updated, fromSupplierName, toSupplierName: targetSupplier.name });
    } catch (error: any) {
      console.error("Error moving container supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 5. Factory Raw Stock
  // ───────────────────────────────────────────────

  registerFactoryRawStockRoutes(app);

  // ───────────────────────────────────────────────
  // NOTE: fx-rates CRUD is handled by factoryBalesRoutes (GET, POST, DELETE /:id,
  //       GET /latest/:currencyCode, GET /:currencyCode/:date).
  //       Do NOT add duplicate handlers here — Express first-match wins and
  //       the duplicate below would shadow the more complete bales implementation.
  // ───────────────────────────────────────────────
}
