import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { classifyNetPositionAccounts } from "../netPositionHelper";
import { adjustInventory } from "../inventoryHelper";
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

export function registerFactoryCustomersRoutes(app: Express) {
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

            // Build product selling price map: by id (primary) and by articleCode (fallback)
            const productSellingPriceById = new Map<number, number>();
            const productSellingPriceByArticleCode = new Map<string, number>();
            // Always fetch products so we can look up sellingPrice per bale
            const allProducts = await db.select({
              id: factoryBaleProducts.id,
              articleCode: factoryBaleProducts.articleCode,
              sellingPrice: factoryBaleProducts.sellingPrice,
            }).from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
            allProducts.forEach((p: any) => {
              productSellingPriceById.set(p.id, parseFloat(p.sellingPrice || "0"));
              if (p.articleCode) productSellingPriceByArticleCode.set(p.articleCode, parseFloat(p.sellingPrice || "0"));
            });

            // Accumulate value per daybook row id using sellingPrice (per bale)
            const rowValueMap = new Map<number, number>();
            for (const baleRec of baleRecords) {
              const entries = baleIdToEntry.get(baleRec.id) || [];
              let val = 0;
              // primary: productId → sellingPrice
              if (baleRec.productId) val = productSellingPriceById.get(baleRec.productId) || 0;
              // fallback: articleCode → sellingPrice
              if (val === 0 && baleRec.articleCode) val = productSellingPriceByArticleCode.get(baleRec.articleCode) || 0;
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

  app.get("/api/factory/customers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCustomers = await db.select().from(customers)
        .where(and(eq(customers.companyId, companyId), sql`${customers.deletedAt} IS NULL`))
        .orderBy(asc(customers.legalName));

      if (allCustomers.length === 0) {
        return res.json([]);
      }

      const customerIds = allCustomers.map((c) => c.id);

      // Fetch all sales totals in one query
      const salesRows = await db.select({
        customerId: customerOrders.customerId,
        total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
      })
        .from(customerOrders)
        .where(and(
          inArray(customerOrders.customerId, customerIds),
          eq(customerOrders.companyId, companyId),
          eq(customerOrders.status, "FINALIZED"),
        ))
        .groupBy(customerOrders.customerId);

      // Fetch all non-invoice balance adjustments in one query
      const nonInvRows = await db.select({
        customerId: customerBalances.customerId,
        net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
      })
        .from(customerBalances)
        .where(and(
          inArray(customerBalances.customerId, customerIds),
          eq(customerBalances.companyId, companyId),
          sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`,
        ))
        .groupBy(customerBalances.customerId);

      // Fetch net voucher entries — two passes to match what the statement page shows:
      // 1. Entries linked via the customer's ledgerAccountId
      // 2. Entries linked directly via customerId (e.g. receipt vouchers)
      // Exclude CHARGE-* vouchers: those amounts are already in salesTotal via grandTotal.
      const ledgerAccountIds = allCustomers
        .filter((c) => c.ledgerAccountId)
        .map((c) => c.ledgerAccountId!);

      // net = debit - credit in Dr-positive convention (customer is an asset / receivable)
      const voucherNetByLedger = new Map<number, number>();
      if (ledgerAccountIds.length > 0) {
        const voucherNetRows = await db.select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, and(
            eq(voucherEntries.voucherId, vouchers.id),
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          ))
          .where(inArray(voucherEntries.ledgerAccountId as any, ledgerAccountIds))
          .groupBy(voucherEntries.ledgerAccountId);

        for (const row of voucherNetRows) {
          if (row.ledgerAccountId) {
            voucherNetByLedger.set(row.ledgerAccountId, parseFloat(row.net || "0"));
          }
        }
      }

      // Net from entries linked directly via customerId (receipts posted without going through ledger)
      const voucherNetByCustomerId = new Map<number, number>();
      if (customerIds.length > 0) {
        const directRows = await db.select({
          customerId: voucherEntries.customerId,
          net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, and(
            eq(voucherEntries.voucherId, vouchers.id),
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          ))
          .where(and(
            inArray(voucherEntries.customerId as any, customerIds),
            sql`${voucherEntries.ledgerAccountId} IS NULL`,
          ))
          .groupBy(voucherEntries.customerId);

        for (const row of directRows) {
          if (row.customerId) {
            voucherNetByCustomerId.set(row.customerId, parseFloat(row.net || "0"));
          }
        }
      }

      const salesMap = new Map(salesRows.map((r) => [r.customerId, parseFloat(r.total || "0")]));
      const nonInvMap = new Map(nonInvRows.map((r) => [r.customerId, parseFloat(r.net || "0")]));

      const customersWithBalances = allCustomers.map((customer) => {
        const salesTotal = salesMap.get(customer.id) ?? 0;
        const nonInvNet = nonInvMap.get(customer.id) ?? 0;
        const voucherNet = (customer.ledgerAccountId ? (voucherNetByLedger.get(customer.ledgerAccountId) ?? 0) : 0)
          + (voucherNetByCustomerId.get(customer.id) ?? 0);
        const openingBalance = parseFloat(customer.openingBalance || "0");
        const openingSide = customer.openingBalanceSide || "Dr";
        const totalBalance = (openingSide === "Dr" ? openingBalance : -openingBalance) + salesTotal + nonInvNet + voucherNet;
        return { ...customer, balance: Math.abs(totalBalance), balanceSide: totalBalance >= 0 ? "Dr" : "Cr" };
      });

      res.json(customersWithBalances);
    } catch (error: any) {
      console.error("Error fetching factory customers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dataWithCompany = { ...req.body, companyId };
      const parsed = insertCustomerSchema.parse(dataWithCompany);

      let suffix = 1;
      const allExisting = await db.select().from(customers)
        .where(eq(customers.companyId, companyId));

      const existingCodes = allExisting
        .map((c) => c.code)
        .filter((c) => c.startsWith("CUST"))
        .map((c) => parseInt(c.replace("CUST", "")))
        .filter((n) => !isNaN(n));

      if (existingCodes.length > 0) {
        suffix = Math.max(...existingCodes) + 1;
      }
      let code = `CUST${suffix.toString().padStart(3, "0")}`;

      let codeExists = true;
      while (codeExists) {
        const [dup] = await db.select().from(customers)
          .where(and(eq(customers.code, code), eq(customers.companyId, companyId)));
        if (dup) {
          suffix++;
          code = `CUST${suffix.toString().padStart(3, "0")}`;
        } else {
          codeExists = false;
        }
      }

      const [customer] = await db.insert(customers).values({ ...parsed, code }).returning();

      res.status(201).json(customer);
    } catch (error: any) {
      console.error("Error creating factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      if (req.body.code && req.body.code !== existing.code) {
        const [dup] = await db.select().from(customers)
          .where(and(eq(customers.code, req.body.code), eq(customers.companyId, companyId)));
        if (dup) return res.status(400).json({ message: "Customer code already exists" });
      }

      const parsed = insertCustomerSchema.partial().parse(req.body);
      const [updated] = await db.update(customers).set(parsed)
        .where(eq(customers.id, customerId)).returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const [deleted] = await db.update(customers)
        .set({ deletedAt: new Date() })
        .where(eq(customers.id, customerId))
        .returning();

      res.json(deleted);
    } catch (error: any) {
      console.error("Error deleting factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // RESTORE DELETED CUSTOMER
  app.post("/api/factory/customers/:id/restore", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const [restored] = await db.update(customers)
        .set({ deletedAt: null })
        .where(eq(customers.id, customerId))
        .returning();

      res.json(restored);
    } catch (error: any) {
      console.error("Error restoring factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // LIST DELETED CUSTOMERS
  app.get("/api/factory/customers/deleted", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const deletedCustomers = await db.select().from(customers)
        .where(and(eq(customers.companyId, companyId), sql`${customers.deletedAt} IS NOT NULL`))
        .orderBy(desc(customers.deletedAt));

      res.json(deletedCustomers);
    } catch (error: any) {
      console.error("Error fetching deleted factory customers:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // CUSTOMER STATEMENT
  // ───────────────────────────────────────────────

  app.get("/api/factory/customers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      // Get finalized invoices
      const invoices = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          grandTotal: customerOrders.grandTotal,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          status: customerOrders.status,
          createdAt: customerOrders.createdAt,
        })
        .from(customerOrders)
        .where(and(
          eq(customerOrders.companyId, companyId),
          eq(customerOrders.customerId, customerId),
          eq(customerOrders.status, "FINALIZED"),
        ))
        .orderBy(desc(customerOrders.createdAt));

      // Auto-sync: update any INVOICE-type balance rows whose debitAmount differs from
      // the current invoice grandTotal (happens when the invoice was repriced after finalization)
      const invoiceBalanceEntries = await db.select({
        id: customerBalances.id,
        referenceId: customerBalances.referenceId,
        debitAmount: customerBalances.debitAmount,
      }).from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.customerId, customerId),
          eq(customerBalances.referenceType, "INVOICE"),
        ));

      for (const entry of invoiceBalanceEntries) {
        if (!entry.referenceId) continue;
        const [inv] = await db.select({ grandTotal: customerOrders.grandTotal })
          .from(customerOrders)
          .where(eq(customerOrders.id, entry.referenceId));
        if (inv) {
          const storedAmt = parseFloat(entry.debitAmount || "0");
          const actualAmt = parseFloat(inv.grandTotal || "0");
          if (Math.abs(storedAmt - actualAmt) > 0.001) {
            await db.update(customerBalances)
              .set({ debitAmount: String(actualAmt), balance: String(actualAmt) })
              .where(eq(customerBalances.id, entry.id));
          }
        }
      }

      // Get all balance history entries ordered by date
      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Also pull voucher entries for this customer (by ledgerAccountId or direct customerId link)
      // to include manual accounting vouchers that don't flow through customerBalances.
      // Exclude CHARGE-* vouchers (those are already included via invoices).
      const voucherRows: any[] = [];
      const ledgerAccountId = (customer as any).ledgerAccountId;
      const voucherConditions = ledgerAccountId
        ? sql`(${voucherEntries.ledgerAccountId} = ${ledgerAccountId} OR ${voucherEntries.customerId} = ${customerId})`
        : sql`${voucherEntries.customerId} = ${customerId}`;

      const rawVoucherRows = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, and(
          eq(voucherEntries.voucherId, vouchers.id),
          eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`,
        ))
        .where(voucherConditions)
        .orderBy(vouchers.voucherDate, voucherEntries.id);

      // Convert to unified row format matching customerBalances shape
      for (const ve of rawVoucherRows) {
        voucherRows.push({
          id: `ve-${ve.id}`,
          customerId,
          companyId,
          transactionDate: ve.voucherDate,
          transactionType: ve.voucherType || "VOUCHER",
          referenceType: "VOUCHER",
          referenceId: ve.voucherId,
          referenceNumber: ve.voucherNumber,
          description: ve.narration || ve.description || ve.voucherType,
          debitAmount: ve.debitAmount ?? "0",
          creditAmount: ve.creditAmount ?? "0",
          balance: "0",
          _fromVoucher: true,
        });
      }

      // Merge customerBalances + voucher rows, sort by date then id
      const allRows = [...balanceRows.map((r: any) => ({ ...r, _fromVoucher: false })), ...voucherRows]
        .sort((a, b) => {
          const da = (a.transactionDate || "").toString();
          const db2 = (b.transactionDate || "").toString();
          if (da < db2) return -1;
          if (da > db2) return 1;
          // same date: customerBalances rows first (they have numeric ids)
          const ia = a._fromVoucher ? 1 : 0;
          const ib = b._fromVoucher ? 1 : 0;
          return ia - ib;
        });

      // Build running balance
      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const balanceHistory = allRows.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        return {
          ...row,
          runningBalance,
          runningBalanceSide: runningBalance >= 0 ? "Dr" : "Cr",
        };
      });

      const currentBalance = Math.abs(runningBalance);
      const currentBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      res.json({
        customer,
        invoices,
        balanceHistory,
        currentBalance,
        currentBalanceSide,
        openingBalance,
        openingBalanceSide: openingSide,
      });
    } catch (error: any) {
      console.error("Error fetching customer statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Customer Statement: PDF Export ──────────────────────────────────────
  app.get("/api/factory/customers/:id/statement/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Pull voucher entries (same logic as statement endpoint)
      const voucherRowsPdf: any[] = [];
      const ledgerAccountIdPdf = (customer as any).ledgerAccountId;
      const voucherCondPdf = ledgerAccountIdPdf
        ? sql`(${voucherEntries.ledgerAccountId} = ${ledgerAccountIdPdf} OR ${voucherEntries.customerId} = ${customerId})`
        : sql`${voucherEntries.customerId} = ${customerId}`;
      const rawVePdf = await db.select({
        id: voucherEntries.id, voucherId: voucherEntries.voucherId,
        voucherNumber: vouchers.voucherNumber, voucherType: vouchers.voucherType,
        voucherDate: vouchers.voucherDate, description: vouchers.description,
        debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount,
        narration: voucherEntries.narration,
      }).from(voucherEntries)
        .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`, sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`))
        .where(voucherCondPdf).orderBy(vouchers.voucherDate, voucherEntries.id);
      for (const ve of rawVePdf) {
        voucherRowsPdf.push({
          transactionDate: ve.voucherDate, transactionType: ve.voucherType || "VOUCHER",
          referenceType: "VOUCHER", referenceNumber: ve.voucherNumber,
          description: ve.narration || ve.description || ve.voucherType,
          debitAmount: ve.debitAmount ?? "0", creditAmount: ve.creditAmount ?? "0", _fromVoucher: true,
        });
      }
      const allRowsPdf = [...balanceRows.map((r: any) => ({ ...r, _fromVoucher: false })), ...voucherRowsPdf]
        .sort((a, b) => {
          const da = (a.transactionDate || "").toString(), db2 = (b.transactionDate || "").toString();
          if (da !== db2) return da < db2 ? -1 : 1;
          return (a._fromVoucher ? 1 : 0) - (b._fromVoucher ? 1 : 0);
        });

      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const rows = allRowsPdf.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        return { ...row, debit, credit };
      });

      const totalDr = rows.reduce((s: number, r: any) => s + r.debit, 0);
      const totalCr = rows.reduce((s: number, r: any) => s + r.credit, 0);
      const closingBalance = Math.abs(runningBalance);
      const closingBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      const fmtAmt = (n: number) => n > 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
      const fmtDate = (d: string) => {
        if (!d) return "";
        const [y, m, day] = d.split("-");
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${parseInt(day, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
      };
      const txLabel = (type: string) => {
        const map: Record<string, string> = { SALE: "Sale", PAYMENT: "Payment", RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", JOURNAL: "Journal", OPENING_BALANCE: "Opening Bal." };
        return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };

      const PDFDocument = (await import("pdfkit")).default;
      const pathModCust = await import("path");
      const companyName = (company as any)?.legalName || "Company";

      // Arabic font + reshaper — always load
      const custFontDir = pathModCust.join(process.cwd(), "server", "fonts");
      const custArabicFontPath = pathModCust.join(custFontDir, "Amiri-Regular.ttf");
      const custHasArabicFont = fs.existsSync(custArabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (custHasArabicFont) doc.registerFont("Arabic", custArabicFontPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${(customer.code || customerId).toString().replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      let custConvAr: ((t: string) => string) | null = null;
      let custBidi: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
      try {
        custConvAr = (require("arabic-reshaper") as any).convertArabic;
        custBidi = (require("bidi-js") as any)();
      } catch {}
      const custHasAr = (t: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t);
      const custShape = (t: string): string => {
        if (!t || !custConvAr) return t;
        try {
          const r = custConvAr(t);
          if (custBidi) { const lv = custBidi.getEmbeddingLevels(r, "rtl"); return custBidi.getReorderedString(r, lv); }
          return r;
        } catch { return t; }
      };
      const custRender = (text: string, x: number, yPos: number, w: number, align: "left"|"right" = "left") => {
        const ar = custHasArabicFont && custHasAr(text);
        doc.font(ar ? "Arabic" : "Helvetica").fontSize(8)
          .text(ar ? custShape(text) : text, x, yPos, { width: w, align: ar ? "right" : align });
      };

      // ── Logo above header ──
      const custHmdLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(custHmdLogoPath)) {
        try { doc.image(custHmdLogoPath, (doc.page.width - 200) / 2, 10, { width: 200 }); } catch {}
      }

      // ── Dark header bar ──
      doc.rect(40, 96, 515, 40).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13)
        .text("Account Statement", 44, 102, { width: 350 });
      const printDate = fmtDate(new Date().toISOString().split("T")[0]);
      doc.font("Helvetica").fontSize(8).text(`Printed: ${printDate}`, 420, 116, { width: 135, align: "right" });

      // ── Customer info block ──
      const infoY = 140;
      doc.fillColor("#000000").font("Helvetica").fontSize(9);
      doc.text("Customer:", 40, infoY);
      custRender(customer.legalName, 40, infoY + 12, 250);
      doc.font("Helvetica").text(`Code: ${customer.code || "—"}`, 40, infoY + 24);
      doc.text(`Phone: ${customer.phone || "—"}`, 40, infoY + 36);
      const obLabel = `${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingSide}`;
      doc.text(`Opening Balance: `, 300, infoY + 12, { continued: true }).font("Helvetica-Bold").text(obLabel);
      doc.font("Helvetica");

      // ── Table ──
      const colX   = [40,  115, 185, 380, 468];
      const colW   = [75,   70, 195,  88,  87];
      const colHdr = ["Date", "Type", "Description", "Debit (Dr)", "Credit (Cr)"];
      const colAlign: Array<"left" | "right"> = ["left", "left", "left", "right", "right"];
      const tableTop = infoY + 68;

      doc.rect(40, tableTop, 515, 14).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      let y = tableTop + 16;

      // Opening balance row if non-zero
      if (openingBalance > 0) {
        doc.rect(40, y, 515, 13).fill("#EFF3FB");
        doc.fillColor("#000000");
        doc.text(fmtDate(new Date().toISOString().split("T")[0]), colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text("Opening Bal.", colX[1] + 2, y + 3, { width: colW[1] - 4 });
        doc.text("Opening Balance", colX[2] + 2, y + 3, { width: colW[2] - 4 });
        if (openingSide === "Dr") {
          doc.text(obLabel, colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
        } else {
          doc.text(obLabel, colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        }
        y += 13;
      }

      rows.forEach((row: any, idx: number) => {
        if (y > 760) { doc.addPage(); y = 40; }
        if (idx % 2 === 1) { doc.rect(40, y, 515, 13).fill("#F8F8F8"); doc.fillColor("#000000"); }
        doc.font("Helvetica").fontSize(8);
        doc.text(fmtDate(row.transactionDate), colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text(txLabel(row.transactionType), colX[1] + 2, y + 3, { width: colW[1] - 4 });
        custRender(row.description || "—", colX[2] + 2, y + 3, colW[2] - 4, "left");
        doc.font("Helvetica").fontSize(8);
        if (row.debit > 0) doc.text(fmtAmt(row.debit), colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
        if (row.credit > 0) doc.text(fmtAmt(row.credit), colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        y += 13;
      });

      // Separator
      y += 3;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 6;

      // Totals row
      doc.rect(40, y, 515, 15).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      doc.text("TOTAL", colX[2] + 2, y + 4, { width: colW[2] - 4 });
      doc.text(fmtAmt(totalDr) || "0.00", colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      doc.text(fmtAmt(totalCr) || "0.00", colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      y += 17;

      // Closing balance row
      doc.rect(40, y, 515, 15).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      doc.text("Closing Balance", colX[2] + 2, y + 4, { width: colW[2] - 4 });
      const closingStr = closingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + closingBalanceSide;
      if (closingBalanceSide === "Dr") {
        doc.text(closingStr, colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      } else {
        doc.text(closingStr, colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      }

      doc.end();
    } catch (error: any) {
      console.error("Error exporting customer statement PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Customer Statement: Excel Export ────────────────────────────────────
  app.get("/api/factory/customers/:id/statement/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Pull voucher entries (same logic as statement endpoint)
      const voucherRowsXlsx: any[] = [];
      const ledgerAccountIdXlsx = (customer as any).ledgerAccountId;
      const voucherCondXlsx = ledgerAccountIdXlsx
        ? sql`(${voucherEntries.ledgerAccountId} = ${ledgerAccountIdXlsx} OR ${voucherEntries.customerId} = ${customerId})`
        : sql`${voucherEntries.customerId} = ${customerId}`;
      const rawVeXlsx = await db.select({
        id: voucherEntries.id, voucherId: voucherEntries.voucherId,
        voucherNumber: vouchers.voucherNumber, voucherType: vouchers.voucherType,
        voucherDate: vouchers.voucherDate, description: vouchers.description,
        debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount,
        narration: voucherEntries.narration,
      }).from(voucherEntries)
        .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`, sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`))
        .where(voucherCondXlsx).orderBy(vouchers.voucherDate, voucherEntries.id);
      for (const ve of rawVeXlsx) {
        voucherRowsXlsx.push({
          transactionDate: ve.voucherDate, transactionType: ve.voucherType || "VOUCHER",
          referenceType: "VOUCHER", referenceNumber: ve.voucherNumber,
          description: ve.narration || ve.description || ve.voucherType,
          debitAmount: ve.debitAmount ?? "0", creditAmount: ve.creditAmount ?? "0", _fromVoucher: true,
        });
      }
      const allRowsXlsx = [...balanceRows.map((r: any) => ({ ...r, _fromVoucher: false })), ...voucherRowsXlsx]
        .sort((a, b) => {
          const da = (a.transactionDate || "").toString(), db2 = (b.transactionDate || "").toString();
          if (da !== db2) return da < db2 ? -1 : 1;
          return (a._fromVoucher ? 1 : 0) - (b._fromVoucher ? 1 : 0);
        });

      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const rows = allRowsXlsx.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        return { ...row, debit, credit };
      });

      const totalDr = rows.reduce((s: number, r: any) => s + r.debit, 0);
      const totalCr = rows.reduce((s: number, r: any) => s + r.credit, 0);
      const closingBalance = Math.abs(runningBalance);
      const closingBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      const txLabel = (type: string) => {
        const map: Record<string, string> = { SALE: "Sale", PAYMENT: "Payment", RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", JOURNAL: "Journal", OPENING_BALANCE: "Opening Bal." };
        return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };
      const numFmt = "#,##0.00";
      const navyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F3864" } };
      const lightBlueFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF3FB" } };
      const greyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF5F5F5" } };
      const allBorders = {
        top: { style: "thin" as const }, bottom: { style: "thin" as const },
        left: { style: "thin" as const }, right: { style: "thin" as const },
      };

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Statement");

      sheet.columns = [
        { key: "date",  width: 14 },
        { key: "type",  width: 16 },
        { key: "desc",  width: 36 },
        { key: "dr",    width: 16 },
        { key: "cr",    width: 16 },
      ];

      // Rows 1–5+: Customer info block with HMD branding
      try {
        const stmtLogo = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(stmtLogo)) {
          const slBuf = fs.readFileSync(stmtLogo);
          const slId = workbook.addImage({ buffer: slBuf as Buffer, extension: "jpeg" });
          const slRow = sheet.addRow([]); slRow.height = 90;
          sheet.addImage(slId, { tl: { col: 1.9, row: 0 }, ext: { width: 300, height: 90 } });
          sheet.mergeCells(`A1:E1`);
        }
      } catch {}
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
      sheet.mergeCells(`A${r1.number}:E${r1.number}`);
      const r2 = sheet.addRow(["Account Statement"]);
      r2.getCell(1).font = { bold: true, size: 11 };
      sheet.mergeCells(`A${r2.number}:E${r2.number}`);
      const r3 = sheet.addRow([`Customer: ${customer.legalName}   |   Code: ${customer.code || "—"}   |   Phone: ${customer.phone || "—"}`]);
      sheet.mergeCells(`A${r3.number}:E${r3.number}`);
      const r4 = sheet.addRow([`Opening Balance: ${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingSide}`]);
      sheet.mergeCells(`A${r4.number}:E${r4.number}`);
      const r5 = sheet.addRow([`Printed: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]);
      sheet.mergeCells(`A${r5.number}:E${r5.number}`);
      // spacer
      sheet.addRow([]);

      // Column headers
      const hdrRow = sheet.addRow(["Date", "Type", "Description", "Debit (Dr)", "Credit (Cr)"]);
      hdrRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
      });

      // Opening balance row if non-zero
      if (openingBalance > 0) {
        const obRow = sheet.addRow([
          new Date().toLocaleDateString("en-GB"),
          "Opening Bal.",
          "Opening Balance",
          openingSide === "Dr" ? openingBalance : null,
          openingSide === "Cr" ? openingBalance : null,
        ]);
        obRow.eachCell((cell) => {
          cell.fill = lightBlueFill;
          cell.border = allBorders;
        });
        obRow.getCell(4).numFmt = numFmt;
        obRow.getCell(5).numFmt = numFmt;
      }

      // Data rows
      rows.forEach((row: any, idx: number) => {
        const dr = row.debit > 0 ? row.debit : null;
        const cr = row.credit > 0 ? row.credit : null;
        const dateVal = row.transactionDate
          ? new Date(row.transactionDate + "T00:00:00")
          : "";
        const dr2 = sheet.addRow([dateVal, txLabel(row.transactionType), row.description || "—", dr, cr]);
        dr2.eachCell((cell) => { cell.border = allBorders; });
        if (idx % 2 === 0) {
          dr2.eachCell((cell) => { cell.fill = greyFill; });
        }
        dr2.getCell(1).numFmt = "dd/mm/yyyy";
        dr2.getCell(4).numFmt = numFmt;
        dr2.getCell(5).numFmt = numFmt;
        dr2.getCell(4).alignment = { horizontal: "right" };
        dr2.getCell(5).alignment = { horizontal: "right" };
      });

      // Totals row
      const totRow = sheet.addRow(["", "", "TOTAL", totalDr, totalCr]);
      totRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
      });
      totRow.getCell(4).numFmt = numFmt;
      totRow.getCell(5).numFmt = numFmt;
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(5).alignment = { horizontal: "right" };

      // Closing balance row
      const closingDr = closingBalanceSide === "Dr" ? closingBalance : null;
      const closingCr = closingBalanceSide === "Cr" ? closingBalance : null;
      const cbRow = sheet.addRow(["", "", "Closing Balance", closingDr, closingCr]);
      cbRow.eachCell((cell) => {
        cell.fill = lightBlueFill;
        cell.font = { bold: true };
        cell.border = allBorders;
      });
      cbRow.getCell(4).numFmt = numFmt;
      cbRow.getCell(5).numFmt = numFmt;
      cbRow.getCell(4).alignment = { horizontal: "right" };
      cbRow.getCell(5).alignment = { horizontal: "right" };

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${(customer.legalName || "customer").replace(/\s+/g, "_")}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting customer statement Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // CUSTOMER PROFORMAS CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = req.query.customerId ? parseInt(req.query.customerId) : null;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });

      const proformas = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, customerId)))
        .orderBy(desc(customerProformas.createdAt));

      const proformaIds = proformas.map((p: any) => p.id);
      let lines: any[] = [];
      if (proformaIds.length > 0) {
        lines = await db.select().from(customerProformaLines).where(inArray(customerProformaLines.proformaId, proformaIds));
      }

      // Enrich lines with weightPerBaleKg and correct productName from factoryBaleProducts
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      let weightMap = new Map<string, string>();
      let nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const baleProds = await db.select({ articleCode: factoryBaleProducts.articleCode, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes as string[])));
        baleProds.forEach((p: any) => {
          if (p.articleCode) {
            weightMap.set(p.articleCode, p.weightPerBaleKg || "0");
            if (p.name) nameMap.set(p.articleCode, p.name);
          }
        });
      }

      const enrichedLines = lines.map((l: any) => ({
        ...l,
        weightPerBaleKg: weightMap.get(l.articleCode) || "0",
        productName: nameMap.get(l.articleCode) || l.productName,
      }));

      const result = proformas.map((p: any) => ({
        ...p,
        lines: enrichedLines.filter((l: any) => l.proformaId === p.id),
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching customer proformas:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerProformaSchema.parse({ ...req.body, companyId });

      const [duplicate] = await db.select({ id: customerProformas.id }).from(customerProformas)
        .where(and(
          eq(customerProformas.companyId, companyId),
          eq(customerProformas.customerId, parsed.customerId),
          eq(customerProformas.name, parsed.name)
        ));
      if (duplicate) {
        return res.status(409).json({ message: `A proforma named "${parsed.name}" already exists for this customer. Please choose a different name.` });
      }

      const [proforma] = await db.insert(customerProformas).values(parsed).returning();
      res.json(proforma);
    } catch (error: any) {
      console.error("Error creating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Proforma not found" });

      if (req.body.name && req.body.name !== existing.name) {
        const [duplicate] = await db.select({ id: customerProformas.id }).from(customerProformas)
          .where(and(
            eq(customerProformas.companyId, companyId),
            eq(customerProformas.customerId, existing.customerId),
            eq(customerProformas.name, req.body.name)
          ));
        if (duplicate) {
          return res.status(409).json({ message: `A proforma named "${req.body.name}" already exists for this customer. Please choose a different name.` });
        }
      }

      const [updated] = await db.update(customerProformas)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      // Fetch proforma before deleting so we can log which customer it belongs to
      const [proformaBefore] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (proformaBefore) {
        const [custBefore] = await db.select({ id: customers.id, legalName: customers.legalName, deletedAt: customers.deletedAt })
          .from(customers).where(eq(customers.id, proformaBefore.customerId));
        console.log(`[PROFORMA DELETE] Deleting proforma id=${id} name="${proformaBefore.name}" customerId=${proformaBefore.customerId} customerName="${custBefore?.legalName}" customerDeletedAt=${custBefore?.deletedAt}`);
      }

      await db.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      const [deleted] = await db.delete(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Proforma not found" });

      // Verify customer still exists after proforma deletion
      if (proformaBefore) {
        const [custAfter] = await db.select({ id: customers.id, legalName: customers.legalName, deletedAt: customers.deletedAt })
          .from(customers).where(eq(customers.id, proformaBefore.customerId));
        console.log(`[PROFORMA DELETE] After deletion: customerId=${proformaBefore.customerId} customerName="${custAfter?.legalName}" customerDeletedAt=${custAfter?.deletedAt}`);
      }

      res.json({ message: "Proforma deleted" });
    } catch (error: any) {
      console.error("Error deleting customer proforma:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Create a pending loading from a proforma — auto-adds matching bales from stock
  app.post("/api/factory/customer-proformas/:id/create-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const proformaId = parseInt(req.params.id);
      const { locationId, orderDate } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      // Fetch the proforma (validate ownership via customerId join)
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      // Fetch proforma lines
      const lines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaId));

      // Create the LOADING order
      const [order] = await db.insert(customerOrders).values({
        companyId,
        customerId: proforma.customerId,
        proformaIdUsed: proformaId,
        locationId: parseInt(locationId),
        orderDate: orderDate || new Date().toISOString().split('T')[0],
        status: "LOADING",
        loadingStartedAt: new Date(),
      }).returning();

      // For each proforma line, grab available bales from stock at the location
      // Pre-fetch product names for all article codes in this proforma
      const proformaArticleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const proformaProductNameMap = new Map<string, string>();
      if (proformaArticleCodes.length > 0) {
        const proformaProducts = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            inArray(factoryBaleProducts.articleCode, proformaArticleCodes)
          ));
        for (const p of proformaProducts) {
          if (p.articleCode) proformaProductNameMap.set(p.articleCode, p.name);
        }
      }

      let totalBalesAdded = 0;
      for (const line of lines) {
        if (!line.articleCode) continue;
        const qty = line.quantity || 0;
        if (qty <= 0) continue;

        // Find available bales at this location with matching articleCode
        const available = await db.select().from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK")),
            eq(factoryBales.erpLocationId, parseInt(locationId)),
            eq(factoryBales.articleCode, line.articleCode),
          ))
          .orderBy(factoryBales.id)
          .limit(qty);

        for (const bale of available) {
          const resolvedBaleName = proformaProductNameMap.get(bale.articleCode || "") || bale.productName || bale.articleCode || bale.baleCode;
          await db.insert(customerOrderBales).values({
            orderId: order.id,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parseInt(locationId),
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: resolvedBaleName,
            priceUsed: line.pricePerBale,
          });
          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
          totalBalesAdded++;
        }
      }

      await recalculateOrderTotals(db, order.id);

      const [loadingCustomer] = await db.select({ legalName: customers.legalName })
        .from(customers).where(eq(customers.id, proforma.customerId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: orderDate || new Date().toISOString().split('T')[0],
        txType: "LOADING_CREATED",
        referenceId: order.id,
        description: `Loading created from proforma "${proforma.name}" for ${loadingCustomer?.legalName || "customer"} — ${totalBalesAdded} bale(s) added`,
      });

      res.json({ order, balesAdded: totalBalesAdded });
    } catch (error: any) {
      console.error("Error creating loading from proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proforma-lines", requireAuth, async (req: any, res: any) => {
    try {
      const parsed = insertCustomerProformaLineSchema.parse(req.body);

      const [existingLine] = await db.select().from(customerProformaLines)
        .where(and(eq(customerProformaLines.proformaId, parsed.proformaId), eq(customerProformaLines.articleCode, parsed.articleCode)));
      if (existingLine) return res.status(400).json({ message: "Article code already exists in this proforma" });

      const [line] = await db.insert(customerProformaLines).values(parsed).returning();
      res.json(line);
    } catch (error: any) {
      console.error("Error creating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const updateData: any = {};
      if (req.body.productName !== undefined) updateData.productName = req.body.productName;
      if (req.body.quantity !== undefined) updateData.quantity = parseInt(req.body.quantity);
      if (req.body.pricePerBale !== undefined) updateData.pricePerBale = req.body.pricePerBale;

      const [updated] = await db.update(customerProformaLines).set(updateData)
        .where(eq(customerProformaLines.id, id)).returning();

      if (!updated) return res.status(404).json({ message: "Proforma line not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const [deleted] = await db.delete(customerProformaLines).where(eq(customerProformaLines.id, id)).returning();
      if (!deleted) return res.status(404).json({ message: "Proforma line not found" });
      res.json({ message: "Proforma line deleted" });
    } catch (error: any) {
      console.error("Error deleting proforma line:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas/bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, name, isActive, lines } = req.body;
      if (!customerId || !name || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: `customerId, name, and at least one line are required. Got: customerId=${customerId}, name=${name}, lines=${Array.isArray(lines) ? lines.length : 'not array'}` });
      }

      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res.status(400).json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const parsed = insertCustomerProformaSchema.parse({ companyId, customerId, name, isActive: isActive || false });

      const result = await db.transaction(async (tx: any) => {
        const [proforma] = await tx.insert(customerProformas).values(parsed).returning();

        const lineValues = validLines.map((l: any) => ({
          proformaId: proforma.id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale || "0"),
        }));

        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();

        return { ...proforma, lines: insertedLines };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error bulk creating proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id/replace-lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const { lines } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "At least one line is required" });
      }

      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res.status(400).json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const result = await db.transaction(async (tx: any) => {
        await tx.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
        const lineValues = validLines.map((l: any) => ({
          proformaId: id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale || "0"),
        }));
        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();
        return { ...proforma, lines: insertedLines };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error replacing proforma lines:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas/:id/apply-catalog-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const lines = await db.select().from(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      if (!lines.length) return res.json({ updated: 0, skipped: 0 });

      const products = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const priceByArticleCode = new Map<string, string>();
      for (const p of products) {
        if (p.articleCode && p.sellingPrice && parseFloat(String(p.sellingPrice)) > 0) {
          priceByArticleCode.set(p.articleCode.toLowerCase(), String(p.sellingPrice));
        }
      }

      let updated = 0;
      let skipped = 0;
      let fixed = 0;
      for (const line of lines) {
        if ((line as any).priceFixed) { fixed++; continue; }
        const newPrice = priceByArticleCode.get((line.articleCode || "").toLowerCase());
        if (newPrice) {
          await db.update(customerProformaLines)
            .set({ pricePerBale: newPrice })
            .where(eq(customerProformaLines.id, line.id));
          updated++;
        } else {
          skipped++;
        }
      }

      res.json({ updated, skipped, fixed });
    } catch (error: any) {
      console.error("Error applying catalog prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle price_fixed flag on a proforma line
  app.patch("/api/factory/customer-proforma-lines/:lineId/toggle-fixed", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const lineId = parseInt(req.params.lineId);
      const [line] = await db.select().from(customerProformaLines).where(eq(customerProformaLines.id, lineId)).limit(1);
      if (!line) return res.status(404).json({ message: "Line not found" });
      const [updated] = await db.update(customerProformaLines)
        .set({ priceFixed: !(line as any).priceFixed })
        .where(eq(customerProformaLines.id, lineId))
        .returning();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Stock Allocation endpoints ─────────────────────────────────────────────

  // GET /api/factory/stock-allocation — returns all article codes with IN_STOCK bale counts,
  // all proformas with their lines, existing reservations, and LOADING/PENDING_VERIFICATION/VERIFIED order quantities
  app.get("/api/factory/stock-allocation", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // 1. All proformas for this company
      const allProformas = await db.select({
        id: customerProformas.id,
        companyId: customerProformas.companyId,
        customerId: customerProformas.customerId,
        name: customerProformas.name,
        isActive: customerProformas.isActive,
        createdAt: customerProformas.createdAt,
      }).from(customerProformas)
        .where(eq(customerProformas.companyId, companyId))
        .orderBy(customerProformas.createdAt);

      const proformaIds = allProformas.map((p: any) => p.id);
      let allLines: any[] = [];
      if (proformaIds.length > 0) {
        allLines = await db.select({
          id: customerProformaLines.id,
          proformaId: customerProformaLines.proformaId,
          articleCode: customerProformaLines.articleCode,
          productName: customerProformaLines.productName,
          quantity: customerProformaLines.quantity,
          pricePerBale: customerProformaLines.pricePerBale,
        }).from(customerProformaLines)
          .where(inArray(customerProformaLines.proformaId, proformaIds));
      }

      // 2. IN_STOCK bale counts grouped by articleCode
      const inStockCountsRaw = await db.execute(
        sql`SELECT article_code as "articleCode", COUNT(*)::int as count FROM factory_bales WHERE company_id = ${companyId} AND status = 'IN_STOCK' GROUP BY article_code`
      );
      const inStockCounts = (inStockCountsRaw.rows || inStockCountsRaw as any[]).map((r: any) => ({
        articleCode: r.articleCode,
        count: Number(r.count),
      }));

      // 3. Existing reservations for this company
      const reservations = await db.select({
        id: proformaStockReservations.id,
        companyId: proformaStockReservations.companyId,
        proformaId: proformaStockReservations.proformaId,
        articleCode: proformaStockReservations.articleCode,
      }).from(proformaStockReservations)
        .where(eq(proformaStockReservations.companyId, companyId));

      // 4. Active orders (LOADING, PENDING_VERIFICATION, VERIFIED)
      const activeOrdersRaw = await db.execute(
        sql`SELECT id, proforma_id_used as "proformaIdUsed", status FROM customer_orders WHERE company_id = ${companyId} AND status IN ('LOADING','PENDING_VERIFICATION','VERIFIED')`
      );
      const activeOrders = (activeOrdersRaw.rows || activeOrdersRaw as any[]).map((o: any) => ({
        id: o.id,
        proformaIdUsed: o.proformaIdUsed,
        status: o.status,
      }));

      // For active orders, get bale article code counts from customer_order_bales
      let activeOrderBales: any[] = [];
      if (activeOrders.length > 0) {
        const orderIds = activeOrders.map((o: any) => o.id);
        const activeOrderBalesRaw = await db.execute(
          sql`SELECT order_id as "orderId", article_code as "articleCode", COUNT(*)::int as count FROM customer_order_bales WHERE order_id = ANY(${sql.raw(`ARRAY[${orderIds.join(',')}]`)}) GROUP BY order_id, article_code`
        );
        activeOrderBales = (activeOrderBalesRaw.rows || activeOrderBalesRaw as any[]).map((b: any) => ({
          orderId: b.orderId,
          articleCode: b.articleCode,
          count: Number(b.count),
        }));
      }

      // 5. Customers lookup — use legalName (the customers table has no "name" column)
      const allCustomerIds = [...new Set(allProformas.map((p: any) => p.customerId))].filter((id): id is number => id != null && !isNaN(Number(id)));
      let customerRows: any[] = [];
      if (allCustomerIds.length > 0) {
        customerRows = await db.select({ id: customers.id, legalName: customers.legalName })
          .from(customers)
          .where(inArray(customers.id, allCustomerIds));
      }
      const customerMap = new Map(customerRows.map((c: any) => [c.id, c.legalName]));

      res.json({
        proformas: allProformas.map((p: any) => ({
          id: p.id,
          companyId: p.companyId,
          customerId: p.customerId,
          name: p.name,
          isActive: p.isActive,
          createdAt: p.createdAt,
          customerName: customerMap.get(p.customerId) || `Customer #${p.customerId}`,
          lines: allLines.filter((l: any) => l.proformaId === p.id),
        })),
        inStockCounts,
        reservations,
        activeOrders: activeOrders.map((o: any) => ({
          id: o.id,
          proformaIdUsed: o.proformaIdUsed,
          status: o.status,
          balesByArticle: activeOrderBales
            .filter((b: any) => b.orderId === o.id)
            .map((b: any) => ({ articleCode: b.articleCode, count: b.count })),
        })),
      });
    } catch (error: any) {
      console.error("Error fetching stock allocation:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/stock-allocation/reservations/toggle — toggle a reservation on/off
  app.post("/api/factory/stock-allocation/reservations/toggle", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { proformaId, articleCode } = req.body;
      if (!proformaId || !articleCode) return res.status(400).json({ message: "proformaId and articleCode required" });

      // Check if reservation exists
      const [existing] = await db.select().from(proformaStockReservations)
        .where(and(
          eq(proformaStockReservations.companyId, companyId),
          eq(proformaStockReservations.proformaId, proformaId),
          eq(proformaStockReservations.articleCode, articleCode),
        )).limit(1);

      if (existing) {
        await db.delete(proformaStockReservations)
          .where(eq(proformaStockReservations.id, existing.id));
        res.json({ reserved: false });
      } else {
        await db.insert(proformaStockReservations).values({ companyId, proformaId, articleCode });
        res.json({ reserved: true });
      }
    } catch (error: any) {
      console.error("Error toggling reservation:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── End Stock Allocation ─────────────────────────────────────────────────────

  app.get("/api/factory/customer-proformas/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const rawLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, id));

      const [customer] = await db.select().from(customers).where(eq(customers.id, proforma.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).catch(() => [null]);

      // Fetch weight per bale + canonical name from factoryBaleProducts by articleCode
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const wMap = new Map<string, number>();
      const nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const prods = await db.select({ articleCode: factoryBaleProducts.articleCode, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes as string[])));
        prods.forEach((p: any) => { if (p.articleCode) { wMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0")); nameMap.set(p.articleCode, p.name || ""); } });
      }

      const baseCurrency = (company as any)?.baseCurrency || "USD";
      const currencySymbolMap: Record<string, string> = {
        USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", XOF: "CFA ", XAF: "CFA ",
        CAD: "CA$ ", AUD: "A$ ", CHF: "CHF ", JPY: "¥", INR: "₹", AED: "AED ",
        MXN: "MX$ ", BRL: "R$ ", ZAR: "R", SGD: "S$ ", HKD: "HK$ ", NOK: "kr ", SEK: "kr ", DKK: "kr ",
      };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? (baseCurrency + " ");
      const fmtPrice = (n: number) => currSym + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
      const fmtKg = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Proforma Invoice");

      const COL_COUNT = 8;
      sheet.columns = [
        { key: "num", width: 6 },
        { key: "articleCode", width: 18 },
        { key: "productName", width: 32 },
        { key: "qty", width: 12 },
        { key: "kgPerBale", width: 13 },
        { key: "pricePerBale", width: 14 },
        { key: "totalKg", width: 13 },
        { key: "totalPrice", width: 15 },
      ];

      try {
        const pxLogo = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(pxLogo)) {
          const pxBuf = fs.readFileSync(pxLogo);
          const pxId = workbook.addImage({ buffer: pxBuf as Buffer, extension: "jpeg" });
          const pxLogoRow = sheet.addRow([]); pxLogoRow.height = 90;
          sheet.addImage(pxId, { tl: { col: 2.5, row: 0 }, ext: { width: 300, height: 90 } });
        }
      } catch {}
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F3864" } };
      r1.getCell(1).alignment = { horizontal: "center" };
      sheet.mergeCells(r1.number, 1, r1.number, COL_COUNT);

      const r2 = sheet.addRow([`Customer: ${customer?.legalName || "N/A"}`]);
      r2.getCell(1).font = { size: 11 };
      sheet.mergeCells(r2.number, 1, r2.number, COL_COUNT);

      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      const r3 = sheet.addRow([`Date: ${dateStr}`]);
      r3.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
      sheet.mergeCells(r3.number, 1, r3.number, COL_COUNT);

      const r4 = sheet.addRow([`Proforma: ${proforma.name}`]);
      r4.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
      sheet.mergeCells(r4.number, 1, r4.number, COL_COUNT);

      sheet.addRow([]);

      const hdrRow = sheet.addRow(["#", "Article Code", "Product Name", "Qty (Bales)", "Kg / Bale", "Price / Bale", "Total KG", "Total Price"]);
      hdrRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        cell.alignment = { horizontal: "center" };
      });

      let totalQty = 0, totalKgAll = 0, totalPriceAll = 0;
      rawLines.forEach((line: any, idx: number) => {
        const qty = parseInt(String(line.quantity));
        const kgPerBale = wMap.get(line.articleCode) || 0;
        const price = parseFloat(String(line.pricePerBale));
        const totalKg = qty * kgPerBale;
        const totalPrice = qty * price;
        totalQty += qty;
        totalKgAll += totalKg;
        totalPriceAll += totalPrice;

        const dr = sheet.addRow([idx + 1, line.articleCode, nameMap.get(line.articleCode) || line.productName || "", qty, fmtKg(kgPerBale), fmtPrice(price), fmtKg(totalKg), fmtPrice(totalPrice)]);
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(6).alignment = { horizontal: "right" };
        dr.getCell(7).alignment = { horizontal: "right" };
        dr.getCell(8).alignment = { horizontal: "right" };
        if (idx % 2 === 1) {
          dr.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } }; });
        }
      });

      sheet.addRow([]);
      const totRow = sheet.addRow(["", "", "GRAND TOTAL", totalQty, "", "", fmtKg(totalKgAll), fmtPrice(totalPriceAll)]);
      totRow.eachCell((cell) => { cell.font = { bold: true }; });
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(7).alignment = { horizontal: "right" };
      totRow.getCell(8).alignment = { horizontal: "right" };

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=proforma_${proforma.name.replace(/\s+/g, "_")}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting proforma to Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-proformas/:id/export/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const rawLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, id));

      const [customer] = await db.select().from(customers).where(eq(customers.id, proforma.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).catch(() => [null]);

      // Fetch weight per bale + canonical name from factoryBaleProducts by articleCode
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const wMap = new Map<string, number>();
      const nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const prods = await db.select({ articleCode: factoryBaleProducts.articleCode, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes as string[])));
        prods.forEach((p: any) => { if (p.articleCode) { wMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0")); nameMap.set(p.articleCode, p.name || ""); } });
      }

      const baseCurrencyPdf = (company as any)?.baseCurrency || "USD";
      const currencySymbolMapPdf: Record<string, string> = {
        USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", XOF: "CFA ", XAF: "CFA ",
        CAD: "CA$ ", AUD: "A$ ", CHF: "CHF ", JPY: "¥", INR: "₹", AED: "AED ",
        MXN: "MX$ ", BRL: "R$ ", ZAR: "R", SGD: "S$ ", HKD: "HK$ ", NOK: "kr ", SEK: "kr ", DKK: "kr ",
      };
      const currSymPdf = currencySymbolMapPdf[baseCurrencyPdf.toUpperCase()] ?? (baseCurrencyPdf + " ");
      const fmtPricePdf = (n: number) => currSymPdf + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
      const fmtKgPdf = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);

      const PDFDocument = (await import("pdfkit")).default;
      const fs = await import("fs");

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=proforma_${proforma.name.replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      // ── Header ──
      const hmdProformaLogo = path.join(process.cwd(), "server", "hmd-logo.png");
      const headerY = 40;

      const logoW = 220;
      if (fs.existsSync(hmdProformaLogo)) {
        try { doc.image(hmdProformaLogo, (doc.page.width - logoW) / 2, headerY, { width: logoW }); } catch {}
      }
      // Title goes below the logo — use doc.y which pdfkit advances after placing the image
      const titleY = Math.max(doc.y, headerY + 10) + 6;
      doc.fontSize(10).font("Helvetica").fillColor("#555555")
        .text("PROFORMA INVOICE", 40, titleY, { width: 515, align: "center" });

      const headerBottom = doc.y + 4;
      doc.moveTo(40, headerBottom + 4).lineTo(555, headerBottom + 4).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.lineWidth(1).strokeColor("#000000");

      // ── Meta info ──
      const metaY = headerBottom + 12;
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      doc.fillColor("#000000").fontSize(10).font("Helvetica");
      doc.text(`Customer:`, 40, metaY, { continued: true }).font("Helvetica-Bold").text(` ${customer?.legalName || "N/A"}`);
      doc.font("Helvetica").text(`Proforma:`, 40, doc.y + 2, { continued: true }).font("Helvetica-Bold").text(` ${proforma.name}`);
      doc.font("Helvetica").text(`Date:`, 40, doc.y + 2, { continued: true }).font("Helvetica-Bold").text(` ${dateStr}`);

      doc.moveDown(1);

      // ── Table ──
      // Columns: # | Article Code | Product Name | Qty | Kg/Bale | Price/Bale | Total KG | Total Price
      // x positions (left edge), total usable width = 515 (40..555)
      const colX  = [40,  62,  132, 310, 355, 403, 455, 508];
      const colW  = [22,  70,  178,  45,  48,  52,  53,  47];
      const colHdr= ["#","Code","Product Name","Qty","Kg/Bale","Pr/Bale","Total KG","Total Price"];
      const colAlign: Array<"left"|"right"|"center"> = ["center","center","center","center","center","center","center","center"];

      const tableTop = doc.y + 4;

      // Header row background
      doc.rect(40, tableTop, 515, 14).fill("#1F3864");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      let y = tableTop + 16;
      let totalQty = 0, totalKgAll = 0, totalPriceAll = 0;

      rawLines.forEach((line: any, idx: number) => {
        const qty = parseInt(String(line.quantity));
        const kgPerBale = wMap.get(line.articleCode) || 0;
        const price = parseFloat(String(line.pricePerBale));
        const totalKg = qty * kgPerBale;
        const totalPrice = qty * price;
        totalQty += qty;
        totalKgAll += totalKg;
        totalPriceAll += totalPrice;

        if (y > 770) {
          doc.addPage();
          y = 40;
        }

        const rowH = 14;
        if (idx % 2 === 1) {
          doc.rect(40, y, 515, rowH).fill("#F8F8F8");
          doc.fillColor("#000000");
        }

        const vals = [String(idx + 1), line.articleCode, nameMap.get(line.articleCode) || line.productName || "", String(qty), fmtKgPdf(kgPerBale), fmtPricePdf(price), fmtKgPdf(totalKg), fmtPricePdf(totalPrice)];
        vals.forEach((v, i) => {
          doc.text(v, colX[i] + 2, y + 3, { width: colW[i] - 4, align: colAlign[i] });
        });
        y += rowH;
      });

      // Separator line
      y += 2;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 6;
      doc.lineWidth(1).strokeColor("#000000");

      // Grand total row
      doc.rect(40, y, 515, 16).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      const totVals = ["", "", "GRAND TOTAL", String(totalQty), "", "", fmtKgPdf(totalKgAll), fmtPricePdf(totalPriceAll)];
      totVals.forEach((v, i) => {
        if (v) doc.text(v, colX[i] + 2, y + 4, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.end();
    } catch (error: any) {
      console.error("Error exporting proforma to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CUSTOMER ORDERS CRUD + FINALIZE
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(customerOrders.companyId, companyId)];
      if (req.query.customerId) conditions.push(eq(customerOrders.customerId, parseInt(req.query.customerId)));
      if (req.query.status) conditions.push(eq(customerOrders.status, req.query.status));
      if (req.query.proformaId) conditions.push(eq(customerOrders.proformaIdUsed, parseInt(req.query.proformaId)));

      const orders = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          proformaName: customerProformas.name,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          totalWeightKg: sql<string>`COALESCE((SELECT SUM(cob.weight) FROM customer_order_bales cob WHERE cob.order_id = ${customerOrders.id}), 0)`,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          locationId: customerOrders.locationId,
          loadingStartedAt: customerOrders.loadingStartedAt,
          loadingFinalizedAt: customerOrders.loadingFinalizedAt,
          verifiedAt: customerOrders.verifiedAt,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .leftJoin(customerProformas, eq(customerOrders.proformaIdUsed, customerProformas.id))
        .where(and(...conditions))
        .orderBy(desc(customerOrders.createdAt));

      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching customer orders:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [order] = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          containerNotes: customerOrders.containerNotes,
          verifiedByUserId: customerOrders.verifiedByUserId,
          verifiedAt: customerOrders.verifiedAt,
          loadingStartedAt: customerOrders.loadingStartedAt,
          loadingFinalizedAt: customerOrders.loadingFinalizedAt,
          locationId: customerOrders.locationId,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, id));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, id));

      res.json({ ...order, lines, bales, charges });
    } catch (error: any) {
      console.error("Error fetching customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/profitability", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [order] = await db
        .select({ id: customerOrders.id, status: customerOrders.status, invoiceNumber: customerOrders.invoiceNumber, customerName: customers.legalName })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const articleCodes = lines.map((l: any) => l.articleCode).filter(Boolean);

      const products = articleCodes.length > 0
        ? await db.select({
            articleCode: factoryBaleProducts.articleCode,
            productionPrice: factoryBaleProducts.productionPrice,
            name: factoryBaleProducts.name,
          }).from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes)))
        : [];

      const productMap: Record<string, { productionPrice: string | null; name: string }> = {};
      for (const p of products) {
        if (p.articleCode) productMap[p.articleCode] = { productionPrice: p.productionPrice, name: p.name };
      }

      let totalSelling = 0;
      let totalCost = 0;
      let totalCostKnown = true;

      const profitLines = lines.map((line: any) => {
        const qty = Number(line.qty || 0);
        const selling = parseFloat(line.totalPrice || "0");
        const product = line.articleCode ? productMap[line.articleCode] : null;
        const hasCost = product !== null && product.productionPrice !== null;
        const costPerBale = hasCost ? parseFloat(product!.productionPrice!) : 0;
        const cost = hasCost ? costPerBale * qty : 0;
        const profit = hasCost ? selling - cost : null;
        const profitPctOnCost = hasCost && cost !== 0 ? ((selling - cost) / cost) * 100 : null;
        const marginPct = hasCost && selling !== 0 ? ((selling - cost) / selling) * 100 : null;

        totalSelling += selling;
        if (hasCost) {
          totalCost += cost;
        } else {
          totalCostKnown = false;
        }

        return {
          articleCode: line.articleCode,
          baleName: line.baleName,
          qty,
          selling,
          costPerBale,
          cost,
          profit,
          profitPctOnCost,
          marginPct,
          missingCost: !hasCost,
          pricePerBale: parseFloat(line.pricePerBale || "0"),
        };
      });

      const totalProfit = totalCostKnown ? totalSelling - totalCost : null;
      const totalProfitPctOnCost = totalCostKnown && totalCost !== 0 ? ((totalSelling - totalCost) / totalCost) * 100 : null;
      const totalMarginPct = totalCostKnown && totalSelling !== 0 ? ((totalSelling - totalCost) / totalSelling) * 100 : null;

      res.json({
        orderId: id,
        invoiceNumber: order.invoiceNumber,
        customerName: order.customerName,
        lines: profitLines,
        totalSelling,
        totalCost: totalCostKnown ? totalCost : null,
        totalProfit,
        totalProfitPctOnCost,
        totalMarginPct,
        partialCostData: !totalCostKnown,
      });
    } catch (error: any) {
      console.error("Error fetching order profitability:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerOrderSchema.parse({ ...req.body, companyId, status: "DRAFT" });
      const [order] = await db.insert(customerOrders).values(parsed).returning();
      res.json(order);
    } catch (error: any) {
      console.error("Error creating customer order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { scanCode, locationId } = req.body;
      if (!scanCode || !locationId) return res.status(400).json({ message: "scanCode and locationId are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) return res.status(400).json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });

      // Check if this scan code matches a bale already reserved (status = RESERVED_FOR_ORDER).
      // Only match by unique bale identifiers (referenceNumber, baleCode) — NOT by articleCode or
      // productName, which are shared across many bales and would falsely block scanning the next
      // available bale of the same product type.
      const scanLower = scanCode.toLowerCase();
      const [reservedBale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "RESERVED_FOR_ORDER"),
          or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`
          )
        ));

      if (reservedBale) {
        const [inThisOrder] = await db.select().from(customerOrderBales)
          .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, reservedBale.id)));
        if (inThisOrder) {
          return res.status(400).json({ message: `${reservedBale.referenceNumber || scanCode} is already loaded in this order` });
        }
        return res.status(400).json({ message: `Bale ${reservedBale.referenceNumber || scanCode} is reserved for another loading order` });
      }

      // Also look up product IDs whose current name or articleCode matches the scan code
      const matchingProductsByName = await db
        .select({ id: factoryBaleProducts.id })
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          or(
            sql`LOWER(${factoryBaleProducts.name}) = ${scanLower}`,
            ilike(factoryBaleProducts.name, `%${scanCode.trim()}%`),
            sql`LOWER(${factoryBaleProducts.articleCode}) = ${scanLower}`,
            ilike(factoryBaleProducts.articleCode, `%${scanCode.trim()}%`)
          )
        ));
      const matchingProductIds = matchingProductsByName.map((p: any) => p.id);

      const nameConditions = matchingProductIds.length > 0
        ? or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.articleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.productName}) = ${scanLower}`,
            inArray(factoryBales.productId, matchingProductIds)
          )
        : or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.articleCode}) = ${scanLower}`,
            sql`LOWER(${factoryBales.productName}) = ${scanLower}`
          );

      const [bale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK")),
          eq(factoryBales.erpLocationId, parseInt(locationId)),
          nameConditions
        ))
        .orderBy(factoryBales.id)
        .limit(1);

      if (!bale) return res.status(404).json({ message: "Bale not found, not at this location, or not available for sale" });

      const [alreadyAdded] = await db.select().from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, bale.id)));
      if (alreadyAdded) return res.status(400).json({ message: "Bale already added to this order" });

      let priceUsed = "0";
      let proformaLine: any = null;
      if (order.proformaIdUsed) {
        const [pl] = await db.select().from(customerProformaLines)
          .where(and(
            eq(customerProformaLines.proformaId, order.proformaIdUsed),
            eq(customerProformaLines.articleCode, bale.articleCode || "")
          ));
        proformaLine = pl || null;
        if (proformaLine) {
          priceUsed = proformaLine.pricePerBale;
          // Overload check: count existing bales of this article in the order
          if (!req.body.allowBypassOverload) {
            const [countResult] = await db
              .select({ count: sql<number>`COUNT(*)::int` })
              .from(customerOrderBales)
              .where(and(
                eq(customerOrderBales.orderId, orderId),
                eq(customerOrderBales.articleCode, bale.articleCode || "")
              ));
            const currentCount = countResult?.count || 0;
            if (currentCount >= proformaLine.quantity) {
              return res.status(400).json({
                overloaded: true,
                message: `Quantity exceeded (${currentCount}/${proformaLine.quantity}). Scan again to bypass.`,
              });
            }
          }
        } else if (!req.body.allowBypassProforma) {
          return res.status(400).json({
            notInProforma: true,
            message: "Item loaded not requested. Please scan again to bypass.",
          });
        }
      }

      let productForBale: any = null;
      if (bale.productId) {
        const [p] = await db.select().from(factoryBaleProducts)
          .where(eq(factoryBaleProducts.id, bale.productId));
        productForBale = p || null;
        if (productForBale && priceUsed === "0" && productForBale.sellingPrice) {
          priceUsed = productForBale.sellingPrice;
        }
      }

      // Always prefer the canonical product name from factoryBaleProducts
      const resolvedBaleName = productForBale?.name || bale.productName || bale.articleCode || bale.baleCode;

      await db.insert(customerOrderBales).values({
        orderId,
        baleId: bale.id,
        baleReference: bale.referenceNumber,
        locationId: parseInt(locationId),
        weight: bale.weightKg,
        articleCode: bale.articleCode,
        baleName: resolvedBaleName,
        priceUsed,
      });

      await db.update(factoryBales).set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() }).where(eq(factoryBales.id, bale.id));

      await recalculateOrderTotals(db, orderId);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding bale to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/bales/bulk-import", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { locationId, items, refNumbers: refNumbersRaw } = req.body;
      const hasRefNumbers = Array.isArray(refNumbersRaw) && refNumbersRaw.length > 0;
      const hasItems = Array.isArray(items) && items.length > 0;
      if (!locationId || (!hasItems && !hasRefNumbers)) {
        return res.status(400).json({ message: "locationId and either items or refNumbers are required" });
      }

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) {
        return res.status(400).json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });
      }

      const parsedLocationId = parseInt(locationId);

      // Get all products for this company for matching
      const allProducts = await db.select().from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId));

      // Get bales already in this order
      const existingOrderBales = await db.select({ baleId: customerOrderBales.baleId })
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId));
      const alreadyAddedBaleIds = new Set(existingOrderBales.map((b: any) => b.baleId));

      let totalAdded = 0;
      const notFound: Array<{ articleCode: string; requestedQty: number; foundQty: number }> = [];
      const notFoundRefs: string[] = [];

      // ── REF-NUMBER / REF-CODE MODE ──────────────────────────────────────────
      if (hasRefNumbers) {
        const refNumbers = refNumbersRaw as string[];
        for (const rawRef of refNumbers) {
          const refNum = String(rawRef).trim();
          if (!refNum) continue;

          // Try referenceNumber first, then fall back to baleCode
          let [bale] = await db.select().from(factoryBales)
            .where(and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.referenceNumber, refNum),
              or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK"))
            ));

          if (!bale) {
            [bale] = await db.select().from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.baleCode, refNum),
                or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK"))
              ));
          }

          if (!bale) { notFoundRefs.push(refNum); continue; }
          if (alreadyAddedBaleIds.has(bale.id)) continue;

          let priceUsed = "0";
          if (order.proformaIdUsed) {
            const [pl] = await db.select().from(customerProformaLines)
              .where(and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed),
                eq(customerProformaLines.articleCode, bale.articleCode || "")
              ));
            if (pl) priceUsed = pl.pricePerBale;
          }
          if (priceUsed === "0" && bale.productId) {
            const product = allProducts.find((p: any) => p.id === bale.productId);
            if (product?.sellingPrice) priceUsed = product.sellingPrice;
          }

          const baleProductForName1 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

          await db.insert(customerOrderBales).values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: bale.erpLocationId ?? parsedLocationId,
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: baleProductForName1?.name || bale.productName || bale.articleCode || bale.baleCode,
            priceUsed,
          });

          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));

          alreadyAddedBaleIds.add(bale.id);
          totalAdded++;
        }

        await recalculateOrderTotals(db, orderId);
        const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
        return res.json({ added: totalAdded, notFound: [], notFoundRefs, order: updatedOrder, bales: updatedBales });
      }

      // ── ARTICLE-CODE MODE (existing) ────────────────────────────────────────
      for (const item of items) {
        const articleCode = String(item.articleCode || "").trim();
        const qty = parseInt(item.qty) || 0;
        if (!articleCode || qty <= 0) continue;

        const codeLower = articleCode.toLowerCase();

        // Find matching product IDs (by articleCode or name)
        const matchingProductIds = allProducts
          .filter(p =>
            (p.articleCode && p.articleCode.toLowerCase() === codeLower) ||
            (p.name && p.name.toLowerCase() === codeLower)
          )
          .map(p => p.id);

        // Build bale query conditions
        const matchConditions = matchingProductIds.length > 0
          ? or(
              sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`,
              inArray(factoryBales.productId, matchingProductIds)
            )
          : sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`;

        // Find available bales, oldest first
        const availableBales = await db.select().from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK")),
            eq(factoryBales.erpLocationId, parsedLocationId),
            matchConditions
          ))
          .orderBy(factoryBales.createdAt)
          .limit(qty * 5);

        // Filter out bales already in this order or reserved for another order
        const candidateBales = availableBales.filter((b: any) => !alreadyAddedBaleIds.has(b.id));
        const balesToAdd = candidateBales.slice(0, qty);

        if (balesToAdd.length < qty) {
          notFound.push({ articleCode, requestedQty: qty, foundQty: balesToAdd.length });
        }

        for (const bale of balesToAdd) {
          // Determine price
          let priceUsed = "0";
          if (order.proformaIdUsed) {
            const [pl] = await db.select().from(customerProformaLines)
              .where(and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed),
                eq(customerProformaLines.articleCode, bale.articleCode || "")
              ));
            if (pl) priceUsed = pl.pricePerBale;
          }
          if (priceUsed === "0" && bale.productId) {
            const product = allProducts.find((p: any) => p.id === bale.productId);
            if (product?.sellingPrice) priceUsed = product.sellingPrice;
          }

          const baleProductForName2 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

          await db.insert(customerOrderBales).values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parsedLocationId,
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: baleProductForName2?.name || bale.productName || bale.articleCode || bale.baleCode,
            priceUsed,
          });

          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));

          alreadyAddedBaleIds.add(bale.id);
          totalAdded++;
        }
      }

      await recalculateOrderTotals(db, orderId);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      res.json({ added: totalAdded, notFound, order: updatedOrder, bales: updatedBales });
    } catch (error: any) {
      console.error("Error bulk importing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/bales/:baleId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const baleId = parseInt(req.params.baleId);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) return res.status(400).json({ message: "Can only remove bales from DRAFT, LOADING, or PENDING_VERIFICATION orders" });

      const [orderBale] = await db.select().from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      await db.delete(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      if (orderBale) {
        await db.update(factoryBales).set({ status: "FINALIZED", updatedAt: new Date() }).where(eq(factoryBales.id, orderBale.baleId));
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing bale from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { name, amount, chargeType, ledgerAccountId } = req.body;
      if (!name || !amount) return res.status(400).json({ message: "name and amount are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.insert(customerOrderCharges).values({
        orderId,
        name,
        amount: String(amount),
        chargeType: chargeType || "OTHER",
        ledgerAccountId: ledgerAccountId ? parseInt(ledgerAccountId) : null,
      });

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Sync customerBalances ledger entry if the order is already finalized
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [existingLedgerEntry] = await db.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          ));
        if (existingLedgerEntry) {
          await db.update(customerBalances)
            .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
            .where(eq(customerBalances.id, existingLedgerEntry.id));
        }
      }

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding charge to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/charges/:chargeId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const chargeId = parseInt(req.params.chargeId);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.delete(customerOrderCharges)
        .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Sync customerBalances ledger entry if the order is already finalized
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [existingLedgerEntry] = await db.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          ));
        if (existingLedgerEntry) {
          await db.update(customerBalances)
            .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
            .where(eq(customerBalances.id, existingLedgerEntry.id));
        }
      }

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing charge from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");

        if (order.status === "FINALIZED") {
          throw new Error("Cannot delete a finalized invoice. Cancel it first if needed.");
        }

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx.update(factoryBales).set({ status: "FINALIZED", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await tx.delete(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        await tx.delete(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
        await tx.delete(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
        await tx.delete(customerOrders).where(eq(customerOrders.id, orderId));
      });

      res.json({ success: true, message: "Invoice deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      const result = await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["DRAFT", "VERIFIED"].includes(order.status)) throw new Error("Only DRAFT or VERIFIED orders can be finalized");

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        if (bales.length === 0) throw new Error("Order has no bales");

        for (const b of bales) {
          const [factoryBale] = await tx.select().from(factoryBales)
            .where(and(eq(factoryBales.id, b.baleId), or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "RESERVED_FOR_ORDER")), eq(factoryBales.erpLocationId, b.locationId)));
          if (!factoryBale) throw new Error(`Bale ${b.baleReference} is no longer available`);
        }

        let seqRows = await tx.execute(sql`SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE`);
        let seqRow = seqRows.rows?.[0] || seqRows[0];
        if (!seqRow) {
          [seqRow] = await tx.insert(customerInvoiceSequences).values({ companyId, nextNumber: 1 }).returning();
        }
        const invoiceNum = seqRow.nextNumber || seqRow.next_number;
        await tx.update(customerInvoiceSequences).set({ nextNumber: invoiceNum + 1 }).where(eq(customerInvoiceSequences.companyId, companyId));
        const invoiceNumber = `INV-${String(invoiceNum).padStart(6, '0')}`;

        for (const b of bales) {
          await tx.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await recalculateOrderTotals(tx, orderId);

        const [recalcOrder] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId));

        await tx.update(customerOrders).set({
          invoiceNumber,
          status: "FINALIZED",
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        const grandTotal = parseFloat(recalcOrder.grandTotal || "0");
        const today = new Date().toISOString().split('T')[0];

        await tx.insert(customerBalances).values({
          companyId,
          customerId: order.customerId,
          transactionDate: today,
          transactionType: "SALE",
          debitAmount: String(grandTotal),
          creditAmount: "0",
          balance: String(grandTotal),
          referenceType: "INVOICE",
          referenceId: order.id,
          description: `Invoice ${invoiceNumber}`,
          currency: "USD",
        });

        // Create journal entries for charges that have a ledgerAccountId
        const chargesForJournal = await tx.select().from(customerOrderCharges)
          .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.ledgerAccountId} IS NOT NULL`));

        if (chargesForJournal.length > 0) {
          const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
          if (customer?.ledgerAccountId) {
            for (const charge of chargesForJournal) {
              const chargeAmount = parseFloat(charge.amount || "0");
              if (chargeAmount <= 0) continue;
              // Create a voucher for each charge
              const chargeVoucherNumber = `CHARGE-${invoiceNumber}-${charge.id}-${Date.now()}`;
              const [chargeVoucher] = await tx.insert(vouchers).values({
                companyId,
                voucherType: "Journal",
                voucherNumber: chargeVoucherNumber,
                voucherDate: today,
                description: `${charge.name} - ${invoiceNumber}`,
                totalAmount: String(chargeAmount),
                sourceModule: "FACTORY",
              }).returning();
              // Dr Customer Account (charge billed to customer)
              await tx.insert(voucherEntries).values({
                voucherId: chargeVoucher.id,
                ledgerAccountId: customer.ledgerAccountId,
                customerId: order.customerId,
                debitAmount: String(chargeAmount),
                creditAmount: "0",
                narration: `${charge.name} billed to customer - ${invoiceNumber}`,
              });
              // Cr Charge Account (freight/other charges income account)
              await tx.insert(voucherEntries).values({
                voucherId: chargeVoucher.id,
                ledgerAccountId: charge.ledgerAccountId!,
                debitAmount: "0",
                creditAmount: String(chargeAmount),
                narration: `${charge.name} - ${invoiceNumber}`,
              });
            }
          }
        }

        const [finalOrder] = await tx
          .select({
            id: customerOrders.id,
            companyId: customerOrders.companyId,
            customerId: customerOrders.customerId,
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            proformaIdUsed: customerOrders.proformaIdUsed,
            status: customerOrders.status,
            subtotalBales: customerOrders.subtotalBales,
            freightAmount: customerOrders.freightAmount,
            otherChargesTotal: customerOrders.otherChargesTotal,
            grandTotal: customerOrders.grandTotal,
            totalQtyBales: customerOrders.totalQtyBales,
            createdAt: customerOrders.createdAt,
            updatedAt: customerOrders.updatedAt,
            customerName: customers.legalName,
          })
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, orderId));

        const finalLines = await tx.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
        const finalBales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const finalCharges = await tx.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

        return { ...finalOrder, lines: finalLines, bales: finalBales, charges: finalCharges };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "INVOICE",
        referenceId: result.orderId || orderId,
        referenceTable: "customer_orders",
        description: `Invoice ${result.invoiceNumber} – ${result.customerName || "Customer"}`,
        amountCurrency: parseFloat(result.grandTotal || "0"),
        amountUsd: parseFloat(result.grandTotal || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/finalize-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.json({ baleCount: 0, bales: [] });

      const baleIds = orderBales.map((b: any) => b.baleId);
      const baleRows = await db.select({
        id: factoryBales.id,
        referenceNumber: factoryBales.referenceNumber,
        productName: factoryBales.productName,
        weightKg: factoryBales.weightKg,
        status: factoryBales.status,
        erpLocationId: factoryBales.erpLocationId,
      }).from(factoryBales).where(inArray(factoryBales.id, baleIds));

      const locIds = [...new Set(baleRows.map((b: any) => b.erpLocationId).filter(Boolean))];
      const locationRecords = locIds.length > 0
        ? await db.select().from(locations).where(inArray(locations.id, locIds as number[]))
        : [];
      const locationMap = new Map(locationRecords.map((l: any) => [l.id, l.name]));

      const availableBales = baleRows.filter((b: any) =>
        ["IN_STOCK", "FINALIZED", "RESERVED_FOR_ORDER"].includes(b.status)
      );

      res.json({
        baleCount: availableBales.length,
        totalBalesInOrder: orderBales.length,
        bales: availableBales.map((b: any) => ({
          id: b.id,
          baleReference: b.referenceNumber,
          productName: b.productName,
          weightKg: parseFloat(b.weightKg || "0"),
          locationName: locationMap.get(b.erpLocationId) || "Unknown",
          status: b.status,
        })),
      });
    } catch (error: any) {
      console.error("Error fetching finalize preview:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/reprice", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Cannot reprice a cancelled order" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales to reprice" });

      let proformaLines: any[] = [];
      if (order.proformaIdUsed) {
        proformaLines = await db.select().from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
      }

      const proformaMap = new Map<string, string>();
      for (const pl of proformaLines) {
        if (pl.articleCode) proformaMap.set(pl.articleCode.toLowerCase(), pl.pricePerBale);
      }

      let updated = 0;
      for (const bale of orderBales) {
        let newPrice: string | null = null;

        if (bale.articleCode && proformaMap.has(bale.articleCode.toLowerCase())) {
          newPrice = proformaMap.get(bale.articleCode.toLowerCase())!;
        }

        if (!newPrice) {
          const [factoryBale] = await db.select({ productId: factoryBales.productId })
            .from(factoryBales)
            .where(eq(factoryBales.id, bale.baleId));
          if (factoryBale?.productId) {
            const [product] = await db.select({ sellingPrice: factoryBaleProducts.sellingPrice })
              .from(factoryBaleProducts)
              .where(eq(factoryBaleProducts.id, factoryBale.productId));
            if (product?.sellingPrice) newPrice = product.sellingPrice;
          }
        }

        if (newPrice !== null) {
          await db.update(customerOrderBales)
            .set({ priceUsed: newPrice })
            .where(eq(customerOrderBales.id, bale.id));
          updated++;
        }
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Sync the customerBalances ledger entry so the customer's balance reflects the new grand total.
      // The entry is inserted at finalization time; repricing must keep it in sync.
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({
            debitAmount: String(newGrandTotal),
            balance: String(newGrandTotal),
          })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges, repriced: updated });
    } catch (error: any) {
      console.error("Error repricing order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/bales/reprice-article", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { articleCode, pricePerBale } = req.body;

      if (!articleCode || pricePerBale === undefined || pricePerBale === null) {
        return res.status(400).json({ message: "articleCode and pricePerBale are required" });
      }

      const price = parseFloat(pricePerBale);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ message: "Invalid price value" });
      }

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.update(customerOrderBales)
        .set({ priceUsed: String(price) })
        .where(and(
          eq(customerOrderBales.orderId, orderId),
          eq(customerOrderBales.articleCode, articleCode)
        ));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Error repricing article:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/force-sync-bale-status", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (role !== "admin" && role !== "owner") {
        return res.status(403).json({ message: "Only admin/owner can force-sync bale statuses" });
      }

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Order must be VERIFIED or FINALIZED to force-sync bale statuses" });
      }
      if (!order.invoiceNumber) {
        return res.status(400).json({ message: "Order must have an invoice number (previously finalized) to use force-sync" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales" });

      let updated = 0;
      for (const b of orderBales) {
        const [existing] = await db.select({ status: factoryBales.status }).from(factoryBales).where(eq(factoryBales.id, b.baleId));
        if (existing && existing.status !== "SOLD") {
          await db.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
          updated++;
        }
      }

      res.json({ message: `${updated} bale(s) marked as SOLD`, updated, total: orderBales.length });
    } catch (error: any) {
      console.error("Error force-syncing bale status:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Export a single customer order to Excel with full bale detail
  app.get("/api/factory/customer-orders/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Load customer
      const [customer] = await db.select().from(customers)
        .where(eq(customers.id, order.customerId));

      // Load bale links
      const baleLinks = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId));

      // Load bale details
      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];

      // Load products for name mapping
      const productIds = [...new Set(baleRows.map((b: any) => b.productId).filter((id: any) => id != null))];
      const productRecords: any[] = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds as number[]))
        : [];
      const productMap = new Map<number, any>(productRecords.map((p: any) => [p.id, p]));

      // Load charges
      const charges = await db.select().from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      // ── Sheet 1: Order Summary ──
      const summarySheet = workbook.addWorksheet("Order Summary");
      summarySheet.columns = [
        { header: "Field", key: "field", width: 28 },
        { header: "Value", key: "value", width: 40 },
      ];
      const summaryRows = [
        { field: "Order #", value: order.id },
        { field: "Invoice Number", value: order.invoiceNumber || "-" },
        { field: "Customer", value: customer?.legalName || `Customer #${order.customerId}` },
        { field: "Order Date", value: order.orderDate || "-" },
        { field: "Status", value: order.status },
        { field: "Container Number", value: order.containerNumber || "-" },
        { field: "Shipping Company", value: order.shippingCompany || "-" },
        { field: "Total Bales", value: order.totalQtyBales || baleRows.length },
        { field: "Subtotal (Bales)", value: parseFloat(order.subtotalBales || "0") },
        { field: "Freight Amount", value: parseFloat(order.freightAmount || "0") },
        { field: "Other Charges", value: parseFloat(order.otherChargesTotal || "0") },
        { field: "Grand Total", value: parseFloat(order.grandTotal || "0") },
      ];
      summaryRows.forEach((r) => summarySheet.addRow(r));
      summarySheet.getRow(1).font = { bold: true };

      const [fCfgOrder] = await db.select({ hideAvgCost: factorySettings.hideAvgCost, hideSellingPrice: factorySettings.hideSellingPrice }).from(factorySettings).where(eq(factorySettings.companyId, companyId)).limit(1);
      const showCostOrder = !fCfgOrder?.hideAvgCost;

      // ── Sheet 2: Bale Details ──
      const baleSheet = workbook.addWorksheet("Bale Details");
      const baleSheetCols: any[] = [
        { header: "#", key: "seq", width: 6 },
        { header: "Reference", key: "ref", width: 18 },
        { header: "Article Code", key: "articleCode", width: 14 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (showCostOrder) baleSheetCols.push({ header: "Cost/kg", key: "costPerKg", width: 12 });
      baleSheetCols.push({ header: "Status", key: "status", width: 16 });
      if (!fCfgOrder?.hideSellingPrice) baleSheetCols.push({ header: "Price Used", key: "priceUsed", width: 14 });
      baleSheet.columns = baleSheetCols;
      baleSheet.getRow(1).font = { bold: true };

      // Map baleId -> price from link table
      const balePriceMap = new Map<number, string>(baleLinks.map((l: any) => [l.baleId, l.priceUsed]));

      baleRows.forEach((bale: any, i: number) => {
        const product = productMap.get(bale.productId);
        const baleDetailRow: any = {
          seq: i + 1,
          ref: bale.referenceNumber || bale.baleCode || "-",
          articleCode: product?.articleCode || bale.articleCode || "-",
          productName: product?.name || product?.articleCode || "-",
          weightKg: parseFloat(bale.weightKg || "0"),
        };
        if (showCostOrder) baleDetailRow.costPerKg = parseFloat(bale.costPerKg || "0");
        baleDetailRow.status = bale.status || "-";
        if (!fCfgOrder?.hideSellingPrice) baleDetailRow.priceUsed = parseFloat(balePriceMap.get(bale.id) || "0");
        baleSheet.addRow(baleDetailRow);
      });

      // Totals row
      if (baleRows.length > 0) {
        const totalDetailRow: any = {
          seq: "",
          ref: "TOTAL",
          articleCode: "",
          productName: "",
          weightKg: baleRows.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0),
        };
        if (showCostOrder) totalDetailRow.costPerKg = "";
        totalDetailRow.status = "";
        if (!fCfgOrder?.hideSellingPrice) totalDetailRow.priceUsed = "";
        const totalRow = baleSheet.addRow(totalDetailRow);
        totalRow.font = { bold: true };
      }

      // ── Sheet 3: Charges ──
      if (charges.length > 0) {
        const chargeSheet = workbook.addWorksheet("Charges");
        chargeSheet.columns = [
          { header: "Description", key: "description", width: 36 },
          { header: "Amount", key: "amount", width: 16 },
        ];
        chargeSheet.getRow(1).font = { bold: true };
        charges.forEach((c: any) => chargeSheet.addRow({ description: c.description, amount: parseFloat(c.amount || "0") }));
      }

      const dateStr = new Date().toISOString().split("T")[0];
      const fileName = `order_${orderId}_${order.invoiceNumber || "draft"}_${dateStr}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting order to Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/unfinalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (order.status !== "FINALIZED") throw new Error("Only FINALIZED orders can be reverted to Draft");

        // Block if any payment has been recorded against this invoice
        const payments = await tx.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceId, orderId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.transactionType, "PAYMENT"),
          ));
        if (payments.length > 0) {
          throw new Error("Cannot revert: this invoice has payments recorded against it. Reverse the payments first.");
        }

        // Delete the SALE balance entry for this invoice
        await tx.delete(customerBalances).where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceId, orderId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.transactionType, "SALE"),
        ));

        // Delete charge journal vouchers created during finalization (sourceModule FACTORY, description contains invoice number)
        if (order.invoiceNumber) {
          const chargeVouchers = await tx.select({ id: vouchers.id })
            .from(vouchers)
            .where(and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              sql`${vouchers.description} LIKE ${"CHARGE-" + order.invoiceNumber + "-%"}`,
            ));
          for (const cv of chargeVouchers) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, cv.id));
            await tx.delete(vouchers).where(eq(vouchers.id, cv.id));
          }
        }

        // Revert bales from SOLD → FINALIZED
        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx.update(factoryBales)
            .set({ status: "FINALIZED", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, b.baleId), eq(factoryBales.status, "SOLD")));
        }

        // Reset order to PENDING_VERIFICATION, clear invoice number
        await tx.update(customerOrders).set({
          status: "PENDING_VERIFICATION",
          invoiceNumber: null,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        // Daybook entry
        const [unfCustomer] = await tx.select({ legalName: customers.legalName })
          .from(customers).where(eq(customers.id, order.customerId));
        const unfToday = new Date().toISOString().split("T")[0];
        await writeDaybookEntry(tx, {
          companyId,
          txDate: unfToday,
          txType: "INVOICE_REVERTED",
          referenceId: orderId,
          description: `Invoice ${order.invoiceNumber} reverted to Draft – ${unfCustomer?.legalName || "Customer"}`,
        });
      });

      res.json({ message: "Invoice reverted to Draft successfully" });
    } catch (error: any) {
      console.error("Error unfinalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/cancel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING"].includes(order.status)) return res.status(400).json({ message: "Only DRAFT or LOADING orders can be cancelled" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      for (const ob of orderBales) {
        await db.update(factoryBales).set({ status: "FINALIZED", updatedAt: new Date() }).where(eq(factoryBales.id, ob.baleId));
      }

      const [updated] = await db.update(customerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      const [cancelCustomer] = await db.select({ legalName: customers.legalName })
        .from(customers).where(eq(customers.id, order.customerId));
      const cancelToday = new Date().toISOString().split("T")[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: cancelToday,
        txType: "ORDER_CANCELLED",
        referenceId: orderId,
        description: `Order cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale${orderBales.length !== 1 ? "s" : ""} released`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CONTAINER LOADING WORKFLOW
  // ───────────────────────────────────────────────

  app.post("/api/factory/customer-orders-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, proformaIdUsed, locationId, orderDate } = req.body;
      if (!customerId) return res.status(400).json({ message: "Customer is required" });
      if (!locationId) return res.status(400).json({ message: "Location is required" });

      const [order] = await db.insert(customerOrders).values({
        companyId,
        customerId: parseInt(customerId),
        proformaIdUsed: proformaIdUsed ? parseInt(proformaIdUsed) : null,
        locationId: parseInt(locationId),
        orderDate: orderDate || new Date().toISOString().split('T')[0],
        status: "LOADING",
        loadingStartedAt: new Date(),
      }).returning();

      const [loadingCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, parseInt(customerId)));
      const loadingToday = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: loadingToday,
        txType: "LOADING_CREATED",
        referenceId: order.id,
        description: `Loading started for customer: ${loadingCustomer?.legalName || customerId}`,
      });

      res.json(order);
    } catch (error: any) {
      console.error("Error creating loading order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "LOADING") return res.status(400).json({ message: "Only LOADING orders can be finalized for loading" });

      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (bales.length === 0) return res.status(400).json({ message: "Order has no bales scanned" });

      const [updated] = await db.update(customerOrders).set({
        status: "PENDING_VERIFICATION",
        loadingFinalizedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(customerOrders.id, orderId)).returning();

      const [lsCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, order.customerId));
      const lsToday = new Date().toISOString().split('T')[0];
      const lsTotalValue = bales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "LOADING_SUBMITTED",
        referenceId: orderId,
        description: `Loading submitted for verification: ${lsCustomer?.legalName || "Customer"}, ${bales.length} bale${bales.length !== 1 ? "s" : ""} scanned`,
        amountCurrency: lsTotalValue,
        amountUsd: lsTotalValue,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error finalizing loading:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/verification-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

      const loadedByArticle: Record<string, { articleCode: string; productName: string; qty: number; totalWeight: number; totalPrice: number }> = {};
      for (const b of orderBales) {
        const code = b.articleCode || "UNKNOWN";
        if (!loadedByArticle[code]) {
          loadedByArticle[code] = { articleCode: code, productName: b.baleName || code, qty: 0, totalWeight: 0, totalPrice: 0 };
        }
        loadedByArticle[code].qty += 1;
        loadedByArticle[code].totalWeight += parseFloat(b.weight);
        loadedByArticle[code].totalPrice += parseFloat(b.priceUsed);
      }

      let proformaLines: any[] = [];
      const proformaByArticle: Record<string, { articleCode: string; productName: string; expectedQty: number; pricePerBale: string }> = {};

      if (order.proformaIdUsed) {
        proformaLines = await db.select().from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));

        for (const pl of proformaLines) {
          proformaByArticle[pl.articleCode] = {
            articleCode: pl.articleCode,
            productName: pl.productName,
            expectedQty: pl.quantity,
            pricePerBale: pl.pricePerBale,
          };
        }
      }

      const allArticles = new Set([...Object.keys(loadedByArticle), ...Object.keys(proformaByArticle)]);
      const comparison: any[] = [];

      for (const code of allArticles) {
        const loaded = loadedByArticle[code] || null;
        const proforma = proformaByArticle[code] || null;
        const loadedQty = loaded?.qty || 0;
        const expectedQty = proforma?.expectedQty || 0;

        let status: string;
        if (!proforma && loadedQty > 0) {
          status = "LOADED_NOT_IN_PROFORMA";
        } else if (proforma && loadedQty === 0) {
          status = "MISSING_FROM_LOADED";
        } else if (expectedQty > 0 && loadedQty < expectedQty) {
          status = "UNDER_LOADED";
        } else if (expectedQty > 0 && loadedQty > expectedQty) {
          status = "OVER_LOADED";
        } else {
          status = "MATCH";
        }

        comparison.push({
          articleCode: code,
          productName: loaded?.productName || proforma?.productName || code,
          loadedQty,
          expectedQty,
          diff: loadedQty - expectedQty,
          totalWeight: loaded?.totalWeight || 0,
          totalPrice: loaded?.totalPrice || 0,
          pricePerBale: proforma?.pricePerBale || "0",
          inProforma: !!proforma,
          status,
        });
      }

      res.json({
        order,
        loadedItems: Object.values(loadedByArticle),
        proformaLines: Object.values(proformaByArticle),
        comparison,
        totalLoadedBales: orderBales.length,
        totalLoadedWeight: orderBales.reduce((s: number, b: any) => s + parseFloat(b.weight), 0),
      });
    } catch (error: any) {
      console.error("Error fetching verification summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/verify", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { approved, notes } = req.body;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "PENDING_VERIFICATION") return res.status(400).json({ message: "Only PENDING_VERIFICATION orders can be verified" });

      if (approved) {
        const [updated] = await db.update(customerOrders).set({
          status: "VERIFIED",
          verifiedAt: new Date(),
          containerNotes: notes || order.containerNotes,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId)).returning();
        const [verifyCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, order.customerId));
        const verifyBales = await db.select({ priceUsed: customerOrderBales.priceUsed }).from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const verifyTotalValue = verifyBales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
        const verifyToday = new Date().toISOString().split('T')[0];
        await writeDaybookEntry(db, {
          companyId,
          txDate: verifyToday,
          txType: "ORDER_VERIFIED",
          referenceId: orderId,
          description: `Order verified for customer: ${verifyCustomer?.legalName || "Customer"}${notes ? ` – ${notes}` : ""}`,
          amountCurrency: verifyTotalValue,
          amountUsd: verifyTotalValue,
        });
        res.json(updated);
      } else {
        const [updated] = await db.update(customerOrders).set({
          containerNotes: notes || order.containerNotes,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId)).returning();
        res.json(updated);
      }
    } catch (error: any) {
      console.error("Error verifying order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/return-to-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "PENDING_VERIFICATION") return res.status(400).json({ message: "Only PENDING_VERIFICATION orders can be returned to loading" });

      const [updated] = await db.update(customerOrders).set({
        status: "LOADING",
        loadingFinalizedAt: null,
        updatedAt: new Date(),
      }).where(eq(customerOrders.id, orderId)).returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error returning order to loading:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/assign-container", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { containerNumber, shippingCompany, containerNotes } = req.body;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const updateData: any = { updatedAt: new Date() };
      if (containerNumber !== undefined) updateData.containerNumber = containerNumber;
      if (shippingCompany !== undefined) updateData.shippingCompany = shippingCompany;
      if (containerNotes !== undefined) updateData.containerNotes = containerNotes;

      const [updated] = await db.update(customerOrders).set(updateData)
        .where(eq(customerOrders.id, orderId)).returning();

      if (shippingCompany && order.customerId) {
        await db.update(customers).set({
          defaultShippingCompany: shippingCompany,
        }).where(eq(customers.id, order.customerId)).catch(() => {});
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // BALE SCAN LOOKUP
  // ───────────────────────────────────────────────

  app.get("/api/factory/bale-lookup", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const code = req.query.code as string;
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : null;
      if (!code) return res.status(400).json({ message: "code is required" });

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "FINALIZED"),
        or(
          eq(factoryBales.referenceNumber, code),
          eq(factoryBales.baleCode, code),
          eq(factoryBales.articleCode, code)
        ),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const results = await db.select().from(factoryBales).where(and(...conditions));

      if (results.length === 0) return res.status(404).json({ message: "No available bale found with that code at this location" });

      res.json(results);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (Excel/CSV)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Build article-code → product name map from factoryBaleProducts so the export
      // always shows the canonical product name regardless of what was stored in baleName
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const productNameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const products = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            inArray(factoryBaleProducts.articleCode, articleCodes)
          ));
        for (const p of products) {
          if (p.articleCode) productNameMap.set(p.articleCode, p.name);
        }
      }

      const sortedLines = lines.sort((a: any, b: any) => {
        const nameA = productNameMap.get(a.articleCode) || a.baleName || "";
        const nameB = productNameMap.get(b.articleCode) || b.baleName || "";
        return nameA.localeCompare(nameB);
      });

      const csvFmtNum = (val: any): string => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "");
      };
      const csvFmtMoney = (val: any): string => `$${csvFmtNum(val)}`;

      let csv = `Company: ${company?.name || ""}\n`;
      csv += `Invoice: ${order.invoiceNumber || "DRAFT"}\n`;
      csv += `Customer: ${order.customerName} (${order.customerCode})\n`;
      csv += `Date: ${order.orderDate}\n\n`;
      csv += `#,Article Code,Product Name,Qty,Weight/Bale,Total Weight,Price/Bale,Total Price\n`;

      sortedLines.forEach((line: any, idx: number) => {
        const productName = productNameMap.get(line.articleCode) || line.baleName || "";
        csv += `${idx + 1},${line.articleCode},${productName.replace(/,/g, " ")},${csvFmtNum(line.qty)},${csvFmtNum(line.weightPerBale)},${csvFmtNum(line.totalWeight)},${csvFmtMoney(line.pricePerBale)},${csvFmtMoney(line.totalPrice)}\n`;
      });

      csv += `\nCharges\n`;
      csv += `Name,Type,Amount\n`;
      for (const charge of charges) {
        csv += `${(charge.name || "").replace(/,/g, " ")},${charge.chargeType},${csvFmtMoney(charge.amount)}\n`;
      }

      csv += `\nSummary\n`;
      csv += `Subtotal Bales,${csvFmtMoney(order.subtotalBales)}\n`;
      csv += `Freight,${csvFmtMoney(order.freightAmount)}\n`;
      csv += `Other Charges,${csvFmtMoney(order.otherChargesTotal)}\n`;
      csv += `Grand Total,${csvFmtMoney(order.grandTotal)}\n`;
      csv += `Total Qty Bales,${csvFmtNum(order.totalQtyBales)}\n`;

      const filename = `invoice_${order.invoiceNumber || orderId}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Error exporting order to CSV:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // PENDING LOADING — BALE-LEVEL EXCEL EXPORT
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/pending-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));

      const baleLinks = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId))
        .orderBy(customerOrderBales.id);

      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];
      const baleMap = new Map<number, any>(baleRows.map((b: any) => [b.id, b]));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Loading");

      const NUM_COLS_LOADING = 6;
      sheet.columns = [
        { key: "seq", width: 6 },
        { key: "refCode", width: 20 },
        { key: "articleCode", width: 16 },
        { key: "name", width: 32 },
        { key: "weight", width: 14 },
        { key: "totalWeight", width: 18 },
      ];

      // Logo header rows
      try {
        const ldLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(ldLogoPath)) {
          const ldId = workbook.addImage({ buffer: fs.readFileSync(ldLogoPath) as Buffer, extension: "jpeg" });
          const ldRow = sheet.addRow([]); ldRow.height = 90;
          sheet.addImage(ldId, { tl: { col: 2.4, row: 0 }, ext: { width: 300, height: 90 } });
        }
      } catch {}
      const ldTitle = sheet.addRow([`Loading List — ${customerName}`]);
      ldTitle.getCell(1).font = { bold: true, size: 13 };
      ldTitle.getCell(1).alignment = { horizontal: "center" };
      sheet.mergeCells(ldTitle.number, 1, ldTitle.number, NUM_COLS_LOADING);
      sheet.addRow([]);

      const ldHdr = sheet.addRow(["#", "Ref Code", "Article Code", "Name", "Weight (kg)", "Total Weight (kg)"]);
      ldHdr.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      });

      let runningTotal = 0;
      for (let i = 0; i < baleLinks.length; i++) {
        const link = baleLinks[i];
        const bale = baleMap.get(link.baleId);
        const weight = parseFloat(link.weight || bale?.weightKg || "0");
        runningTotal += weight;
        const row = sheet.addRow({
          seq: i + 1,
          refCode: link.baleReference || bale?.referenceNumber || bale?.baleCode || "",
          articleCode: link.articleCode || bale?.articleCode || "",
          name: link.baleName || bale?.productName || "",
          weight: Math.round(weight * 100) / 100,
          totalWeight: Math.round(runningTotal * 100) / 100,
        });
        row.getCell("weight").numFmt = "#,##0.00";
        row.getCell("totalWeight").numFmt = "#,##0.00";
      }

      const totalRow = sheet.addRow({
        seq: "",
        refCode: "",
        articleCode: "",
        name: "TOTAL",
        weight: Math.round(runningTotal * 100) / 100,
        totalWeight: Math.round(runningTotal * 100) / 100,
      });
      totalRow.font = { bold: true };
      totalRow.getCell("weight").numFmt = "#,##0.00";
      totalRow.getCell("totalWeight").numFmt = "#,##0.00";

      const customerName = customer?.legalName || `order_${orderId}`;
      const safeName = customerName.replace(/[^a-zA-Z0-9_\-]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="loading_${orderId}_${safeName}.xlsx"`);
      const buffer = await workbook.xlsx.writeBuffer();
      res.send(buffer);
    } catch (error: any) {
      console.error("Error exporting pending loading:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (PDF as HTML)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          containerNumber: customerOrders.containerNumber,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Build nameMap for invoice HTML export
      const invArticleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const invNameMap = new Map<string, string>();
      if (invArticleCodes.length > 0) {
        const invProds = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, invArticleCodes)));
        for (const p of invProds) { if (p.articleCode) invNameMap.set(p.articleCode, p.name); }
      }
      const sortedLines = lines.sort((a: any, b: any) => {
        const na = invNameMap.get(a.articleCode) || a.baleName || "";
        const nb = invNameMap.get(b.articleCode) || b.baleName || "";
        return na.localeCompare(nb);
      });

      // Read logo for embedding in HTML
      const invLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      let invLogoDataUri = "";
      try {
        if (fs.existsSync(invLogoPath)) {
          const logoB64 = fs.readFileSync(invLogoPath).toString("base64");
          invLogoDataUri = `data:image/jpeg;base64,${logoB64}`;
        }
      } catch {}

      const fmtNum = (val: any): string => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0
          ? n.toLocaleString("en-US")
          : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };
      const fmtMoney = (val: any): string => `$${fmtNum(val)}`;

      let linesHtml = "";
      sortedLines.forEach((line: any, idx: number) => {
        linesHtml += `<tr>
          <td>${idx + 1}</td>
          <td>${line.articleCode}</td>
          <td>${invNameMap.get(line.articleCode) || line.baleName || ""}</td>
          <td>${fmtNum(line.qty)}</td>
          <td>${fmtNum(line.weightPerBale)}</td>
          <td>${fmtNum(line.totalWeight)}</td>
          <td>${fmtMoney(line.pricePerBale)}</td>
          <td>${fmtMoney(line.totalPrice)}</td>
        </tr>`;
      });

      let chargesHtml = "";
      for (const charge of charges) {
        chargesHtml += `<tr><td>${charge.name}</td><td>${charge.chargeType}</td><td>${fmtMoney(charge.amount)}</td></tr>`;
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${order.invoiceNumber || "DRAFT"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; }

  /* ── Top header bar ── */
  .top-bar { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%); color: #fff; padding: 18px 32px; display: flex; align-items: center; gap: 20px; }
  .top-bar-logo { height: 70px; width: auto; flex-shrink: 0; filter: brightness(0) invert(1); }
  .top-bar-text h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 4px; }
  .top-bar-text .subtitle { font-size: 11px; color: #a8c0e8; letter-spacing: 1px; text-transform: uppercase; }

  /* ── Invoice meta strip ── */
  .meta-strip { display: flex; gap: 0; border-bottom: 3px solid #e94560; }
  .meta-box { flex: 1; padding: 10px 16px; border-right: 1px solid #e8edf5; background: #f7f9fc; }
  .meta-box:last-child { border-right: none; }
  .meta-box .label { font-size: 9px; font-weight: 700; color: #7a8ba0; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 3px; }
  .meta-box .value { font-size: 13px; font-weight: 600; color: #1a1a2e; }

  /* ── Section heading ── */
  .section-heading { background: #e94560; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 5px 16px; margin: 0; }

  /* ── Lines table ── */
  .lines-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .lines-table col.col-num     { width: 32px; }
  .lines-table col.col-article { width: 90px; }
  .lines-table col.col-product { width: 130px; }
  .lines-table col.col-qty     { width: 42px; }
  .lines-table col.col-wt-bale { width: 72px; }
  .lines-table col.col-total-wt{ width: 78px; }
  .lines-table col.col-price   { width: 72px; }
  .lines-table col.col-total   { width: 78px; }
  .lines-table thead tr { background: #16213e; color: #fff; }
  .lines-table thead th { padding: 7px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; border: none; white-space: nowrap; text-align: center; }
  .lines-table tbody td { padding: 5px 8px; font-size: 11px; border-bottom: 1px solid #eaeff5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
  .lines-table tbody tr:nth-child(even) { background: #f4f7fb; }
  .lines-table tbody tr:hover { background: #e8f0fe; }
  .lines-table tfoot td { padding: 6px 8px; font-size: 11px; font-weight: 600; background: #eef2f9; border-top: 2px solid #16213e; text-align: center; }

  /* ── Charges table ── */
  .charges-table { width: 60%; border-collapse: collapse; margin: 0 0 0 0; }
  .charges-table thead tr { background: #0f3460; color: #fff; }
  .charges-table thead th { padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; border: none; text-align: center; }
  .charges-table tbody td { padding: 5px 10px; font-size: 11px; border-bottom: 1px solid #eaeff5; text-align: center; }
  .charges-table tbody tr:nth-child(even) { background: #f4f7fb; }

  /* ── Totals box ── */
  .totals-wrap { display: flex; justify-content: flex-end; padding: 16px 0; }
  .totals-table { width: 280px; border-collapse: collapse; }
  .totals-table td { padding: 5px 12px; font-size: 12px; border-bottom: 1px solid #eaeff5; }
  .totals-table td:last-child { text-align: right; font-weight: 600; }
  .totals-table tr.grand { background: #e94560; color: #fff; }
  .totals-table tr.grand td { font-size: 14px; font-weight: 700; border: none; padding: 8px 12px; }

  .content { padding: 0 0 24px; }

  @page { size: A4; margin: 0; }
  @media print {
    html, body { margin: 0; padding: 0; width: 210mm; }
    body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .top-bar { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .meta-strip { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .section-heading { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .lines-table thead tr { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .lines-table tbody tr:nth-child(even) { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .lines-table tbody tr:hover { background: transparent !important; }
    .totals-table tr.grand { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .charges-table thead tr { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style></head><body>

<div class="top-bar">
  ${invLogoDataUri ? `<img class="top-bar-logo" src="${invLogoDataUri}" alt="HMD International Group" />` : ""}
  <div class="top-bar-text">
    <h1>HMD INTERNATIONAL GROUP</h1>
    <div class="subtitle">Commercial Invoice</div>
  </div>
</div>

<div class="meta-strip">
  <div class="meta-box">
    <div class="label">Invoice No.</div>
    <div class="value">${order.invoiceNumber || "DRAFT"}</div>
  </div>
  <div class="meta-box">
    <div class="label">Customer</div>
    <div class="value">${order.customerName || "-"}</div>
  </div>
  <div class="meta-box">
    <div class="label">Date</div>
    <div class="value">${order.orderDate}</div>
  </div>
  ${order.containerNumber ? `<div class="meta-box"><div class="label">Container</div><div class="value">${order.containerNumber}</div></div>` : ""}
</div>

<div class="content">
  <div class="section-heading">Order Lines</div>
  <table class="lines-table">
    <colgroup>
      <col class="col-num"><col class="col-article"><col class="col-product">
      <col class="col-qty"><col class="col-wt-bale"><col class="col-total-wt">
      <col class="col-price"><col class="col-total">
    </colgroup>
    <thead><tr>
      <th>#</th>
      <th>Article Code</th>
      <th>Product</th>
      <th>Qty</th>
      <th>Wt/Bale</th>
      <th>Total Wt</th>
      <th>Price/Bale</th>
      <th>Total</th>
    </tr></thead>
    <tbody>${linesHtml}</tbody>
    <tfoot><tr>
      <td colspan="3" style="color:#555">Totals</td>
      <td>${fmtNum(order.totalQtyBales)}</td>
      <td></td>
      <td></td>
      <td></td>
      <td>${fmtMoney(order.grandTotal)}</td>
    </tr></tfoot>
  </table>

  ${charges.length > 0 ? `
  <div class="section-heading" style="margin-top:16px">Charges</div>
  <table class="charges-table">
    <thead><tr><th>Name</th><th>Type</th><th>Amount</th></tr></thead>
    <tbody>${chargesHtml}</tbody>
  </table>` : ""}

  <div class="totals-wrap">
    <table class="totals-table">
      <tr><td>Subtotal (Bales)</td><td>${fmtMoney(order.subtotalBales)}</td></tr>
      <tr><td>Freight</td><td>${fmtMoney(order.freightAmount)}</td></tr>
      <tr><td>Other Charges</td><td>${fmtMoney(order.otherChargesTotal)}</td></tr>
      <tr><td>Total Qty Bales</td><td>${fmtNum(order.totalQtyBales)}</td></tr>
      <tr class="grand"><td>Grand Total</td><td>${fmtMoney(order.grandTotal)}</td></tr>
    </table>
  </div>
</div>

</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      console.error("Error exporting order to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENT TYPES ───────

}
