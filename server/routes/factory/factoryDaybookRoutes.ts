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
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerFactoryDaybookRoutes(app: Express) {
  app.get("/api/factory/daybook", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currentUserId = (req.session as any).userId != null ? String((req.session as any).userId) : undefined;
      const { startDate, endDate, txType, currencyCode } = req.query;

      // ── Check if this user has "daybook_own_only" restriction ─────────────
      let ownOnly = false;
      if (currentUserId) {
        const [profile] = await db.select({ hiddenCostFields: factoryUserProfiles.hiddenCostFields })
          .from(factoryUserProfiles)
          .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, currentUserId)));
        if (profile?.hiddenCostFields?.includes("daybook_own_only")) ownOnly = true;
      }

      // ── 1. Query existing factory_daybook_entries ──────────────────────────
      const conditions: any[] = [
        eq(factoryDaybookEntries.companyId, companyId),
        // Exclude void/delete audit entries — they are internal records, not daybook events
        sql`${factoryDaybookEntries.txType} NOT LIKE '%_VOIDED'`,
        sql`${factoryDaybookEntries.txType} NOT LIKE '%_DELETED'`,
        // Exclude loading lifecycle events — these are operational, not financial
        sql`${factoryDaybookEntries.txType} NOT IN ('LOADING_CREATED','LOADING_SUBMITTED')`,
      ];
      // If user is restricted to own entries only, show their entries + unattributed ones (NULL createdBy)
      if (ownOnly && currentUserId) {
        conditions.push(
          or(
            eq(factoryDaybookEntries.createdBy, currentUserId),
            isNull(factoryDaybookEntries.createdBy)
          )!
        );
      }
      if (startDate) conditions.push(sql`${factoryDaybookEntries.txDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${factoryDaybookEntries.txDate} <= ${endDate}`);
      if (txType) conditions.push(eq(factoryDaybookEntries.txType, txType as string));
      if (currencyCode) conditions.push(eq(factoryDaybookEntries.currencyCode, currencyCode as string));
      const daybookRows = await db.select().from(factoryDaybookEntries)
        .where(and(...conditions))
        .orderBy(desc(factoryDaybookEntries.txDate), desc(factoryDaybookEntries.id));

      // ── 1b. Safety-net: drop real daybook entries whose source voucher was deleted ─
      // Also fetch `optional` flag for voucher-backed rows
      const voucherRefIds = daybookRows
        .filter((r: any) => r.referenceTable === "vouchers" && r.referenceId != null)
        .map((r: any) => r.referenceId as number);

      const validVoucherIds = new Set<number>();
      const voucherOptionalMap = new Map<number, boolean>();
      if (voucherRefIds.length > 0) {
        const liveVouchers = await db
          .select({ id: vouchers.id, optional: vouchers.optional })
          .from(vouchers)
          .where(and(
            inArray(vouchers.id, voucherRefIds),
            sql`${vouchers.deletedAt} IS NULL`
          ));
        liveVouchers.forEach((v: any) => {
          validVoucherIds.add(v.id);
          voucherOptionalMap.set(v.id, !!v.optional);
        });
      }

      const filteredDaybookRows = daybookRows
        .filter((r: any) => {
          if (r.referenceTable !== "vouchers" || r.referenceId == null) return true;
          return validVoucherIds.has(r.referenceId);
        })
        .map((r: any) => ({
          ...r,
          optional: r.referenceTable === "vouchers" && r.referenceId != null
            ? voucherOptionalMap.get(r.referenceId) ?? false
            : false,
        }));

      // ── 2. Query vouchers directly (to catch pre-fix historical entries) ───
      // Only include Payment / Receipt / Journal vouchers in the daybook view
      const voucherTxTypeMap: Record<string, string> = {
        Payment: "PAYMENT",
        Receipt: "RECEIPT",
        Journal: "JOURNAL",
      };
      // If a txType filter is applied, skip voucher pull for non-voucher types
      const voucherTypesReversed: Record<string, string> = {
        PAYMENT: "Payment",
        RECEIPT: "Receipt",
        JOURNAL: "Journal",
      };
      const shouldFetchVouchers = !txType || txType in voucherTypesReversed;

      let syntheticRows: any[] = [];
      if (shouldFetchVouchers) {
        // Build the set of voucher IDs already captured in factory_daybook_entries
        // Use filteredDaybookRows so deleted-voucher entries don't block synthetic rows
        const capturedVoucherIds = new Set<number>(
          filteredDaybookRows
            .filter((r: any) => r.referenceTable === "vouchers" && r.referenceId != null)
            .map((r: any) => r.referenceId as number)
        );

        const voucherConds: any[] = [
          eq(vouchers.companyId, companyId),
          sql`${vouchers.deletedAt} IS NULL`,
          inArray(vouchers.voucherType, ["Payment", "Receipt", "Journal"]),
        ];
        if (startDate) voucherConds.push(sql`${vouchers.voucherDate} >= ${startDate}`);
        if (endDate) voucherConds.push(sql`${vouchers.voucherDate} <= ${endDate}`);
        if (txType && txType in voucherTypesReversed) {
          voucherConds.push(eq(vouchers.voucherType, voucherTypesReversed[txType as string]));
        }
        if (currencyCode && currencyCode !== "ALL") {
          voucherConds.push(eq(vouchers.currency, currencyCode as string));
        }

        const rawVouchers = await db.select().from(vouchers).where(and(...voucherConds));

        syntheticRows = rawVouchers
          .filter((v: any) => !capturedVoucherIds.has(v.id))
          .map((v: any) => {
            const txTypeVal = voucherTxTypeMap[v.voucherType] || "JOURNAL";
            const currency = v.currency || "USD";
            const fxRate = parseFloat(v.exchangeRate || "1") || 1;
            const amtCurrency = parseFloat(v.totalAmount || "0");
            const amtUsd = currency === "USD" ? amtCurrency : amtCurrency * fxRate;
            return {
              id: -(v.id),          // negative id so FE can distinguish; won't clash with real ids
              companyId: v.companyId,
              txDate: v.voucherDate,
              txType: txTypeVal,
              referenceId: v.id,
              referenceTable: "vouchers",
              description: v.description || `${v.voucherType} voucher #${v.voucherNumber}`,
              currencyCode: currency,
              amountCurrency: String(amtCurrency),
              fxRateToUsd: String(fxRate),
              amountUsd: String(amtUsd),
              optional: !!v.optional,
              createdAt: v.createdAt,
              createdBy: null,
            };
          });
      }

      // ── 2b. Enrich zero-amount entries for BALE_STOCK_ENTRY and loading types ──
      // These were written before amount-population was in place; derive on the fly.
      const zeroRows = filteredDaybookRows.filter(
        (r: any) => parseFloat(r.amountCurrency || "0") === 0 &&
          ["BALE_STOCK_ENTRY", "LOADING_SUBMITTED", "ORDER_VERIFIED"].includes(r.txType)
      );

      if (zeroRows.length > 0) {
        // BALE_STOCK_ENTRY: derive from bale IDs stored in metaJson
        const baleStockRows = zeroRows.filter((r: any) => r.txType === "BALE_STOCK_ENTRY");
        if (baleStockRows.length > 0) {
          // Collect all bale IDs across all zero bale stock entries
          // Only integer IDs are valid — old entries may have stored UUIDs which Postgres rejects
          const baleIdToEntry = new Map<number, any[]>();
          for (const row of baleStockRows) {
            try {
              const meta = JSON.parse(row.metaJson || "{}");
              const bales: any[] = Array.isArray(meta.bales) ? meta.bales : [];
              for (const b of bales) {
                const numId = parseInt(b.id, 10);
                if (!b.id || isNaN(numId) || String(numId) !== String(b.id)) continue; // skip UUIDs / non-integers
                if (!baleIdToEntry.has(numId)) baleIdToEntry.set(numId, []);
                baleIdToEntry.get(numId)!.push({ row, weightKg: parseFloat(b.weightKg || "0") });
              }
            } catch {}
          }
          if (baleIdToEntry.size > 0) {
            const allBaleIds = Array.from(baleIdToEntry.keys());
            // Fetch costPerKg, productId, and articleCode for multi-level fallback
            const baleRecords = await db.select({
              id: factoryBales.id,
              costPerKg: factoryBales.costPerKg,
              productId: factoryBales.productId,
              articleCode: factoryBales.articleCode,
            }).from(factoryBales).where(inArray(factoryBales.id, allBaleIds));

            // Build product production price map: by id (primary) and by articleCode (fallback)
            // Production price is what was spent to produce the bale — used for cost-side daybook entries.
            const productProductionPriceById = new Map<number, number>();
            const productProductionPriceByArticleCode = new Map<string, number>();
            const allProducts = await db.select({
              id: factoryBaleProducts.id,
              articleCode: factoryBaleProducts.articleCode,
              productionPrice: (factoryBaleProducts as any).productionPrice,
            }).from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
            allProducts.forEach((p: any) => {
              productProductionPriceById.set(p.id, parseFloat(p.productionPrice || "0"));
              if (p.articleCode) productProductionPriceByArticleCode.set(p.articleCode, parseFloat(p.productionPrice || "0"));
            });

            // Accumulate value per daybook row id using productionPrice (per bale)
            const rowValueMap = new Map<number, number>();
            for (const baleRec of baleRecords) {
              const entries = baleIdToEntry.get(baleRec.id) || [];
              let val = 0;
              // primary: productId → productionPrice
              if (baleRec.productId) val = productProductionPriceById.get(baleRec.productId) || 0;
              // fallback: articleCode → productionPrice
              if (val === 0 && baleRec.articleCode) val = productProductionPriceByArticleCode.get(baleRec.articleCode) || 0;
              for (const { row } of entries) {
                rowValueMap.set(row.id, (rowValueMap.get(row.id) || 0) + val);
              }
            }

            // Patch the filteredDaybookRows in-place
            for (const row of filteredDaybookRows as any[]) {
              if (row.txType === "BALE_STOCK_ENTRY" && parseFloat(row.amountCurrency || "0") === 0) {
                const derived = rowValueMap.get(row.id);
                if (derived && derived > 0) {
                  row.amountCurrency = String(derived.toFixed(2));
                  row.amountUsd = String(derived.toFixed(2));
                }
              }
            }
          }
        }

        // LOADING_SUBMITTED / ORDER_VERIFIED: derive from customerOrderBales.priceUsed
        const loadingRows = zeroRows.filter((r: any) =>
          ["LOADING_SUBMITTED", "ORDER_VERIFIED"].includes(r.txType) && r.referenceId
        );
        if (loadingRows.length > 0) {
          const orderIds = [...new Set(loadingRows.map((r: any) => r.referenceId as number))];
          const orderBaleValues = await db.select({
            orderId: customerOrderBales.orderId,
            priceUsed: customerOrderBales.priceUsed,
          }).from(customerOrderBales).where(inArray(customerOrderBales.orderId, orderIds));

          const orderTotals = new Map<number, number>();
          for (const b of orderBaleValues) {
            const oid = b.orderId;
            orderTotals.set(oid, (orderTotals.get(oid) || 0) + parseFloat(b.priceUsed || "0"));
          }

          for (const row of filteredDaybookRows as any[]) {
            if (["LOADING_SUBMITTED", "ORDER_VERIFIED"].includes(row.txType) && parseFloat(row.amountCurrency || "0") === 0) {
              const total = orderTotals.get(row.referenceId);
              if (total && total > 0) {
                row.amountCurrency = String(total.toFixed(2));
                row.amountUsd = String(total.toFixed(2));
              }
            }
          }
        }
      }

      // ── 3. Merge + sort ────────────────────────────────────────────────────
      // If ownOnly, exclude synthetic rows (voucher-derived rows with no createdBy)
      const effectiveSyntheticRows = ownOnly ? [] : syntheticRows;
      const merged = [...filteredDaybookRows, ...effectiveSyntheticRows].sort((a: any, b: any) => {
        if (b.txDate > a.txDate) return 1;
        if (b.txDate < a.txDate) return -1;
        return Math.abs(b.id) - Math.abs(a.id);
      });

      res.json(merged);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // FACTORY CUSTOMERS CRUD
  // ───────────────────────────────────────────────

}
