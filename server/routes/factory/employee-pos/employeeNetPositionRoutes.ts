import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { buildBrokerStatement } from "../suppliers/supplierBrokerRoutes";
import { adjustInventory } from "../../../inventoryHelper";
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
  propertyContracts,
  propertyMonthlyLedger,
  propertyPayments,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sqlArray } from "../../../lib/sqlArray";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerEmployeeNetPositionRoutes(app: Express) {
  app.get("/api/factory/net-position", requireAuth, async (req: any, res: any) => {
    try {
      // Resolve factory company ID the same way my-access does:
      // 1. pinned factoryCompanyId (if it's a factory-type company)
      // 2. currentCompanyId (if it's factory-type)
      // 3. first active factory-type company in DB
      // 4. fall back to currentCompanyId
      let companyId: number | null = (req.session as any).factoryCompanyId || null;

      if (!companyId) {
        const currentId = (req.session as any).currentCompanyId;
        if (currentId) {
          const [cur] = await db
            .select({ id: companies.id, companyType: companies.companyType })
            .from(companies)
            .where(eq(companies.id, currentId));
          if (cur?.companyType === "factory") companyId = cur.id;
        }
      }

      if (!companyId) {
        const [fc] = await db
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.companyType, "factory"), eq(companies.active, true)))
          .limit(1);
        if (fc) companyId = fc.id;
      }

      if (!companyId) companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Pin it for subsequent requests this session
      (req.session as any).factoryCompanyId = companyId;

      // ── As-of date ────────────────────────────────────────────────────────────
      // All date-sensitive queries are filtered to data created/dated on or before asOf.
      const asOf: string =
        typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
          ? req.query.asOf
          : new Date().toISOString().slice(0, 10);

      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // Load user-configured display FX rates (set in Settings → FX Rates)
      const fxRateRows = await db.execute(sql`
        SELECT DISTINCT ON (currency_code) currency_code, rate_to_usd
        FROM factory_fx_rates
        WHERE company_id = ${companyId} AND source = 'manual'
        ORDER BY currency_code, effective_date DESC
      `);
      const configFxRates: Record<string, number> = {};
      for (const row of fxRateRows.rows as any[]) {
        configFxRates[row.currency_code as string] = parseFloat(row.rate_to_usd as string);
      }
      // Only use manually configured rates — no hardcoded fallbacks
      const getConfigFx = (cc: string): number => configFxRates[cc] ?? 1;

      // ── 1. Factory supplier balances (What We Owe) ──────────────────────
      const suppliersList = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      const allContainersF = await db
        .select()
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            isNull(factoryContainers.deletedAt),
            sql`DATE(${factoryContainers.createdAt}) <= ${asOf}::date`
          )
        );

      const allPaymentsF = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), lte(factorySupplierPayments.date, asOf)));

      const allFxTransfersF = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.companyId, companyId), lte(factorySupplierFxTransfers.date, asOf)));

      // Additional charge sources — must match buildBrokerStatement exactly
      const allOffloadChargesF = await db
        .select({
          supplierId: factoryOffloadAdditionalCharges.supplierId,
          amount: factoryOffloadAdditionalCharges.amount,
          currencyCode: factoryOffloadAdditionalCharges.currencyCode,
        })
        .from(factoryOffloadAdditionalCharges)
        .where(eq(factoryOffloadAdditionalCharges.companyId, companyId));

      const allContainerOtherChargesF = await db
        .select({
          supplierId: factoryContainers.supplierId,
          amount: factoryContainerOtherCharges.amount,
          currencyCode: factoryContainerOtherCharges.currencyCode,
          containerCurrencyCode: factoryContainers.currencyCode,
        })
        .from(factoryContainerOtherCharges)
        .innerJoin(factoryContainers, eq(factoryContainerOtherCharges.containerId, factoryContainers.id))
        .where(
          and(
            eq(factoryContainerOtherCharges.companyId, companyId),
            isNull(factoryContainers.deletedAt),
            sql`DATE(${factoryContainers.createdAt}) <= ${asOf}::date`
          )
        );

      const allColOtherChargesF = await db
        .select({
          otherChargesSupplierId: factoryContainers.otherChargesSupplierId,
          otherCharges: factoryContainers.otherCharges,
          otherChargesCurrencyCode: factoryContainers.otherChargesCurrencyCode,
        })
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            isNull(factoryContainers.deletedAt),
            sql`${factoryContainers.otherChargesSupplierId} IS NOT NULL`,
            sql`CAST(COALESCE(${factoryContainers.otherCharges}, '0') AS numeric) > 0`,
            sql`DATE(${factoryContainers.createdAt}) <= ${asOf}::date`
          )
        );

      // Voucher-based payments (exclude auto-generated FACTORY-PAY-* and optional vouchers)
      const allSupplierIds = (suppliersList as any[]).map((s: any) => s.id);
      const voucherPaidBySupplier: Record<number, number> = {};
      // Per-currency voucher amounts needed for broker consolidated calculation
      const voucherPaidByCurrencyBySupplierId: Record<number, Record<string, number>> = {};
      if (allSupplierIds.length > 0) {
        const voucherRows = await db
          .select({
            factorySupplierId: voucherEntries.factorySupplierId,
            debitAmount: voucherEntries.debitAmount,
            currency: vouchers.currency,
            exchangeRate: vouchers.exchangeRate,
            optional: vouchers.optional,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              inArray(voucherEntries.factorySupplierId, allSupplierIds),
              sql`${voucherEntries.debitAmount}::numeric > 0`,
              sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`,
              lte(vouchers.voucherDate, asOf)
            )
          );
        for (const row of voucherRows as any[]) {
          const sid = row.factorySupplierId;
          if (!sid) continue;
          if (row.optional) continue; // optional vouchers don't affect the balance
          const amt = parseFloat(row.debitAmount || "0");
          const fx = parseFloat(row.exchangeRate || "1") || 1;
          const cc = row.currency || "USD";
          const usd = cc === "USD" ? amt : amt / fx;
          voucherPaidBySupplier[sid] = (voucherPaidBySupplier[sid] || 0) + usd;
          if (!voucherPaidByCurrencyBySupplierId[sid]) voucherPaidByCurrencyBySupplierId[sid] = {};
          voucherPaidByCurrencyBySupplierId[sid][cc] = (voucherPaidByCurrencyBySupplierId[sid][cc] || 0) + amt;
        }
      }

      // Identify brokers (suppliers that have children linked via parentId)
      // and linked suppliers (those with parentId set pointing to a broker)
      const brokerIds = new Set<number>();
      const linkedSupplierParent = new Map<number, number>(); // childId → brokerId
      for (const s of suppliersList as any[]) {
        if (s.parentId) {
          linkedSupplierParent.set(s.id, s.parentId);
          brokerIds.add(s.parentId);
        }
      }

      // Pre-group children IDs for each broker
      const brokerChildren = new Map<number, number[]>(); // brokerId → [childIds]
      for (const [childId, brokerId] of linkedSupplierParent) {
        if (!brokerChildren.has(brokerId)) brokerChildren.set(brokerId, []);
        brokerChildren.get(brokerId)!.push(childId);
      }

      // Broker consolidated balance: calculate per-currency running balance for the
      // broker + all linked suppliers, then apply approximate FX rates to get one USD total.
      // Formula: USD_balance + (EUR_balance × 1.16) + (AUD_balance × 0.71)
      const calcBrokerApproxUsd = (brokerId: number): number => {
        const groupIds = [brokerId, ...(brokerChildren.get(brokerId) || [])];
        const buckets: Record<string, number> = {};
        const add = (cc: string, amt: number) => {
          buckets[cc] = (buckets[cc] || 0) + amt;
        };

        // Opening balances for all group members (stored in USD)
        for (const s of suppliersList as any[]) {
          if (!groupIds.includes(s.id)) continue;
          const ob = parseFloat(s.openingBalance || "0");
          if (ob !== 0) add("USD", ob);
        }

        // Containers (goods + freight per currency)
        // USD commission from linked (child) suppliers also flows into the broker's USD bucket.
        for (const c of allContainersF as any[]) {
          if (!groupIds.includes(c.supplierId)) continue;
          const cc = c.currencyCode || "USD";
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          add(cc, kg * rate);
          const freight = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || cc;
          if (freight > 0) add(freightCc, freight);
          // USD commission from linked (child) suppliers → broker USD bucket
          // (broker's own containers and non-USD commission stay excluded)
          if (
            c.supplierId !== brokerId &&
            linkedSupplierParent.has(c.supplierId) &&
            linkedSupplierParent.get(c.supplierId) === brokerId
          ) {
            const commAmt = parseFloat(c.commissionAmount || "0");
            if (commAmt > 0 && (c.commissionCurrencyCode || "USD") === "USD") {
              add("USD", commAmt);
            }
          }
        }

        // Offload additional charges (per-supplier, in their own currency)
        for (const oc of allOffloadChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || "USD";
          add(cc, parseFloat(oc.amount || "0"));
        }

        // Container other charges table (linked via containerId → supplierId)
        for (const oc of allContainerOtherChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || oc.containerCurrencyCode || "USD";
          add(cc, parseFloat(oc.amount || "0"));
        }

        // Container column other_charges (where otherChargesSupplierId is in group)
        for (const oc of allColOtherChargesF as any[]) {
          if (!groupIds.includes(oc.otherChargesSupplierId)) continue;
          const cc = oc.otherChargesCurrencyCode || "USD";
          add(cc, parseFloat(oc.otherCharges || "0"));
        }

        // Direct payments (reduce balance in payment currency)
        for (const p of allPaymentsF as any[]) {
          if (!groupIds.includes(p.supplierId)) continue;
          const cc = p.currencyCode || "USD";
          add(cc, -parseFloat(p.amount || "0"));
        }

        // Voucher payments per currency
        for (const sid of groupIds) {
          const currMap = voucherPaidByCurrencyBySupplierId[sid] || {};
          for (const [cc, amt] of Object.entries(currMap)) {
            add(cc, -amt);
          }
        }

        // FX transfers
        for (const t of allFxTransfersF as any[]) {
          const fromCc = t.fromCurrencyCode || "USD";
          const fromAmt = parseFloat(t.fromAmount || "0");
          const toUsd = parseFloat(t.toAmountUsd || "0");
          const isFromBroker = t.fromSupplierId === brokerId;
          // Non-USD source: subtract from the foreign-currency bucket
          if (groupIds.includes(t.fromSupplierId) && fromCc !== "USD") {
            add(fromCc, -fromAmt);
          }
          // FX In to broker pool
          if (t.toSupplierId === brokerId) {
            add("USD", toUsd);
          }
          // FX Out from broker in USD (broker redistributes USD out of its pool)
          if (isFromBroker && fromCc === "USD") {
            add("USD", -fromAmt);
          }
        }

        const usdBal = buckets["USD"] || 0;
        const otherBal = Object.entries(buckets)
          .filter(([cc]) => cc !== "USD")
          .reduce((s, [cc, v]) => s + v * getConfigFx(cc), 0);
        return usdBal + otherBal;
      };

      // Extended broker calculation that returns both the total and a line-by-line breakdown
      const calcBrokerDetail = (
        brokerId: number
      ): {
        total: number;
        breakdown: { label: string; native: string; usd: number }[];
      } => {
        const groupIds = [brokerId, ...(brokerChildren.get(brokerId) || [])];
        const buckets: Record<string, number> = {};
        const add = (cc: string, amt: number) => {
          buckets[cc] = (buckets[cc] || 0) + amt;
        };
        const lines: { label: string; native: string; usd: number }[] = [];

        // Opening balances
        let obTotal = 0;
        for (const s of suppliersList as any[]) {
          if (!groupIds.includes(s.id)) continue;
          const ob = parseFloat(s.openingBalance || "0");
          if (ob !== 0) {
            add("USD", ob);
            obTotal += ob;
          }
        }
        if (obTotal !== 0) lines.push({ label: "Opening Balance", native: `$${obTotal.toFixed(2)}`, usd: obTotal });

        // Containers: goods + freight per currency + USD commission from children
        // Always use totalKg (declared/agreed weight) — weight differences at offload affect
        // inventory only, not what is owed to the supplier. Matches buildBrokerStatement.
        const containersByCurrency: Record<string, number> = {};
        let commTotal = 0;
        let usdFreightTotal = 0;
        for (const c of allContainersF as any[]) {
          if (!groupIds.includes(c.supplierId)) continue;
          const cc = c.currencyCode || "USD";
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const goodsAmt = kg * rate;
          add(cc, goodsAmt);
          containersByCurrency[cc] = (containersByCurrency[cc] || 0) + goodsAmt;

          const freight = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || cc;
          if (freight > 0) {
            add(freightCc, freight);
            containersByCurrency[freightCc] = (containersByCurrency[freightCc] || 0) + freight;
          }

          // Commission: include when this container's commission is designated for the broker.
          // Matches buildBrokerStatement: commissionSupplierId === brokerId OR null (default).
          const commSupplierId = c.commissionSupplierId ?? null;
          const commForBroker = commSupplierId === brokerId || commSupplierId === null;
          if (c.supplierId !== brokerId && commForBroker) {
            const commAmt = parseFloat(c.commissionAmount || "0");
            if (commAmt > 0 && (c.commissionCurrencyCode || "USD") === "USD") {
              add("USD", commAmt);
              commTotal += commAmt;
              usdFreightTotal += 0;
            }
          }
        }
        for (const [cc, amt] of Object.entries(containersByCurrency)) {
          if (Math.abs(amt) > 0.01)
            lines.push({
              label: `Container Goods + Freight (${cc})`,
              native: `${amt.toFixed(2)} ${cc}`,
              usd: cc === "USD" ? amt : 0,
            });
        }
        if (commTotal > 0)
          lines.push({ label: "Commission from Linked Suppliers", native: `$${commTotal.toFixed(2)}`, usd: commTotal });

        // Offload additional charges (match buildBrokerStatement)
        const offloadByCurrency: Record<string, number> = {};
        for (const oc of allOffloadChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || "USD";
          const amt = parseFloat(oc.amount || "0");
          add(cc, amt);
          offloadByCurrency[cc] = (offloadByCurrency[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(offloadByCurrency)) {
          if (amt > 0.01)
            lines.push({
              label: `Offload Additional Charges (${cc})`,
              native: `${amt.toFixed(2)} ${cc}`,
              usd: cc === "USD" ? amt : 0,
            });
        }

        // Container other charges table (linked via containerId → supplierId)
        const containerOcByCurrency: Record<string, number> = {};
        for (const oc of allContainerOtherChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || oc.containerCurrencyCode || "USD";
          const amt = parseFloat(oc.amount || "0");
          add(cc, amt);
          containerOcByCurrency[cc] = (containerOcByCurrency[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(containerOcByCurrency)) {
          if (amt > 0.01)
            lines.push({
              label: `Container Other Charges (${cc})`,
              native: `${amt.toFixed(2)} ${cc}`,
              usd: cc === "USD" ? amt : 0,
            });
        }

        // Container column other_charges (otherChargesSupplierId in group)
        const colOcByCurrency: Record<string, number> = {};
        for (const oc of allColOtherChargesF as any[]) {
          if (!groupIds.includes(oc.otherChargesSupplierId)) continue;
          const cc = oc.otherChargesCurrencyCode || "USD";
          const amt = parseFloat(oc.otherCharges || "0");
          add(cc, amt);
          colOcByCurrency[cc] = (colOcByCurrency[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(colOcByCurrency)) {
          if (amt > 0.01)
            lines.push({
              label: `Other Charges — Column (${cc})`,
              native: `${amt.toFixed(2)} ${cc}`,
              usd: cc === "USD" ? amt : 0,
            });
        }

        // Direct payments
        const payTotal: Record<string, number> = {};
        for (const p of allPaymentsF as any[]) {
          if (!groupIds.includes(p.supplierId)) continue;
          const cc = p.currencyCode || "USD";
          const amt = parseFloat(p.amount || "0");
          add(cc, -amt);
          payTotal[cc] = (payTotal[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(payTotal)) {
          if (amt > 0.01)
            lines.push({
              label: `Payments Made (${cc})`,
              native: `-${amt.toFixed(2)} ${cc}`,
              usd: cc === "USD" ? -amt : 0,
            });
        }

        // Voucher payments
        const voucherTotals: Record<string, number> = {};
        for (const sid of groupIds) {
          const currMap = voucherPaidByCurrencyBySupplierId[sid] || {};
          for (const [cc, amt] of Object.entries(currMap)) {
            add(cc, -amt);
            voucherTotals[cc] = (voucherTotals[cc] || 0) + amt;
          }
        }
        for (const [cc, amt] of Object.entries(voucherTotals)) {
          if (amt > 0.01)
            lines.push({
              label: `Voucher Payments (${cc})`,
              native: `-${amt.toFixed(2)} ${cc}`,
              usd: cc === "USD" ? -amt : 0,
            });
        }

        // FX transfers
        let fxInTotal = 0;
        let fxOutUsd = 0;
        const fxOutNative: Record<string, number> = {};
        for (const t of allFxTransfersF as any[]) {
          const fromCc = t.fromCurrencyCode || "USD";
          const fromAmt = parseFloat(t.fromAmount || "0");
          const toUsd = parseFloat(t.toAmountUsd || "0");
          const isFromBroker = t.fromSupplierId === brokerId;
          if (groupIds.includes(t.fromSupplierId) && fromCc !== "USD") {
            add(fromCc, -fromAmt);
            fxOutNative[fromCc] = (fxOutNative[fromCc] || 0) + fromAmt;
          }
          if (t.toSupplierId === brokerId) {
            add("USD", toUsd);
            fxInTotal += toUsd;
          }
          if (isFromBroker && fromCc === "USD") {
            add("USD", -fromAmt);
            fxOutUsd += fromAmt;
          }
        }
        if (fxInTotal > 0)
          lines.push({ label: "FX Received (USD)", native: `$${fxInTotal.toFixed(2)}`, usd: fxInTotal });
        if (fxOutUsd > 0)
          lines.push({ label: "FX Sent Out (USD)", native: `-$${fxOutUsd.toFixed(2)}`, usd: -fxOutUsd });
        for (const [cc, amt] of Object.entries(fxOutNative)) {
          if (amt > 0.01) lines.push({ label: `FX Converted Out (${cc})`, native: `-${amt.toFixed(2)} ${cc}`, usd: 0 });
        }

        const usdBal = buckets["USD"] || 0;
        const nonUsdEntries = Object.entries(buckets).filter(([cc]) => cc !== "USD");
        let nonUsdTotal = 0;
        for (const [cc, val] of nonUsdEntries) {
          if (Math.abs(val) > 0.01) {
            const fx = getConfigFx(cc);
            lines.push({
              label: `${cc} Net Balance × ${fx.toFixed(4)}`,
              native: `${val.toFixed(2)} ${cc}`,
              usd: val * fx,
            });
            nonUsdTotal += val * fx;
          }
        }
        lines.push({ label: "USD Net Balance", native: `$${usdBal.toFixed(2)}`, usd: usdBal });

        const total = usdBal + nonUsdTotal;
        return { total, breakdown: lines };
      };

      const supplierItems: {
        name: string;
        balanceUsd: number;
        breakdown?: { label: string; native: string; usd: number }[];
      }[] = [];
      let totalSupplierLiabilities = 0;
      let totalSupplierOverpayments = 0;

      // Track which broker entries have already been added (avoid duplicates)
      const processedBrokers = new Set<number>();

      for (const s of suppliersList as any[]) {
        // Linked suppliers: their balances are rolled into their parent broker — skip individually
        if (linkedSupplierParent.has(s.id)) continue;

        // Brokers: use buildBrokerStatement (same function as Suppliers page) for exact parity
        if (brokerIds.has(s.id) && !processedBrokers.has(s.id)) {
          processedBrokers.add(s.id);
          const stmt = await buildBrokerStatement(s.id, companyId, true);
          if (!stmt) continue;
          let brokerUsd = 0;
          for (const ledger of stmt.currencyLedgers as any[]) {
            const cc = ledger.currencyCode as string;
            const bal = parseFloat(ledger.netBalance || "0");
            brokerUsd += cc === "USD" ? bal : bal * getConfigFx(cc);
          }
          const rounded = round2(brokerUsd);
          if (Math.abs(rounded) > 0.01) {
            supplierItems.push({ name: s.name, balanceUsd: rounded });
            if (rounded > 0) totalSupplierLiabilities += rounded;
            else totalSupplierOverpayments += Math.abs(rounded);
          }
          continue;
        }

        // Standalone (non-broker) suppliers: native-bucket approach — exact match to
        // computeStats / Suppliers page. Accumulate all transactions in their native
        // currency, multiply each bucket by the configured rate once at the end.
        const byCurrencyNative: Record<string, number> = {};
        const addNative = (cc: string, amt: number) => {
          byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) + amt;
        };

        // Opening balance (always USD-denominated)
        const ob = parseFloat(s.openingBalance || "0");
        if (ob !== 0) addNative("USD", ob);

        // Containers: goods + freight + commission (native currency each)
        const sc = allContainersF.filter((c: any) => c.supplierId === s.id);
        for (const c of sc) {
          const cc = c.currencyCode || "USD";
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          addNative(cc, kg * rate);
          const freight = parseFloat(c.freight || "0");
          if (freight > 0) {
            const fcc = c.freightCurrencyCode || cc;
            addNative(fcc, freight);
          }
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt > 0) {
            const commCc = c.commissionCurrencyCode || cc;
            addNative(commCc, commAmt);
          }
        }

        // Column-level other charges (otherCharges / otherChargesSupplierId on containers)
        for (const oc of allColOtherChargesF as any[]) {
          if (oc.otherChargesSupplierId !== s.id) continue;
          const ocAmt = parseFloat(oc.otherCharges || "0");
          if (ocAmt <= 0) continue;
          addNative(oc.otherChargesCurrencyCode || "USD", ocAmt);
        }

        // Direct payments — use native amount (p.amount), not p.amountUsd
        for (const p of allPaymentsF as any[]) {
          if (p.supplierId !== s.id) continue;
          addNative(p.currencyCode || "USD", -parseFloat(p.amount || "0"));
        }

        // Voucher payments — native amounts per currency
        const voucherCurrMap = voucherPaidByCurrencyBySupplierId[s.id] || {};
        for (const [cc, amt] of Object.entries(voucherCurrMap)) {
          addNative(cc, -(amt as number));
        }

        // FX transfers — subtract native from-currency, credit USD to USD bucket
        for (const t of allFxTransfersF as any[]) {
          if (t.fromSupplierId === s.id) {
            addNative(t.fromCurrencyCode || "USD", -parseFloat(t.fromAmount || "0"));
          }
          if (t.toSupplierId === s.id) {
            addNative("USD", parseFloat(t.toAmountUsd || "0"));
          }
        }

        // Balance: each currency bucket × configured rate (same formula as computeStats)
        const balance = round2(
          Object.entries(byCurrencyNative).reduce((sum, [cc, native]) => {
            return sum + native * getConfigFx(cc);
          }, 0)
        );

        if (Math.abs(balance) > 0.01) {
          supplierItems.push({ name: s.name, balanceUsd: balance });
          if (balance > 0) totalSupplierLiabilities += balance;
          else totalSupplierOverpayments += Math.abs(balance);
        }
      }

      // ── 2. ERP ledger account balances for the factory company ──────────
      const factoryAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));

      const factoryVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt),
            lte(vouchers.voucherDate, asOf)
          )
        );

      const fVoucherIds = factoryVouchers.map((v: any) => v.id);
      const factoryEntries =
        fVoucherIds.length > 0
          ? await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, fVoucherIds))
          : [];

      const accBalances = new Map<number, { debit: number; credit: number }>();
      for (const e of factoryEntries as any[]) {
        if (!e.ledgerAccountId) continue;
        const cur = accBalances.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
        accBalances.set(e.ledgerAccountId, {
          debit: cur.debit + parseFloat(e.debitAmount || "0"),
          credit: cur.credit + parseFloat(e.creditAmount || "0"),
        });
      }

      // ── 2b. Classify accounts using the shared ERP formula ─────────────────
      // Factory-specific clearing/cost codes must not appear in net position:
      //   FACTORY_IMPORT_COST   – Dr side of goods-received journal; liability already in supplier balances
      //   FACTORY_CHARGES_PAYABLE – Dr side of other-charges journal; cost entry, not an asset
      //   FREIGHT / OC_OTHER_CHARGE – factory cost clearing codes
      const factoryExcludedCodes = new Set([
        "FACTORY_IMPORT_COST",
        "FACTORY_CHARGES_PAYABLE",
        "FACTORY_OC_EXPENSE",
        "OC_OTHER_CHARGE",
        "PRODUCTION_ADJUSTMENT",
        "CONSUMPTION_EXPENSE",
        "FREIGHT",
      ]);

      const classified = classifyNetPositionAccounts(factoryAccounts as AccountLike[], accBalances, {
        additionalExcludedCodes: factoryExcludedCodes,
        // Supplier-type ledger accounts excluded: factory supplier balances are
        // calculated separately above from factorySuppliers / factoryContainers.
        includeSupplierTypeAccounts: false,
      });

      // ── 2c. Customer balances — ALL customers, authoritative formula ─────────
      // Customer ledger accounts (linked via customers.ledgerAccountId) capture only
      // a subset of the true customer balance: CHARGE-* freight/clearance vouchers.
      // The bulk of the balance lives in customer_orders (FINALIZED grandTotal).
      // To get the correct figure we:
      //   a) exclude customer-owned ledger accounts from the ledger classification, and
      //   b) compute every customer's balance via the same formula as the Customers page.
      const allCustomersForNP = await db
        .select()
        .from(customers)
        .where(and(eq(customers.companyId, companyId), isNull(customers.deletedAt)));

      // Build a set of ledger account IDs owned by customers so we can strip them
      // from the ledger classification output (prevents double-counting).
      const customerLedgerIds = new Set<number>(
        (allCustomersForNP as any[]).filter((c: any) => c.ledgerAccountId).map((c: any) => c.ledgerAccountId as number)
      );

      // Strip customer-linked accounts from the classifier output.
      const ledgerForUs = classified.forUsAccounts.filter((a: any) => !customerLedgerIds.has(a.id));
      const ledgerOnUsRaw = classified.onUsAccounts.filter((a: any) => !customerLedgerIds.has(a.id));

      // ── Strip any ledger-based "Payroll Payable" accounts ─────────────────────
      // The authoritative source for payroll payable is employees.currentBalance
      // (tracked directly via employeeId on voucher entries, not via a ledger account).
      // Any ledger account named/coded as "Payroll Payable" duplicates that and
      // must be excluded here — the single correct figure is injected below.
      const ledgerOnUs = ledgerOnUsRaw.filter((a: any) => {
        const nameLower = (a.name || "").toLowerCase();
        const code = (a.code || "").toUpperCase();
        const isPayrollPayable =
          nameLower.includes("payroll payable") || code === "PAYROLL_PAYABLE" || code === "PAY_PAYABLE";
        // Exclude ledger-based rent payable — the computed rentPayable (expected − paid
        // up to asOf) is always more accurate than the accrual-scheduler-dependent ledger account.
        const isAccruedRentPayable =
          nameLower.includes("accrued rent") || code === "ACCR-RENT-PAY" || code === "ACCRUED_RENT_PAYABLE";
        return !isPayrollPayable && !isAccruedRentPayable;
      });
      const ledgerForUsTotal = round2(ledgerForUs.reduce((s: number, a: any) => s + a.value, 0));
      const ledgerOnUsTotal = round2(ledgerOnUs.reduce((s: number, a: any) => s + a.value, 0));

      const customerItems: { name: string; balanceUsd: number; ledgerAccountId?: number }[] = [];

      if ((allCustomersForNP as any[]).length > 0) {
        const cIds = (allCustomersForNP as any[]).map((c: any) => c.id);
        const custLedgerIds = [...customerLedgerIds];

        // ── Customer balance formula — mirrors GET /api/factory/customers exactly ──
        // 1. Net of ALL customerBalances rows (includes INVOICE type as stored).
        const cCbNetRows = await db
          .select({
            customerId: customerBalances.customerId,
            net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
          })
          .from(customerBalances)
          .where(
            and(
              inArray(customerBalances.customerId, cIds),
              eq(customerBalances.companyId, companyId),
              lte(customerBalances.transactionDate, asOf)
            )
          )
          .groupBy(customerBalances.customerId);

        const cCbNetMap = new Map(cCbNetRows.map((r: any) => [r.customerId, parseFloat(r.net || "0")]));

        // 2. Correction for INVOICE rows: replace stored debitAmount with live grandTotal
        //    of FINALIZED orders — identical to the statement correction on the Customers page.
        const cInvCorrRows = await db
          .select({
            customerId: customerBalances.customerId,
            correction: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric) - CAST(${customerBalances.debitAmount} AS numeric)), 0)`,
          })
          .from(customerBalances)
          .innerJoin(
            customerOrders,
            and(
              eq(customerOrders.id, customerBalances.referenceId as any),
              eq(customerOrders.companyId, companyId),
              eq(customerOrders.status, "FINALIZED"),
              lte(customerOrders.orderDate, asOf)
            )
          )
          .where(
            and(
              inArray(customerBalances.customerId, cIds),
              eq(customerBalances.companyId, companyId),
              sql`${customerBalances.referenceType} = 'INVOICE'`,
              lte(customerBalances.transactionDate, asOf)
            )
          )
          .groupBy(customerBalances.customerId);

        const cInvCorrMap = new Map(cInvCorrRows.map((r: any) => [r.customerId, parseFloat(r.correction || "0")]));

        // 3. Voucher entries via ledgerAccountId — EXCLUDE CHARGE-* AND INV-* (matches Customers page).
        const cLedgerVoucherRows =
          custLedgerIds.length > 0
            ? await db
                .select({
                  ledgerAccountId: voucherEntries.ledgerAccountId,
                  net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(voucherEntries)
                .innerJoin(
                  vouchers,
                  and(
                    eq(voucherEntries.voucherId, vouchers.id),
                    eq(vouchers.companyId, companyId),
                    sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
                    sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`,
                    lte(vouchers.voucherDate, asOf)
                  )
                )
                .where(inArray(voucherEntries.ledgerAccountId as any, custLedgerIds))
                .groupBy(voucherEntries.ledgerAccountId)
            : [];
        const cLedgerVoucherMap = new Map(
          (cLedgerVoucherRows as any[]).map((r: any) => [r.ledgerAccountId, parseFloat(r.net || "0")])
        );

        // 4. Voucher entries directly linked via customerId — EXCLUDE CHARGE-* AND INV-* (matches Customers page).
        const cVoucherRows = await db
          .select({
            customerId: voucherEntries.customerId,
            net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
          })
          .from(voucherEntries)
          .innerJoin(
            vouchers,
            and(
              eq(voucherEntries.voucherId, vouchers.id),
              eq(vouchers.companyId, companyId),
              sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
              sql`${vouchers.voucherNumber} NOT LIKE 'INV-%'`,
              lte(vouchers.voucherDate, asOf)
            )
          )
          .where(and(inArray(voucherEntries.customerId as any, cIds), isNull(voucherEntries.ledgerAccountId)))
          .groupBy(voucherEntries.customerId);

        const cVoucherMap = new Map((cVoucherRows as any[]).map((r: any) => [r.customerId, parseFloat(r.net || "0")]));

        for (const c of allCustomersForNP as any[]) {
          const cbNet = cCbNetMap.get(c.id) ?? 0;
          const invCorr = cInvCorrMap.get(c.id) ?? 0;
          const ledgerVoucherNet = c.ledgerAccountId ? (cLedgerVoucherMap.get(c.ledgerAccountId) ?? 0) : 0;
          const directVoucherNet = cVoucherMap.get(c.id) ?? 0;
          const voucherNet = ledgerVoucherNet + directVoucherNet;
          const opening = parseFloat(c.openingBalance || "0");
          const openingSide = c.openingBalanceSide || "Dr";
          const totalBalance = (openingSide === "Dr" ? opening : -opening) + cbNet + invCorr + voucherNet;
          if (Math.abs(totalBalance) > 0.01) {
            customerItems.push({
              name: c.legalName || c.name || `Customer #${c.id}`,
              balanceUsd: round2(totalBalance),
              ledgerAccountId: c.ledgerAccountId || undefined,
            });
          }
        }
      }

      // ── 3. Inventory (Stock In Hand) — direct SQL sum of production price ──────
      // Single query: sum production_price for every IN_STOCK bale that has a
      // matched product, scoped strictly to companyId.
      // Production price (cost to manufacture) is used here, not selling price.
      //
      // Must exclude "stale" IN_STOCK bales — bales still marked IN_STOCK in the
      // DB but whose order was actually FINALIZED/DISPATCHED/SOLD (status never
      // got updated). Location Inventory and Bale Ledger already exclude these;
      // without the same exclusion here, Stock In Hand is inflated and drifts
      // out of sync with what Location Inventory shows.
      //
      // Must ALSO exclude bales tied to an order that's currently LOADING /
      // PENDING_VERIFICATION / VERIFIED. Location Inventory's Cost Value KPI
      // subtracts these ("loadingCount") from its total, and they're already
      // counted separately here as "Loading Orders" / "Verified Orders" /
      // "Pending Orders" receivables — leaving them in Stock In Hand as well
      // double-counts them.
      const invResult = await db.execute(sql`
        SELECT COALESCE(SUM(p.production_price::numeric), 0) AS total
        FROM   factory_bales   b
        JOIN   factory_bale_products p ON p.id = b.product_id
        WHERE  b.company_id = ${companyId}
          AND  b.status     = 'IN_STOCK'
          AND  p.company_id = ${companyId}
          AND  NOT EXISTS (
            SELECT 1 FROM customer_order_bales cob
            INNER JOIN customer_orders co ON co.id = cob.order_id
            WHERE cob.bale_id = b.id
              AND co.status IN ('FINALIZED', 'DISPATCHED', 'SOLD')
              AND co.company_id = ${companyId}
          )
          AND  NOT EXISTS (
            SELECT 1 FROM customer_order_bales cob
            INNER JOIN customer_orders co ON co.id = cob.order_id
            WHERE cob.bale_id = b.id
              AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
              AND co.company_id = ${companyId}
          )
      `);
      const invRow = ((invResult as any).rows ?? (invResult as any))[0] ?? {};
      const inventorySellValue = round2(parseFloat(String(invRow?.total ?? "0")));

      // ── 3b. Raw material stock value — direct SQL, mirrors /api/factory/raw-stock
      const rawResult = await db.execute(sql`
        SELECT
          fc.supplier_id,
          SUM(frs.received_kg::numeric)                                            AS total_recv,
          SUM(frs.used_kg::numeric)                                                AS total_used,
          SUM(frs.received_kg::numeric *
              COALESCE(NULLIF(frs.cost_per_kg_usd::numeric, 0), frs.cost_per_kg::numeric, 0))
            / NULLIF(SUM(frs.received_kg::numeric), 0)                             AS avg_cpk_usd
        FROM   factory_raw_stock   frs
        JOIN   factory_containers  fc  ON fc.id  = frs.container_id
        WHERE  frs.company_id = ${companyId}
          AND  fc.status     != 'DELETED'
          AND  frs.deleted_at IS NULL
          AND  fc.deleted_at IS NULL
        GROUP  BY fc.supplier_id
      `);
      const rawRows: any[] = (rawResult as any).rows ?? (rawResult as any);

      const adjResult = await db.execute(sql`
        SELECT supplier_id, type, kg::numeric AS kg, cost_per_kg::numeric AS cpk, material_label
        FROM   factory_raw_material_adjustments
        WHERE  company_id = ${companyId}
          AND  deleted_at IS NULL
      `);
      const adjRows: any[] = (adjResult as any).rows ?? (adjResult as any);

      // Build per-supplier totals (same weighted-average logic as the route)
      type SupMap = { recv: number; used: number; cpkUsd: number };
      const supMap = new Map<string, SupMap>();
      for (const r of rawRows) {
        const key = r.supplier_id ? `s${r.supplier_id}` : `u`;
        const recv = parseFloat(String(r.total_recv ?? "0")) || 0;
        const used = parseFloat(String(r.total_used ?? "0")) || 0;
        const cpkUsd = parseFloat(String(r.avg_cpk_usd ?? "0")) || 0;
        supMap.set(key, { recv, used, cpkUsd });
      }
      for (const a of adjRows) {
        // DEDUCT is history-only — it already reduced received_kg on the underlying
        // factory_raw_stock row directly, so applying it again here (on top of the
        // already-reduced total_recv from rawResult above) would double-subtract it.
        // Mirrors the same skip in /api/factory/raw-stock (rawStockReceiptRoutes.ts).
        if (a.type === "DEDUCT") continue;
        // Manual (no-supplier) adjustments are kept separate per material label, matching
        // /api/factory/raw-stock's `MANUAL__${materialLabel}` bucket keying — collapsing them
        // into a single MANUAL bucket would incorrectly blend distinct materials' weighted costs.
        const key = a.supplier_id ? `s${a.supplier_id}` : `MANUAL__${a.material_label || "unknown"}`;
        const kg = parseFloat(String(a.kg ?? "0")) || 0;
        const cpk = parseFloat(String(a.cpk ?? "0")) || 0;
        const isAdd = a.type === "ADD";
        const ex = supMap.get(key);
        if (ex) {
          if (isAdd) {
            const prevVal = ex.recv * ex.cpkUsd;
            ex.recv += kg;
            ex.cpkUsd = ex.recv > 0 ? (prevVal + kg * cpk) / ex.recv : 0;
          } else {
            ex.used += kg;
          }
        } else if (isAdd) {
          supMap.set(key, { recv: kg, used: 0, cpkUsd: cpk });
        }
      }
      // Sum ALL bucket values (including negative remainders from over-usage/adjustments) —
      // /api/factory/raw-stock's client KPI (ProductionRawStock.tsx totalValue) sums
      // valueRemainingUsd across every row unconditionally, so clamping to positive-only
      // here would overstate the net position total relative to the Raw Materials page.
      let rawTotal = 0;
      for (const s of supMap.values()) {
        rawTotal += (s.recv - s.used) * s.cpkUsd;
      }
      const rawMaterialStockValue = round2(rawTotal);

      // ── 3b. Factory Stock OTW — containers in transit (PENDING / IN_TRANSIT / ARRIVED) ──
      // Per-currency goods+freight+commission+other charges, converted to USD using the
      // user-configured manual FX rates loaded above (getConfigFx / configFxRates — set in
      // Settings → FX Rates, e.g. EUR=1.18, AUD=0.75). This was previously hardcoded
      // (EUR×1.17, AUD×0.75), which drifted from the user's actual configured rates and
      // produced a wrong OTW total on this page.
      const otwStatuses = new Set(["PENDING", "IN_TRANSIT", "ARRIVED"]);
      const otwCurrBuckets: Record<string, number> = {};
      const otwAdd = (cc: string, amt: number) => {
        if (amt > 0 && cc) otwCurrBuckets[cc] = (otwCurrBuckets[cc] || 0) + amt;
      };
      for (const c of allContainersF as any[]) {
        if (!otwStatuses.has(c.status)) continue;
        const containerCcy = c.currencyCode || "USD";
        const goods =
          parseFloat(c.finalPayableAmount || "0") > 0
            ? parseFloat(c.finalPayableAmount)
            : parseFloat(c.ratePerKg || "0") * parseFloat(c.totalKg || "0");
        otwAdd(containerCcy, goods);
        const freightCcy = c.freightCurrencyCode || containerCcy;
        otwAdd(freightCcy, parseFloat(c.freight || "0"));
        const commCcy = c.commissionCurrencyCode || "USD";
        otwAdd(commCcy, parseFloat(c.commissionAmount || "0"));
        otwAdd(containerCcy, parseFloat(c.otherCharges || "0"));
      }
      const stockOtwValue = round2(
        Object.entries(otwCurrBuckets).reduce((sum, [cc, amt]) => {
          const fx = cc === "USD" ? 1 : getConfigFx(cc);
          return sum + amt * fx;
        }, 0)
      );

      // ── 3c. Balance on Table — material in process (mix batch input minus bale output) ──
      // Mirrors the production-value-report formula: all-time totals, no date filter.
      const mixSumResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(total_weight_kg::numeric), 0) AS total_mix_kg,
          COALESCE(SUM(total_cost::numeric),      0) AS total_mix_cost
        FROM factory_mix_batches
        WHERE company_id = ${companyId}
      `);
      const mixSumRow = ((mixSumResult as any).rows ?? (mixSumResult as any))[0] ?? {};
      const totalMixKg = parseFloat(String(mixSumRow.total_mix_kg ?? "0")) || 0;
      const totalMixCost = parseFloat(String(mixSumRow.total_mix_cost ?? "0")) || 0;
      const blendedCpk = totalMixKg > 0 ? totalMixCost / totalMixKg : 0;

      // Split bales: wipers/garbage (by category name) vs regular
      const baleSumResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(b.weight_kg::numeric), 0)                                          AS total_kg,
          COALESCE(SUM(CASE WHEN lower(c.name) ~ '(wiper|garbage|rag)'
                            THEN b.weight_kg::numeric ELSE 0 END), 0)                     AS wg_kg
        FROM   factory_bales        b
        LEFT   JOIN factory_bale_products  p ON p.id = b.product_id
        LEFT   JOIN factory_categories     c ON c.id = p.category_id
        WHERE  b.company_id = ${companyId}
          AND  b.status NOT IN ('DELETED', 'REMOVED')
      `);
      const baleSumRow = ((baleSumResult as any).rows ?? (baleSumResult as any))[0] ?? {};
      const totalBaleKg = parseFloat(String(baleSumRow.total_kg ?? "0")) || 0;
      const totalWgKg = parseFloat(String(baleSumRow.wg_kg ?? "0")) || 0;

      const botWeightKg = totalMixKg - totalBaleKg;
      const balanceOnTableValue = round2(Math.max(botWeightKg, 0) * blendedCpk);

      // ── 4. Pending, Verified & Loading orders (upcoming receivables) ──────────
      // Fetched here (before forUsTotal) so PENDING/VERIFIED totals can be
      // included in "What We Have". LOADING is shown for reference only.
      //
      // No double-counting risk: once an order is PENDING or VERIFIED the
      // bales allocated to it are set to RESERVED_FOR_ORDER status, which
      // means they are already excluded from the IN_STOCK baleInventoryValue.
      const pendingVerifiedRows = await db
        .select({
          id: customerOrders.id,
          status: customerOrders.status,
          orderDate: customerOrders.orderDate,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          customerId: customerOrders.customerId,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .innerJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            inArray(customerOrders.status, ["PENDING_VERIFICATION", "VERIFIED", "LOADING"]),
            lte(customerOrders.orderDate, asOf)
          )
        )
        .orderBy(desc(customerOrders.orderDate));

      const mapOrder = (r: any) => ({
        id: r.id,
        customerName: r.customerName || `Customer #${r.customerId}`,
        orderDate: r.orderDate,
        grandTotal: round2(parseFloat(r.grandTotal || "0")),
        totalQtyBales: r.totalQtyBales ?? 0,
      });

      const pendingOrders = (pendingVerifiedRows as any[])
        .filter((r) => r.status === "PENDING_VERIFICATION")
        .map(mapOrder);
      const verifiedOrders = (pendingVerifiedRows as any[]).filter((r) => r.status === "VERIFIED").map(mapOrder);
      const loadingOrders = (pendingVerifiedRows as any[]).filter((r) => r.status === "LOADING").map(mapOrder);

      const pendingTotal = round2(pendingOrders.reduce((s, o) => s + o.grandTotal, 0));
      const verifiedTotal = round2(verifiedOrders.reduce((s, o) => s + o.grandTotal, 0));
      const loadingTotal = round2(loadingOrders.reduce((s, o) => s + o.grandTotal, 0));

      // ── 5. Combine and return ────────────────────────────────────────────
      // Rename for clarity — these are the two factory-specific values.
      const baleInventoryValue = round2(inventorySellValue);

      // Guard: strip any ledger account whose category could collide with our
      // factory-injected "Inventory" / "Stock" entries.  Accounts with type
      // "Inventory" bypass the name-pattern exclusion in classifyNetPositionAccounts
      // (that guard only runs for types in assetAccountTypes).  Removing them
      // here guarantees ONE source of truth for both factory values.
      const inventoryCategoryRx = /inventory|stock in hand|stock on hand|raw material/i;
      const cleanLedgerForUs = ledgerForUs.filter(
        (a) => !inventoryCategoryRx.test(a.category) && !inventoryCategoryRx.test(a.name)
      );
      const cleanLedgerForUsTotal = round2(cleanLedgerForUs.reduce((s, a) => s + a.value, 0));

      // ── Split customer items into DR (asset) and CR (liability) ──────────────
      const customerDrItems = customerItems.filter((c) => c.balanceUsd > 0);
      const customerCrItems = customerItems.filter((c) => c.balanceUsd < 0);
      const totalCustomerDr = round2(customerDrItems.reduce((s, c) => s + c.balanceUsd, 0));
      const totalCustomerCr = round2(customerCrItems.reduce((s, c) => s + Math.abs(c.balanceUsd), 0));

      // ── Rental (company is the TENANT paying rent) ───────────────────────────
      // paid > expected → we overpaid our landlord → prepaid rent asset → For Us
      // expected > paid → we still owe the landlord → rent payable → On Us
      let prepaidRent = 0;
      let rentPayable = 0;
      {
        const activeContracts = await db
          .select({ id: propertyContracts.id })
          .from(propertyContracts)
          .where(and(eq(propertyContracts.companyId, companyId), eq(propertyContracts.status, "ACTIVE")));
        if (activeContracts.length > 0) {
          const contractIds = activeContracts.map((c) => c.id);
          // Expected: months on or before the asOf date
          const expectedRows = await db
            .select({
              contractId: propertyMonthlyLedger.contractId,
              expected: sql<string>`COALESCE(SUM(
              CASE WHEN (
                ${propertyMonthlyLedger.year} < EXTRACT(YEAR FROM ${asOf}::date)
                OR (
                  ${propertyMonthlyLedger.year} = EXTRACT(YEAR FROM ${asOf}::date)
                  AND ${propertyMonthlyLedger.month} <= EXTRACT(MONTH FROM ${asOf}::date)
                )
              ) THEN CAST(${propertyMonthlyLedger.expectedAmount} AS numeric) ELSE 0 END
            ), 0)`,
            })
            .from(propertyMonthlyLedger)
            .where(inArray(propertyMonthlyLedger.contractId, contractIds))
            .groupBy(propertyMonthlyLedger.contractId);
          // Paid: only payments made on or before asOf
          const paidRows = await db
            .select({
              contractId: propertyPayments.contractId,
              paid: sql<string>`COALESCE(SUM(CAST(${propertyPayments.amount} AS numeric)), 0)`,
            })
            .from(propertyPayments)
            .where(and(inArray(propertyPayments.contractId, contractIds), lte(propertyPayments.paymentDate, asOf)))
            .groupBy(propertyPayments.contractId);
          const paidMap = new Map(paidRows.map((r) => [r.contractId, parseFloat(r.paid)]));
          for (const row of expectedRows) {
            const expected = parseFloat(row.expected);
            const paid = paidMap.get(row.contractId) ?? 0;
            const net = paid - expected; // positive = overpaid
            if (net > 0)
              prepaidRent += net; // we overpaid → asset
            else if (net < 0) rentPayable += -net; // we underpaid → liability
          }
          prepaidRent = round2(prepaidRent);
          rentPayable = round2(rentPayable);
        }
      }


      // forUsTotal: ledger assets + inventory + raw material + balance on table + stock OTW
      //             + customer receivables (DR) + pending orders + verified orders + loading orders
      //             + overpaid suppliers (they owe us the overpayment back)
      //             + prepaidRent (we overpaid our landlord → asset)
      //             (bales are reserved/excluded from baleInventoryValue — no double-count)
      const totalSupplierOverpaymentsRounded = round2(totalSupplierOverpayments);
      const forUsTotal = round2(
        cleanLedgerForUsTotal +
          baleInventoryValue +
          rawMaterialStockValue +
          balanceOnTableValue +
          stockOtwValue +
          totalCustomerDr +
          pendingTotal +
          verifiedTotal +
          loadingTotal +
          totalSupplierOverpaymentsRounded +
          prepaidRent
      );
      // ── Employee Salaries Payable — directly from employees.currentBalance ───────
      // Employee balances are tracked via employees.currentBalance (not through a
      // "Payroll Payable" ledger account), so we inject them here explicitly.
      const allEmployeesForNP = await db
        .select({ currentBalance: employees.currentBalance })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            eq(employees.employeeType, "Employee"),
            eq(employees.active, true),
            isNull(employees.deletedAt)
          )
        );
      let employeeSalariesPayable = 0;
      for (const emp of allEmployeesForNP) {
        const bal = parseFloat(emp.currentBalance || "0");
        if (bal > 0) employeeSalariesPayable += bal;
      }
      employeeSalariesPayable = round2(employeeSalariesPayable);

      // onUsTotal: ledger liabilities + supplier balances + customer credit balances (CR) + employee salaries + rent payable
      const onUsTotal = round2(
        ledgerOnUsTotal + totalSupplierLiabilities + totalCustomerCr + employeeSalariesPayable + rentPayable
      );
      const netPosition = round2(forUsTotal - onUsTotal);

      // Inject factory-specific lines explicitly (always present so the UI
      // always has a named row for both even when the value is 0).
      const factoryInventoryEntry = {
        name: "Stock In Hand (Inventory)",
        code: "INVENTORY",
        value: baleInventoryValue,
        category: "Inventory",
      };
      const factoryRawMaterialEntry = {
        name: "Factory Raw Material Stock",
        code: "RAW_MATERIAL",
        value: rawMaterialStockValue,
        category: "Raw Material",
      };
      const factoryBalanceOnTableEntry = {
        name: "Balance on Table",
        code: "BALANCE_ON_TABLE",
        value: balanceOnTableValue,
        category: "Production",
      };
      const factoryStockOtwEntry = {
        name: "Factory Stock OTW",
        code: "STOCK_OTW",
        value: stockOtwValue,
        category: "Stock OTW",
      };

      const forUsAccounts = [
        factoryInventoryEntry,
        factoryRawMaterialEntry,
        ...(balanceOnTableValue > 0 ? [factoryBalanceOnTableEntry] : []),
        ...(stockOtwValue > 0 ? [factoryStockOtwEntry] : []),
        ...cleanLedgerForUs.sort((a, b) => b.value - a.value).map((a) => ({ ...a, value: round2(a.value) })),
        ...customerDrItems
          .sort((a, b) => b.balanceUsd - a.balanceUsd)
          .map((c) => ({
            ...(c.ledgerAccountId ? { id: c.ledgerAccountId } : {}),
            name: c.name,
            code: "CUSTOMER_DR",
            value: round2(c.balanceUsd),
            category: "Customer",
          })),
        // Overpaid suppliers: they owe us the excess back — show as an asset
        ...supplierItems
          .filter((s) => s.balanceUsd < 0)
          .sort((a, b) => a.balanceUsd - b.balanceUsd)
          .map((s) => ({
            name: s.name,
            code: "SUPPLIER_OVERPAID",
            value: round2(Math.abs(s.balanceUsd)),
            category: "Supplier Overpayments",
            breakdown: s.breakdown,
          })),
        ...(pendingTotal > 0
          ? [{ name: "Pending Orders", code: "PENDING_ORDERS", value: pendingTotal, category: "Pending Orders" }]
          : []),
        ...(verifiedTotal > 0
          ? [{ name: "Verified Orders", code: "VERIFIED_ORDERS", value: verifiedTotal, category: "Verified Orders" }]
          : []),
        ...(loadingTotal > 0
          ? [{ name: "Loading Orders", code: "LOADING_ORDERS", value: loadingTotal, category: "Loading Orders" }]
          : []),
        ...(prepaidRent > 0
          ? [{ name: "Prepaid Rent", code: "PREPAID_RENT", value: prepaidRent, category: "Prepaid Rent" }]
          : []),
      ];

      // Group ledger on-us by category
      const ledgerOnUsGrouped: Record<string, number> = {};
      for (const a of ledgerOnUs) {
        ledgerOnUsGrouped[a.category] = (ledgerOnUsGrouped[a.category] || 0) + a.value;
      }

      const onUsAccounts: {
        name: string;
        code: string;
        value: number;
        category: string;
        breakdown?: { label: string; native: string; usd: number }[];
      }[] = [
        ...supplierItems
          .filter((s) => s.balanceUsd > 0)
          .sort((a, b) => b.balanceUsd - a.balanceUsd)
          .map((s) => ({
            name: s.name,
            code: "SUPPLIER",
            value: round2(s.balanceUsd),
            category: "Supplier",
            breakdown: s.breakdown,
          })),
        ...ledgerOnUs.sort((a, b) => b.value - a.value).map((a) => ({ ...a, value: round2(a.value) })),
        {
          name: "Payroll Payable",
          code: "EMPLOYEE_PAYROLL_PAYABLE",
          value: employeeSalariesPayable,
          category: "Liability",
        },
        ...customerCrItems
          .sort((a, b) => Math.abs(b.balanceUsd) - Math.abs(a.balanceUsd))
          .map((c) => ({
            ...(c.ledgerAccountId ? { id: c.ledgerAccountId } : {}),
            name: c.name,
            code: "CUSTOMER_CR",
            value: round2(Math.abs(c.balanceUsd)),
            category: "Customer",
          })),
        ...(rentPayable > 0
          ? [{ name: "Rent Payable", code: "RENT_PAYABLE", value: rentPayable, category: "Rent Payable" }]
          : []),
      ];

      const forUsBreakdown = Object.entries(
        forUsAccounts.reduce((m: Record<string, number>, a) => {
          m[a.category] = (m[a.category] || 0) + a.value;
          return m;
        }, {})
      )
        .map(([name, value]) => ({ name, value: round2(value) }))
        .sort((a, b) => b.value - a.value);

      // Merge employee salaries payable into the "Liability" category in the breakdown
      // employeeSalariesPayable is always the authoritative Payroll Payable figure
      const mergedLedgerOnUsGrouped = { ...ledgerOnUsGrouped };
      mergedLedgerOnUsGrouped["Liability"] = round2(
        (mergedLedgerOnUsGrouped["Liability"] || 0) + employeeSalariesPayable
      );
      const onUsBreakdown = [
        ...(totalSupplierLiabilities > 0 ? [{ name: "Suppliers", value: round2(totalSupplierLiabilities) }] : []),
        ...Object.entries(mergedLedgerOnUsGrouped)
          .map(([name, value]) => ({ name, value: round2(value) }))
          .sort((a, b) => b.value - a.value),
        ...(totalCustomerCr > 0 ? [{ name: "Customer", value: totalCustomerCr }] : []),
        ...(rentPayable > 0 ? [{ name: "Rent Payable", value: rentPayable }] : []),
      ];

      res.json({
        asOf,
        forUsTotal,
        onUsTotal,
        netPosition,
        netPositionLabel: netPosition >= 0 ? "We have more than we owe" : "We owe more than we have",
        forUs: { total: forUsTotal, breakdown: forUsBreakdown, accounts: forUsAccounts },
        onUs: { total: onUsTotal, breakdown: onUsBreakdown, accounts: onUsAccounts },
        supplierLiabilities: round2(totalSupplierLiabilities),
        supplierOverpayments: round2(totalSupplierOverpayments),
        inventoryValue: baleInventoryValue,
        rawMaterialValue: rawMaterialStockValue,
        balanceOnTableValue: balanceOnTableValue,
        ledgerAssets: cleanLedgerForUsTotal,
        pendingOrders,
        verifiedOrders,
        loadingOrders,
        pendingTotal,
        verifiedTotal,
        loadingTotal,
        ledgerLiabilities: round2(ledgerOnUsTotal),
        payrollPayable: employeeSalariesPayable,
      });
    } catch (error: any) {
      console.error("Factory net-position error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Payroll Payable Breakdown (view-only, for Net Position page) ────────────
  // GET /api/factory/net-position/payroll-breakdown
  // Returns one row per active employee whose currentBalance > 0.
  // This endpoint is purely informational and does NOT affect any Net Position
  // calculation, account, or balance — it is read-only.
}
