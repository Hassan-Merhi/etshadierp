import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import { sqlArray } from "../../../lib/sqlArray";
import { resolveStoredFxRate } from "../../../services/factory/currencyConversion";
// Resolves a display/aggregate FX rate for the with-balances summary: prefers the
// user-configured company rate, then the row's own confirmed rate; returns 0 (never a
// silent 1) when neither is available, so that currency's contribution to the USD total
// is excluded rather than guessed — callers should treat a 0 result as "unresolved".
function resolveDisplayFx(
  ccy: string,
  configuredRate: number | undefined,
  storedRate: string | number | null | undefined,
  confirmed?: boolean
): number {
  if (ccy === "USD") return 1;
  if (configuredRate !== undefined) return configuredRate;
  const { fxRate, looksSet } = resolveStoredFxRate(ccy, storedRate, confirmed);
  return looksSet ? fxRate : 0;
}
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
  insertFactorySupplierCategorySchema,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

const PAYABLE_CONTAINER_STATUSES = new Set(["OFFLOADED", "RECEIVED", "PARTIALLY_RECEIVED"]);

const isPayableContainer = (c: any) => PAYABLE_CONTAINER_STATUSES.has(String(c.status || "").toUpperCase());

export async function buildBrokerStatement(brokerId: number, companyId: number, includeOtw = false) {
  // Fetch broker
  const [broker] = await db
    .select()
    .from(factorySuppliers)
    .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
  if (!broker) return null;

  // Linked suppliers
  const linkedRaw = await db
    .select()
    .from(factorySuppliers)
    .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId)));

  const allSuppliers = [broker, ...linkedRaw];
  const allSupplierIds = allSuppliers.map((s: any) => s.id);
  const supplierNameMap: Record<number, string> = {};
  for (const s of allSuppliers) supplierNameMap[(s as any).id] = (s as any).name;

  // Containers — exclude OTW unless caller opts in; always exclude soft-deleted
  const containersWhereClause = includeOtw
    ? and(
        eq(factoryContainers.companyId, companyId),
        inArray(factoryContainers.supplierId, allSupplierIds),
        isNull(factoryContainers.deletedAt)
      )
    : and(
        eq(factoryContainers.companyId, companyId),
        inArray(factoryContainers.supplierId, allSupplierIds),
        isNull(factoryContainers.deletedAt),
        sql`${factoryContainers.status} NOT IN ('PENDING', 'IN_TRANSIT')`
      );
  const allContainers =
    allSupplierIds.length > 0
      ? await db
          .select()
          .from(factoryContainers)
          .where(containersWhereClause)
          .orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt)
      : [];
  // Build a Set of the filtered container IDs so charge queries can be scoped to the same set.
  const filteredContainerIdSet = new Set((allContainers as any[]).map((c: any) => c.id as number));

  // Payments (direct)
  const allPayments =
    allSupplierIds.length > 0
      ? await db
          .select()
          .from(factorySupplierPayments)
          .where(
            and(
              eq(factorySupplierPayments.companyId, companyId),
              inArray(factorySupplierPayments.supplierId, allSupplierIds)
            )
          )
          .orderBy(factorySupplierPayments.date)
      : [];

  // Voucher-based payments (from general accounting, linked via factorySupplierId)
  const allVoucherPayments =
    allSupplierIds.length > 0
      ? await db
          .select({
            id: voucherEntries.id,
            debitAmount: voucherEntries.debitAmount,
            supplierId: voucherEntries.factorySupplierId,
            voucherDate: vouchers.voucherDate,
            description: vouchers.description,
            voucherNumber: vouchers.voucherNumber,
            currency: vouchers.currency,
            optional: vouchers.optional,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              inArray(voucherEntries.factorySupplierId as any, allSupplierIds),
              sql`${voucherEntries.debitAmount}::numeric > 0`,
              sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
            )
          )
          .orderBy(vouchers.voucherDate)
      : [];

  // FX transfers (involving any of the suppliers)
  const allFx =
    allSupplierIds.length > 0
      ? await db
          .select()
          .from(factorySupplierFxTransfers)
          .where(
            and(
              eq(factorySupplierFxTransfers.companyId, companyId),
              sql`(${factorySupplierFxTransfers.fromSupplierId} = ANY(${sqlArray(allSupplierIds)}) OR ${factorySupplierFxTransfers.toSupplierId} = ANY(${sqlArray(allSupplierIds)}))`
            )
          )
          .orderBy(factorySupplierFxTransfers.date)
      : [];

  // Offload additional charges explicitly assigned to any of the broker's suppliers.
  // Only rows where supplierId IS NOT NULL are included — if a charge was posted to a ledger
  // account (loan, payable, etc.) its supplierId is null intentionally and must NOT appear here.
  const allOffloadCharges =
    allSupplierIds.length > 0
      ? await db
          .select({
            id: factoryOffloadAdditionalCharges.id,
            containerId: factoryOffloadAdditionalCharges.containerId,
            description: factoryOffloadAdditionalCharges.description,
            amount: factoryOffloadAdditionalCharges.amount,
            currencyCode: factoryOffloadAdditionalCharges.currencyCode,
            fxRateToUsd: factoryOffloadAdditionalCharges.fxRateToUsd,
            createdAt: factoryOffloadAdditionalCharges.createdAt,
            supplierId: (factoryOffloadAdditionalCharges as any).supplierId,
          })
          .from(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.companyId, companyId),
              sql`${(factoryOffloadAdditionalCharges as any).supplierId} = ANY(${sqlArray(allSupplierIds)})`
            )
          )
          .orderBy(factoryOffloadAdditionalCharges.createdAt)
      : [];

  // Container-level other charges (entered per-container, use charge's own currency first)
  const allContainerOtherCharges =
    allSupplierIds.length > 0
      ? await db
          .select({
            id: factoryContainerOtherCharges.id,
            containerId: factoryContainerOtherCharges.containerId,
            description: factoryContainerOtherCharges.description,
            amount: factoryContainerOtherCharges.amount,
            createdAt: factoryContainerOtherCharges.createdAt,
            supplierId: factoryContainers.supplierId,
            chargeCurrencyCode: factoryContainerOtherCharges.currencyCode,
            containerCurrencyCode: factoryContainers.currencyCode,
            containerNumber: factoryContainers.containerNumber,
          })
          .from(factoryContainerOtherCharges)
          .innerJoin(factoryContainers, eq(factoryContainerOtherCharges.containerId, factoryContainers.id))
          .where(
            and(
              eq(factoryContainerOtherCharges.companyId, companyId),
              inArray(factoryContainers.supplierId, allSupplierIds)
            )
          )
          .orderBy(factoryContainerOtherCharges.createdAt)
      : [];

  type LedgerRow = {
    date: string | null;
    type: "container" | "payment" | "fx_out" | "fx_in" | "commission" | "freight" | "other_charge" | "opening_balance";
    description: string;
    ref: string;
    amount: number;
    commissionAmount: number | null;
    commissionCurrency: string | null;
    isOtw?: boolean;
  };

  const ledgerByCurrency: Record<string, LedgerRow[]> = {};
  const addRow = (cc: string, row: LedgerRow) => {
    if (!ledgerByCurrency[cc]) ledgerByCurrency[cc] = [];
    ledgerByCurrency[cc].push(row);
  };

  // Container rows
  // Always use totalKg (declared/agreed weight) — weight differences at offload affect inventory
  // only, not what is owed to the supplier. This matches computeBalance and computeStats.
  for (const c of allContainers as any[]) {
    const supplierName = supplierNameMap[c.supplierId] || "Unknown";
    const cc = c.currencyCode || "USD";
    const kg = parseFloat(c.totalKg || "0");
    const rate = parseFloat(c.ratePerKg || "0");
    const freight = parseFloat(c.freight || "0");
    // Use freightCurrencyCode directly (DB default is "USD", so AUD containers correctly separate USD freight)
    const freightCc = c.freightCurrencyCode || cc;
    const freightSameCcy = freightCc === cc;
    // Freight is always a separate row — container row shows goods only
    const mainAmt = kg * rate;
    const commAmt = parseFloat(c.commissionAmount || "0");
    const commCc = c.commissionCurrencyCode || "USD";
    const dateVal = c.arrivalDate
      ? String(c.arrivalDate)
      : c.createdAt
        ? new Date(c.createdAt).toISOString().split("T")[0]
        : null;

    addRow(cc, {
      date: dateVal,
      type: "container",
      description: `${c.containerNumber} - ${supplierName}`,
      ref: c.containerNumber,
      amount: mainAmt,
      commissionAmount: null,
      commissionCurrency: null,
      isOtw: c.status === "PENDING" || c.status === "IN_TRANSIT",
    });

    // Cross-currency freight: add as an individual ledger row in the freight currency section
    if (freight > 0 && !freightSameCcy) {
      addRow(freightCc, {
        date: dateVal,
        type: "freight",
        description: `Freight - ${c.containerNumber} (${supplierName})`,
        ref: c.containerNumber,
        amount: freight,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }
    // Same-currency freight: add a separate freight row in the container's currency section
    if (freight > 0 && freightSameCcy) {
      addRow(cc, {
        date: dateVal,
        type: "freight",
        description: `Freight - ${c.containerNumber} (${supplierName})`,
        ref: c.containerNumber,
        amount: freight,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }
    // USD commission from linked (child) suppliers goes directly to the broker's USD ledger,
    // but only when this broker is actually the designated commission recipient.
    // Commission from the broker's own containers and any non-USD commission stay excluded.
    const commSupplierId = c.commissionSupplierId ?? null;
    const commForBroker = commSupplierId === brokerId || commSupplierId === null;
    if (commAmt > 0 && commCc === "USD" && c.supplierId !== brokerId && commForBroker) {
      addRow("USD", {
        date: dateVal,
        type: "commission",
        description: `Commission from ${supplierName} — ${c.containerNumber}`,
        ref: c.containerNumber,
        amount: commAmt,
        commissionAmount: commAmt,
        commissionCurrency: commCc,
      });
    }
  }

  // Payment rows
  for (const p of allPayments as any[]) {
    const supplierName = supplierNameMap[p.supplierId] || "Unknown";
    const cc = p.currencyCode || "USD";
    addRow(cc, {
      date: p.date ? String(p.date) : null,
      type: "payment",
      description: `Payment — ${supplierName}`,
      ref: p.notes || "Payment",
      amount: -parseFloat(p.amount || "0"),
      commissionAmount: null,
      commissionCurrency: null,
    });
  }

  // Voucher-based payment rows (general accounting payments linked to factory suppliers)
  // Skip optional vouchers — they are informational only and don't affect the balance.
  for (const p of allVoucherPayments as any[]) {
    if (p.optional) continue;
    const cc = p.currency || "USD";
    const suppId = p.supplierId;
    const supplierName = suppId ? supplierNameMap[suppId] || "Unknown" : "Unknown";
    addRow(cc, {
      date: p.voucherDate ? String(p.voucherDate) : null,
      type: "payment",
      description: `Payment — ${supplierName}`,
      ref: p.voucherNumber || "Voucher Payment",
      amount: -parseFloat(p.debitAmount || "0"),
      commissionAmount: null,
      commissionCurrency: null,
    });
  }

  // FX transfer rows — deduplicate by id to avoid counting same transfer twice
  // Key logic: Only affect the broker's USD pool for transfers TO/FROM the broker.
  // For internal pool transfers (linked supplier → linked supplier), only show the
  // source-currency leg so each supplier's sub-balance is visible without distorting the pool total.
  // For USD→USD transfers FROM a linked supplier TO the broker, adding both fx_out and fx_in
  // to the USD section used to cancel them to zero — now we only add the correct directional row.
  const seenFxIds = new Set<number>();
  for (const t of allFx as any[]) {
    if (seenFxIds.has(t.id)) continue;
    seenFxIds.add(t.id);
    const fromCc = t.fromCurrencyCode || "USD";
    const fromAmt = parseFloat(t.fromAmount || "0");
    const toUsd = parseFloat(t.toAmountUsd || "0");
    const rate = fromAmt > 0 ? (toUsd / fromAmt).toFixed(4) : "1";
    const dateVal = t.date ? String(t.date) : null;
    const isFromBroker = t.fromSupplierId === brokerId;
    const isToBroker = t.toSupplierId === brokerId;

    // Non-USD source currency leg: always show fx_out in the foreign currency section
    // so the linked supplier's foreign-currency contribution is visible.
    if (fromCc !== "USD") {
      addRow(fromCc, {
        date: dateVal,
        type: "fx_out",
        description: `FX ${fromCc}→USD @ ${rate}`,
        ref: `FX-${t.id}`,
        amount: -fromAmt,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // USD pool: FX In — only when the broker is the recipient.
    // (Linked-supplier-to-linked-supplier USD transfers don't change the broker's pool.)
    if (isToBroker) {
      addRow("USD", {
        date: dateVal,
        type: "fx_in",
        description: `FX In from ${fromCc} @ ${rate}`,
        ref: `FX-${t.id}`,
        amount: toUsd,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // USD pool: FX Out — only when the broker is the sender (broker redistributes USD out).
    if (isFromBroker && fromCc === "USD") {
      addRow("USD", {
        date: dateVal,
        type: "fx_out",
        description: `FX USD out @ ${rate}`,
        ref: `FX-${t.id}`,
        amount: -fromAmt,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }
  }

  // Offload additional charge rows
  // NOTE: do NOT filter by filteredContainerIdSet here. These charges are explicitly assigned
  // to a supplier via supplierId (already filtered at query level), so they belong on that
  // supplier's statement regardless of which supplier owns the container.
  // Post-offload charges can only be added to OFFLOADED containers, so OTW-toggle is irrelevant.
  for (const oc of allOffloadCharges as any[]) {
    const cc = oc.currencyCode || "USD";
    const amt = parseFloat(oc.amount || "0");
    const supplierName = supplierNameMap[oc.supplierId] || "Unknown";
    const dateVal = oc.createdAt ? new Date(oc.createdAt).toISOString().split("T")[0] : null;
    addRow(cc, {
      date: dateVal,
      type: "other_charge",
      description: `${oc.description || "Additional Charge"} — ${supplierName}`,
      ref: `Container ${oc.containerId}`,
      amount: amt,
      commissionAmount: null,
      commissionCurrency: null,
    });
  }

  // Container-level other charge rows (linked via container → supplier)
  for (const oc of allContainerOtherCharges as any[]) {
    // Skip charges tied to OTW containers when toggle is off
    if (oc.containerId != null && !filteredContainerIdSet.has(oc.containerId)) continue;
    const cc = oc.chargeCurrencyCode || oc.containerCurrencyCode || "USD";
    const amt = parseFloat(oc.amount || "0");
    const dateVal = oc.createdAt ? new Date(oc.createdAt).toISOString().split("T")[0] : null;
    addRow(cc, {
      date: dateVal,
      type: "other_charge",
      description: `${oc.description || "Other Charge"} — ${oc.containerNumber || `Container ${oc.containerId}`}`,
      ref: oc.containerNumber || `Container ${oc.containerId}`,
      amount: amt,
      commissionAmount: null,
      commissionCurrency: null,
    });
  }

  // factory_containers.other_charges column where other_charges_supplier_id is in the broker group
  // (distinct from the factoryContainerOtherCharges table which is a separate multi-row charges table)
  const containerColOtherCharges =
    allSupplierIds.length > 0
      ? await db
          .select({
            id: factoryContainers.id,
            containerNumber: factoryContainers.containerNumber,
            otherCharges: factoryContainers.otherCharges,
            otherChargesSupplierId: factoryContainers.otherChargesSupplierId,
            otherChargesCurrencyCode: (factoryContainers as any).otherChargesCurrencyCode,
            containerCurrencyCode: factoryContainers.currencyCode,
            arrivalDate: factoryContainers.arrivalDate,
            createdAt: factoryContainers.createdAt,
            supplierId: factoryContainers.supplierId,
          })
          .from(factoryContainers)
          .where(
            and(
              eq(factoryContainers.companyId, companyId),
              sql`${factoryContainers.otherChargesSupplierId} = ANY(${sqlArray(allSupplierIds)})`,
              sql`${factoryContainers.otherCharges}::numeric > 0`,
              isNull(factoryContainers.deletedAt)
            )
          )
      : [];

  for (const c of containerColOtherCharges as any[]) {
    // Skip charges tied to OTW containers when toggle is off
    if (!filteredContainerIdSet.has(c.id)) continue;
    const cc = c.otherChargesCurrencyCode || "USD";
    const amt = parseFloat(c.otherCharges || "0");
    const chargeSupplierName = supplierNameMap[c.otherChargesSupplierId] || "Unknown";
    const containerSupplierName = supplierNameMap[c.supplierId] || "Unknown";
    const dateVal = c.arrivalDate
      ? String(c.arrivalDate)
      : c.createdAt
        ? new Date(c.createdAt).toISOString().split("T")[0]
        : null;
    addRow(cc, {
      date: dateVal,
      type: "other_charge",
      description: `Other Charges — ${c.containerNumber} (${containerSupplierName} → ${chargeSupplierName})`,
      ref: c.containerNumber,
      amount: amt,
      commissionAmount: null,
      commissionCurrency: null,
    });
  }

  // Inject opening balance rows (always USD) for broker and all linked suppliers
  for (const s of allSuppliers as any[]) {
    const ob = parseFloat(s.openingBalance || "0");
    if (ob !== 0) {
      if (!ledgerByCurrency["USD"]) ledgerByCurrency["USD"] = [];
      ledgerByCurrency["USD"].unshift({
        date: null,
        type: "opening_balance" as const,
        description: `Opening Balance — ${s.name}`,
        ref: "OB",
        amount: ob,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }
  }

  // Sort rows by date within each section
  for (const cc of Object.keys(ledgerByCurrency)) {
    ledgerByCurrency[cc].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db2 = b.date ? new Date(b.date).getTime() : 0;
      return da - db2;
    });
  }

  // Build ledgers with running balance
  const currencyLedgers = Object.entries(ledgerByCurrency)
    .map(([cc, rows]) => {
      let runBal = 0;
      const rowsWithBal = rows.map((row) => {
        // Commission is excluded from the broker balance until explicitly transferred.
        // commissionAmount is always null now, but guard defensively.
        runBal += row.amount;
        return { ...row, runningBalance: runBal };
      });
      const containerRows = rows.filter((r) => r.type === "container");
      const totalContainers = containerRows.length;
      const totalValue = containerRows.reduce((s, r) => s + r.amount, 0);
      const totalPaid = Math.abs(rows.filter((r) => r.type === "payment").reduce((s, r) => s + r.amount, 0));
      const totalFxOut = Math.abs(rows.filter((r) => r.type === "fx_out").reduce((s, r) => s + r.amount, 0));
      const totalFxIn = rows.filter((r) => r.type === "fx_in").reduce((s, r) => s + r.amount, 0);
      const totalOtherCharges = rows.filter((r) => r.type === "other_charge").reduce((s, r) => s + r.amount, 0);
      const totalFreight = rows.filter((r) => r.type === "freight").reduce((s, r) => s + r.amount, 0);
      // A "broker pool" section is the USD section that has no containers —
      // it represents USD the broker has received from FX settlements and commission transfers.
      // Its balance is an ASSET (received), not a payable, so CR/DR labels are inverted vs normal sections.
      const isBrokerPool = cc === "USD" && totalContainers === 0 && totalFxIn > 0;
      return {
        currencyCode: cc,
        rows: rowsWithBal,
        totalContainers,
        totalValue: totalValue.toFixed(2),
        totalFreight: totalFreight.toFixed(2),
        totalOtherCharges: totalOtherCharges.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        totalFxOut: totalFxOut.toFixed(2),
        totalFxIn: totalFxIn.toFixed(2),
        netBalance: runBal.toFixed(2),
        isBrokerPool,
      };
    })
    .sort((a, b) =>
      a.currencyCode === "USD" ? 1 : b.currencyCode === "USD" ? -1 : a.currencyCode.localeCompare(b.currencyCode)
    );

  return { supplier: broker, linkedSuppliers: linkedRaw, currencyLedgers };
}

export function registerSupplierBalanceRoutes(app: Express) {
  app.get("/api/factory/suppliers/:id/balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseId(req.params.id);
      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(supplierId)) return res.status(400).json({ message: "Invalid supplier ID" });

      // Load the supplier + any children (for broker aggregation)
      const allSuppliers = await db.select().from(factorySuppliers).where(eq(factorySuppliers.companyId, companyId));
      const supplier = allSuppliers.find((s: any) => s.id === supplierId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      const children = allSuppliers.filter((s: any) => (s as any).parentId === supplierId);
      const supplierIds = [supplierId, ...children.map((c: any) => c.id)];

      // Load all containers, payments, and FX transfers for the relevant supplier IDs
      const allContainers = await db.select().from(factoryContainers).where(eq(factoryContainers.companyId, companyId));

      const allPayments = await db
        .select()
        .from(factorySupplierPayments)
        .where(
          and(
            eq(factorySupplierPayments.companyId, companyId),
            inArray(factorySupplierPayments.supplierId, supplierIds)
          )
        );

      // Voucher-based payments (ERP vouchers that debit a factory supplier account).
      // Exclude FACTORY-PAY-* vouchers — those are auto-generated from factorySupplierPayments
      // and already counted in allPayments to avoid double-counting.
      const voucherPaidBySupplier: Record<number, number> = {};
      // Tracks suppliers whose balance includes a component derived from an unresolved
      // non-USD exchange rate — declared here so both the voucher-payment loop below and
      // computeBalance's container/commission/charge loops can flag into the same set.
      const balanceFxUnresolved = new Set<number>();
      const voucherPaymentRows = await db
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
            inArray(voucherEntries.factorySupplierId, supplierIds),
            sql`${voucherEntries.debitAmount}::numeric > 0`,
            sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
          )
        );
      for (const row of voucherPaymentRows as any[]) {
        const sid = row.factorySupplierId;
        if (!sid) continue;
        if (row.optional) continue; // optional vouchers don't affect the balance
        const amt = parseFloat(row.debitAmount || "0");
        const curr = row.currency || "USD";
        let usdAmt: number;
        if (curr === "USD") {
          usdAmt = amt;
        } else {
          // vouchers.exchangeRate has no fxRateConfirmed column yet — legacy heuristic stopgap.
          const { fxRate: fx, looksSet } = resolveStoredFxRate(curr, row.exchangeRate);
          if (!looksSet) {
            balanceFxUnresolved.add(sid);
            continue; // exclude this voucher payment from the total rather than guess at 1
          }
          usdAmt = amt / fx;
        }
        voucherPaidBySupplier[sid] = (voucherPaidBySupplier[sid] || 0) + usdAmt;
      }

      // Fetch FX transfers for this supplier (both as sender and receiver)
      const allFxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(
          and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            sql`(${factorySupplierFxTransfers.fromSupplierId} = ${supplierId} OR ${factorySupplierFxTransfers.toSupplierId} = ${supplierId})`
          )
        );

      // Post-offload charges explicitly assigned to this supplier (supplierId NOT NULL).
      // Charges posted to a ledger account have supplierId=null and must NOT appear on any supplier balance.
      const offloadAdditionalChargesForSupplier = await db
        .select({
          supplierId: (factoryOffloadAdditionalCharges as any).supplierId,
          amount: factoryOffloadAdditionalCharges.amount,
          currencyCode: factoryOffloadAdditionalCharges.currencyCode,
          fxRateToUsd: factoryOffloadAdditionalCharges.fxRateToUsd,
          fxRateConfirmed: (factoryOffloadAdditionalCharges as any).fxRateConfirmed,
        })
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.companyId, companyId),
            sql`${(factoryOffloadAdditionalCharges as any).supplierId} = ANY(${sqlArray(supplierIds)})`
          )
        );

      // computeBalance: TRUE BROKER BALANCE MODEL.
      // Commission from a supplier's own containers is included in the supplier's balance.
      // For brokers, their balance = only direct entries + FX-in (no child rollup).
      const computeBalance = (sid: number, openingBal: number) => {
        const supplierContainers = allContainers.filter((c: any) => c.supplierId === sid);
        const containerValue = supplierContainers.reduce((sum: number, c: any) => {
          // Use totalKg (declared/agreed weight) not actualReceivedKg — weight differences
          // at offload affect inventory only, not what is owed to the supplier.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const containerCc = c.currencyCode || "USD";
          const { fxRate: fx, looksSet: fxLooksSet } = resolveStoredFxRate(
            containerCc,
            c.fxRateToUsd,
            (c as any).fxRateConfirmed
          );
          if (!fxLooksSet) balanceFxUnresolved.add(sid);
          const freightCc = c.freightCurrencyCode || containerCc;
          // Freight in the same currency as the container → multiply by fx; otherwise treat separately
          const freightInContainerCurr = freightCc === containerCc ? freight : 0;
          const freightDirectUsd = freightCc === "USD" && freightCc !== containerCc ? freight : 0;
          if (!fxLooksSet) return sum + freightDirectUsd; // skip the unresolved-rate portion, don't guess
          return sum + (kg * rate + freightInContainerCurr) * fx + freightDirectUsd;
        }, 0);
        // Commission from supplier's OWN containers (not broker-earned from other suppliers' containers)
        const ownCommission = supplierContainers.reduce((sum: number, c: any) => {
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt <= 0) return sum;
          const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
          if (commCurr === "USD") return sum + commAmt;
          const { fxRate: commFx, looksSet: commFxLooksSet } = resolveStoredFxRate(
            commCurr,
            c.fxRateToUsd,
            (c as any).fxRateConfirmed
          );
          if (!commFxLooksSet) {
            balanceFxUnresolved.add(sid);
            return sum;
          }
          return sum + commAmt * commFx;
        }, 0);
        // Other charges from other suppliers' containers where this supplier is the charge recipient
        const otherChargesValue = allContainers.reduce((sum: number, c: any) => {
          if (c.otherChargesSupplierId !== sid) return sum;
          const oc = parseFloat(c.otherCharges || "0");
          if (oc <= 0) return sum;
          const ocCcy = (c as any).otherChargesCurrencyCode || "USD";
          if (ocCcy === "USD") return sum + oc;
          const { fxRate: fx, looksSet } = resolveStoredFxRate(ocCcy, c.fxRateToUsd, (c as any).fxRateConfirmed);
          if (!looksSet) {
            balanceFxUnresolved.add(sid);
            return sum;
          }
          return sum + oc * fx;
        }, 0);
        // Post-offload additional charges explicitly assigned to this supplier (or children)
        const offloadChargesValue = offloadAdditionalChargesForSupplier.reduce((sum: number, oc: any) => {
          if (oc.supplierId !== sid) return sum;
          const amt = parseFloat(oc.amount || "0");
          if (amt <= 0) return sum;
          const cc = oc.currencyCode || "USD";
          if (cc === "USD") return sum + amt;
          const { fxRate: fx, looksSet } = resolveStoredFxRate(cc, oc.fxRateToUsd, oc.fxRateConfirmed);
          if (!looksSet) {
            balanceFxUnresolved.add(sid);
            return sum;
          }
          return sum + amt * fx;
        }, 0);
        // FX net: FX-in transfers received minus FX-out transfers sent (in USD)
        // Use toAmountUsd for both directions — it's the actual USD value settled.
        let fxNetUsd = 0;
        for (const t of allFxTransfers as any[]) {
          if (t.toSupplierId === sid) {
            fxNetUsd += parseFloat(t.toAmountUsd || "0");
          }
          if (t.fromSupplierId === sid) {
            fxNetUsd -= parseFloat(t.toAmountUsd || "0");
          }
        }
        const supplierPayments = allPayments.filter((p: any) => p.supplierId === sid);
        const totalPaid = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);
        const voucherPaid = voucherPaidBySupplier[sid] || 0;
        return (
          openingBal +
          containerValue +
          ownCommission +
          otherChargesValue +
          offloadChargesValue +
          fxNetUsd -
          totalPaid -
          voucherPaid
        );
      };

      // True broker balance: only the broker's own balance (NOT children aggregated in)
      const outstandingUsd = computeBalance(supplierId, parseFloat(supplier.openingBalance || "0"));

      res.json({
        balance: outstandingUsd,
        outstandingUsd,
        fxUnresolved: balanceFxUnresolved.has(supplierId),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/with-balances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const includeOtw = req.query.includeOtw === "true";

      const suppliersList = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), isNull(factoryContainers.deletedAt)));

      const allPayments = await db
        .select()
        .from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId));

      const allFxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId));

      // Voucher-based payments: debit entries on voucherEntries where factorySupplierId is set.
      // Exclude FACTORY-PAY-* vouchers — those are auto-generated from factorySupplierPayments
      // and are already counted in allPayments (would double-count otherwise).
      const allSupplierIds = (suppliersList as any[]).map((s: any) => s.id);
      const voucherPaidBySupplier: Record<number, number> = {};
      const voucherFxUnresolvedSuppliers = new Set<number>();
      const voucherPaidBySupplierCurrency: Record<number, Record<string, number>> = {};
      const voucherPaidBySupplierCurrencyUsd: Record<number, Record<string, number>> = {};
      if (allSupplierIds.length > 0) {
        const voucherPaymentRows = await db
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
              sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
            )
          );
        for (const row of voucherPaymentRows as any[]) {
          const suppId = row.factorySupplierId;
          if (!suppId) continue;
          if (row.optional) continue; // optional vouchers don't affect the balance
          const amt = parseFloat(row.debitAmount || "0");
          const curr = row.currency || "USD";
          let usdAmt: number;
          if (curr === "USD") {
            usdAmt = amt;
          } else {
            // vouchers.exchangeRate has no fxRateConfirmed column yet — legacy heuristic stopgap.
            const { fxRate: fx, looksSet } = resolveStoredFxRate(curr, row.exchangeRate);
            if (!looksSet) {
              voucherFxUnresolvedSuppliers.add(suppId);
              continue; // exclude from the total rather than guess at 1
            }
            usdAmt = amt / fx;
          }
          voucherPaidBySupplier[suppId] = (voucherPaidBySupplier[suppId] || 0) + usdAmt;
          if (!voucherPaidBySupplierCurrency[suppId]) voucherPaidBySupplierCurrency[suppId] = {};
          voucherPaidBySupplierCurrency[suppId][curr] = (voucherPaidBySupplierCurrency[suppId][curr] || 0) + amt;
          if (!voucherPaidBySupplierCurrencyUsd[suppId]) voucherPaidBySupplierCurrencyUsd[suppId] = {};
          voucherPaidBySupplierCurrencyUsd[suppId][curr] =
            (voucherPaidBySupplierCurrencyUsd[suppId][curr] || 0) + usdAmt;
        }
      }

      // Load the user-configured display FX rates (e.g. EUR=1.18, AUD=0.75)
      // These are the same rates shown on the Net Position page.
      const fxRateRows = await db.execute(sql`
        SELECT DISTINCT ON (currency_code) currency_code, rate_to_usd
        FROM factory_fx_rates
        WHERE company_id = ${companyId} AND source = 'manual'
        ORDER BY currency_code, effective_date DESC
      `);
      const configuredFxRates: Record<string, number> = {};
      for (const row of fxRateRows.rows as any[]) {
        configuredFxRates[row.currency_code] = parseFloat(row.rate_to_usd);
      }

      // Pre-fetch post-offload charges explicitly assigned to a supplier (supplierId NOT NULL).
      // Charges posted to a ledger account have supplierId=null and must NOT appear on any supplier balance.
      const allOffloadAdditionalCharges =
        allSupplierIds.length > 0
          ? await db
              .select({
                supplierId: (factoryOffloadAdditionalCharges as any).supplierId,
                amount: factoryOffloadAdditionalCharges.amount,
                currencyCode: factoryOffloadAdditionalCharges.currencyCode,
                fxRateToUsd: factoryOffloadAdditionalCharges.fxRateToUsd,
              })
              .from(factoryOffloadAdditionalCharges)
              .where(
                and(
                  eq(factoryOffloadAdditionalCharges.companyId, companyId),
                  sql`${(factoryOffloadAdditionalCharges as any).supplierId} = ANY(${sqlArray(allSupplierIds)})`
                )
              )
          : [];

      // Helper to compute stats for a single supplier record
      const computeStats = (s: any, includeOtw: boolean = false) => {
        const supplierContainers = containers.filter((c: any) => c.supplierId === s.id);
        const payableContainers = supplierContainers.filter(
          (c: any) => isPayableContainer(c) || (includeOtw && (c.status === "PENDING" || c.status === "IN_TRANSIT"))
        );
        const totalContainers = supplierContainers.length;
        const totalKg = supplierContainers.reduce((sum: number, c: any) => {
          return sum + parseFloat(c.actualReceivedKg || c.totalKg || "0");
        }, 0);
        // Sum container value including freight (agreed supplier charge) in USD.
        // Cross-currency freight (e.g. USD freight on AUD containers) is added directly in USD.
        // Always prefer the user-configured FX rate; fall back to the per-container rate only
        // when no configured rate exists for that currency.
        const containerValue = payableContainers.reduce((sum: number, c: any) => {
          // Use totalKg (declared/agreed weight) not actualReceivedKg — weight differences
          // at offload affect inventory only, not what is owed to the supplier.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const containerCc = c.currencyCode || "USD";
          const fx = resolveDisplayFx(containerCc, configuredFxRates[containerCc], c.fxRateToUsd, (c as any).fxRateConfirmed);
          const freightCc = c.freightCurrencyCode || containerCc;
          const freightFx = configuredFxRates[freightCc] ?? fx;
          const freightInContainerCurr = freightCc === containerCc ? freight : 0;
          const freightDirectUsd = freightCc === "USD" && freightCc !== containerCc ? freight : 0;
          return sum + (kg * rate + freightInContainerCurr) * fx + freightDirectUsd;
        }, 0);
        // Commission accumulates under the supplier, EXCEPT:
        // if this supplier is linked to a broker (has parentId), USD commission flows to the broker.
        const commissionValue = payableContainers.reduce((sum: number, c: any) => {
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt <= 0) return sum;
          const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
          // Linked supplier: USD commission is absorbed by the parent broker — skip here
          if (s.parentId && commCurr === "USD") return sum;
          const commFx = resolveDisplayFx(
            commCurr,
            configuredFxRates[commCurr],
            commCurr === (c.currencyCode || "USD") ? c.fxRateToUsd : undefined,
            commCurr === (c.currencyCode || "USD") ? (c as any).fxRateConfirmed : undefined
          );
          return sum + (commCurr === "USD" ? commAmt : commAmt * commFx);
        }, 0);
        const pendingConts = supplierContainers.filter((c: any) => c.status === "PENDING" || c.status === "IN_TRANSIT");
        const pendingContainers = pendingConts.length;
        const otwByCurrency: Record<string, number> = {};
        for (const c of pendingConts) {
          const cc = (c.currencyCode || "USD").toUpperCase();
          otwByCurrency[cc] = (otwByCurrency[cc] || 0) + 1;
        }
        const receivedContainers = supplierContainers.filter(
          (c: any) => c.status === "RECEIVED" || c.status === "PARTIALLY_RECEIVED" || c.status === "OFFLOADED"
        ).length;
        const lastContainerDate =
          supplierContainers.length > 0
            ? supplierContainers.reduce((latest: string | null, c: any) => {
                const d = c.arrivalDate || c.createdAt;
                if (!latest) return d;
                return new Date(d) > new Date(latest) ? d : latest;
              }, null)
            : null;
        const supplierPayments = allPayments.filter((p: any) => p.supplierId === s.id);
        const totalPaid = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);
        // Include voucher-based payments (payment vouchers) in the balance
        const voucherPaidUsd = voucherPaidBySupplier[s.id] || 0;
        // FX net (USD): FX-in transfers received minus FX-out transfers sent (in USD equivalent)
        // This is critical for brokers that accumulate balance via explicit FX settlements from linked suppliers.
        // Always use toAmountUsd as the USD amount — it reflects the actual settled USD value.
        let fxNetUsd = 0;
        for (const t of allFxTransfers) {
          if (t.toSupplierId === s.id) {
            fxNetUsd += parseFloat((t as any).toAmountUsd || "0");
          }
          if (t.fromSupplierId === s.id) {
            fxNetUsd -= parseFloat((t as any).toAmountUsd || "0");
          }
        }
        // Other charges from containers where this supplier is the charge recipient.
        // Linked suppliers: USD other charges flow to the parent broker — exclude from own balance.
        const otherChargesValue = containers.filter(isPayableContainer).reduce((sum: number, c: any) => {
          if (c.otherChargesSupplierId !== s.id) return sum;
          const oc = parseFloat(c.otherCharges || "0");
          if (oc <= 0) return sum;
          const ocCcy = (c as any).otherChargesCurrencyCode || "USD";
          if (s.parentId && ocCcy === "USD") return sum;
          const fx = resolveDisplayFx(ocCcy, configuredFxRates[ocCcy], c.fxRateToUsd, (c as any).fxRateConfirmed);
          return sum + oc * fx;
        }, 0);
        // Per-currency balances (original currency, not converted).
        // Track both native amount AND USD equivalent for every transaction so that
        // fxRateToUsd = usdSum / nativeSum — an effective rate that always satisfies
        // native × effectiveFx = USD contribution, making the card hint accurate.
        const byCurrencyNative: Record<string, number> = {};
        const byCurrencyUsd: Record<string, number> = {};
        // resolveDisplayFx returns 0 (never a silent 1) when a currency's rate is unresolved;
        // track which native buckets that happened for so the summary can flag it honestly.
        let fxUnresolved = false;
        const markIfUnresolved = (cc: string, fx: number) => {
          if (cc !== "USD" && fx === 0) fxUnresolved = true;
        };

        // Opening balance is USD-denominated
        const openingBal = parseFloat(s.openingBalance || "0");
        if (Math.abs(openingBal) > 0.0001) {
          byCurrencyNative["USD"] = (byCurrencyNative["USD"] || 0) + openingBal;
          byCurrencyUsd["USD"] = (byCurrencyUsd["USD"] || 0) + openingBal;
        }

        for (const c of payableContainers) {
          const cc = c.currencyCode || "USD";
          const baseVal = parseFloat(c.totalKg || "0") * parseFloat(c.ratePerKg || "0");
          const freightAmt = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || cc;
          const fx = resolveDisplayFx(cc, configuredFxRates[cc], c.fxRateToUsd, (c as any).fxRateConfirmed);
          markIfUnresolved(cc, fx);

          byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) + baseVal;
          byCurrencyUsd[cc] = (byCurrencyUsd[cc] || 0) + baseVal * (cc === "USD" ? 1 : fx);

          // Freight in its own currency bucket with its effective USD value
          if (freightAmt > 0) {
            // Same-cc freight converts at container fx; cross-cc USD freight stays as USD
            const freightFx =
              freightCc === "USD"
                ? 1
                : (configuredFxRates[freightCc] ??
                  (freightCc === cc
                    ? fx
                    : resolveDisplayFx(freightCc, undefined, c.fxRateToUsd, (c as any).fxRateConfirmed)));
            markIfUnresolved(freightCc, freightFx);
            byCurrencyNative[freightCc] = (byCurrencyNative[freightCc] || 0) + freightAmt;
            byCurrencyUsd[freightCc] =
              (byCurrencyUsd[freightCc] || 0) + freightAmt * (freightCc === "USD" ? 1 : freightFx);
          }

          // Commission from own containers
          const commAmt = parseFloat(c.commissionAmount || "0");
          if (commAmt > 0) {
            const commCc = c.commissionCurrencyCode || cc;
            if (!(s.parentId && commCc === "USD")) {
              const commFx =
                commCc === "USD"
                  ? 1
                  : (configuredFxRates[commCc] ??
                    (commCc === cc
                      ? fx
                      : resolveDisplayFx(commCc, undefined, c.fxRateToUsd, (c as any).fxRateConfirmed)));
              markIfUnresolved(commCc, commFx);
              byCurrencyNative[commCc] = (byCurrencyNative[commCc] || 0) + commAmt;
              byCurrencyUsd[commCc] = (byCurrencyUsd[commCc] || 0) + commAmt * (commCc === "USD" ? 1 : commFx);
            }
          }
        }

        // Subtract regular payments — use actual amountUsd for USD tracking
        for (const p of supplierPayments) {
          const cc = p.currencyCode || "USD";
          byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) - parseFloat(p.amount || "0");
          byCurrencyUsd[cc] = (byCurrencyUsd[cc] || 0) - parseFloat(p.amountUsd || "0");
        }

        // Subtract voucher-based payments — use actual USD amounts
        const voucherCurrMap = voucherPaidBySupplierCurrency[s.id] || {};
        const voucherCurrMapUsd = voucherPaidBySupplierCurrencyUsd[s.id] || {};
        for (const [cc, amt] of Object.entries(voucherCurrMap)) {
          byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) - amt;
          byCurrencyUsd[cc] = (byCurrencyUsd[cc] || 0) - (voucherCurrMapUsd[cc] || 0);
        }

        // FX transfers — use toAmountUsd as the settled USD value for both directions
        for (const t of allFxTransfers) {
          if (t.fromSupplierId === s.id) {
            const cc = t.fromCurrencyCode || "USD";
            byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) - parseFloat(t.fromAmount || "0");
            byCurrencyUsd[cc] = (byCurrencyUsd[cc] || 0) - parseFloat(t.toAmountUsd || "0");
          }
          if (t.toSupplierId === s.id) {
            byCurrencyNative["USD"] = (byCurrencyNative["USD"] || 0) + parseFloat(t.toAmountUsd || "0");
            byCurrencyUsd["USD"] = (byCurrencyUsd["USD"] || 0) + parseFloat(t.toAmountUsd || "0");
          }
        }

        // Other charges attributed to this supplier (container-column otherCharges)
        for (const c of containers.filter(isPayableContainer)) {
          if ((c as any).otherChargesSupplierId !== s.id) continue;
          const oc = parseFloat((c as any).otherCharges || "0");
          if (oc <= 0) continue;
          const cc = (c as any).otherChargesCurrencyCode || "USD";
          if (s.parentId && cc === "USD") continue;
          const fx = resolveDisplayFx(cc, configuredFxRates[cc], c.fxRateToUsd, (c as any).fxRateConfirmed);
          markIfUnresolved(cc, fx);
          byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) + oc;
          byCurrencyUsd[cc] = (byCurrencyUsd[cc] || 0) + oc * fx;
        }

        // Post-offload additional charges explicitly assigned to this supplier
        for (const oc of allOffloadAdditionalCharges as any[]) {
          if (oc.supplierId !== s.id) continue;
          const amt = parseFloat(oc.amount || "0");
          if (amt <= 0) continue;
          const cc = oc.currencyCode || "USD";
          const fx = resolveDisplayFx(cc, configuredFxRates[cc], oc.fxRateToUsd, (oc as any).fxRateConfirmed);
          markIfUnresolved(cc, fx);
          byCurrencyNative[cc] = (byCurrencyNative[cc] || 0) + amt;
          byCurrencyUsd[cc] = (byCurrencyUsd[cc] || 0) + amt * fx;
        }

        // Balance = sum of each native-currency bucket × its configured rate.
        // This ensures balance always equals EUR_native × configuredEurRate (etc.),
        // so the card hint and the balance number are always consistent.
        const balance = Object.entries(byCurrencyNative).reduce((sum, [cc, native]) => {
          const usd = byCurrencyUsd[cc] || 0;
          const effectiveFx = cc === "USD" ? 1 : Math.abs(native) > 0.001 ? usd / native : 0;
          const rate = cc === "USD" ? 1 : (configuredFxRates[cc] ?? effectiveFx);
          return sum + native * rate;
        }, 0);

        // Use the user-configured display rate (from Net Position settings) if available,
        // falling back to the effective rate derived from transactions.
        const currencyBalances = Object.entries(byCurrencyNative)
          .map(([currencyCode, native]) => {
            const usd = byCurrencyUsd[currencyCode] || 0;
            const effectiveFx = currencyCode === "USD" ? 1 : Math.abs(native) > 0.001 ? usd / native : 0;
            const displayFx = currencyCode === "USD" ? 1 : (configuredFxRates[currencyCode] ?? effectiveFx);
            return { currencyCode, balance: native, fxRateToUsd: displayFx };
          })
          .filter(({ balance: bal }) => Math.abs(bal) > 0.001)
          .sort((a, b) => (a.currencyCode === "USD" ? 1 : -1)); // non-USD first

        // Due containers: offloaded >30 days ago and supplier still has a positive balance
        const now = new Date();
        const dueContainers =
          balance > 0.01
            ? payableContainers
                .filter((c: any) => {
                  if (!c.offloadDate) return false;
                  const offloadMs = new Date(c.offloadDate).getTime();
                  return now.getTime() - offloadMs >= 30 * 24 * 60 * 60 * 1000;
                })
                .map((c: any) => ({
                  id: c.id,
                  containerNumber: c.containerNumber,
                  offloadDate: c.offloadDate,
                  currencyCode: c.currencyCode || "USD",
                  value: (
                    parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") +
                    parseFloat(c.freight || "0")
                  ).toFixed(2),
                  daysPastDue:
                    Math.floor((now.getTime() - new Date(c.offloadDate).getTime()) / (24 * 60 * 60 * 1000)) - 30,
                }))
            : [];

        // Approx FX rate: weighted average rate across non-USD containers (for UI display).
        // Only include containers whose rate is actually confirmed/resolved — a numeric
        // fxRateToUsd of exactly 1 that isn't confirmed is not a "looks set" rate.
        const fxContainers = payableContainers.filter((c: any) => {
          if ((c.currencyCode || "USD") === "USD") return false;
          const { looksSet } = resolveStoredFxRate(c.currencyCode, c.fxRateToUsd, (c as any).fxRateConfirmed);
          return looksSet;
        });
        const fxWeightedSum = fxContainers.reduce((s: number, c: any) => {
          const val =
            parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") +
            parseFloat(c.freight || "0");
          return s + val * parseFloat(c.fxRateToUsd || "1");
        }, 0);
        const fxWeightBase = fxContainers.reduce((s: number, c: any) => {
          return (
            s +
            (parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") +
              parseFloat(c.freight || "0"))
          );
        }, 0);
        const approxFxRate = fxWeightBase > 0 ? fxWeightedSum / fxWeightBase : 0;

        // Cross-currency freight that auto-flows into the broker pool for linked suppliers.
        // e.g. USD freight on an AUD container for a supplier whose parent is a broker.
        // This amount is "auto-settled" from the supplier's perspective — the broker absorbs it.
        const autoSettledFreightUsd =
          s.parentId !== null && s.parentId !== undefined
            ? payableContainers.reduce((sum: number, c: any) => {
                const freightCc = c.freightCurrencyCode || c.currencyCode || "USD";
                const containerCc = c.currencyCode || "USD";
                if (freightCc === "USD" && containerCc !== "USD") {
                  return sum + parseFloat(c.freight || "0");
                }
                return sum;
              }, 0)
            : 0;

        return {
          totalContainers,
          totalKg,
          containerValue,
          commissionValue,
          pendingContainers,
          otwByCurrency,
          receivedContainers,
          lastContainerDate,
          totalPaid,
          balance,
          currencyBalances,
          dueContainers,
          approxFxRate,
          autoSettledFreightUsd,
          fxUnresolved: fxUnresolved || voucherFxUnresolvedSuppliers.has(s.id),
        };
      };

      // First pass: compute each supplier's own stats
      const statsById: Record<number, ReturnType<typeof computeStats>> = {};
      for (const s of suppliersList as any[]) {
        statsById[s.id] = computeStats(s, includeOtw);
      }

      // Pre-compute broker statements for each broker parent so the list card
      // balance matches the detail page exactly (same data source).
      const brokerParentIds = new Set<number>(
        (suppliersList as any[])
          .filter((s: any) => (suppliersList as any[]).some((c: any) => c.parentId === s.id))
          .map((s: any) => s.id as number)
      );
      const brokerStmtMap: Record<number, any> = {};
      for (const s of suppliersList as any[]) {
        if (brokerParentIds.has(s.id)) {
          const stmt = await buildBrokerStatement(s.id, companyId, includeOtw);
          if (stmt) brokerStmtMap[s.id] = stmt;
        }
      }

      // Second pass: for parent suppliers, roll up children's stats
      const suppliersWithBalances = (suppliersList as any[]).map((s: any) => {
        const own = statsById[s.id];
        const children = (suppliersList as any[]).filter((c: any) => c.parentId === s.id);

        if (children.length === 0) {
          // Leaf supplier — use own stats
          return {
            ...s,
            totalContainers: own.totalContainers,
            totalKg: own.totalKg.toFixed(3),
            totalValue: own.balance.toFixed(2),
            totalPaid: own.totalPaid.toFixed(2),
            totalCommissionUsd: own.commissionValue.toFixed(2),
            approxFxRate: own.approxFxRate > 0 ? own.approxFxRate.toFixed(4) : null,
            pendingContainers: own.pendingContainers,
            otwByCurrency: own.otwByCurrency,
            receivedContainers: own.receivedContainers,
            lastContainerDate: own.lastContainerDate,
            currencyBalances: own.currencyBalances,
            dueContainers: own.dueContainers,
            dueContainersCount: own.dueContainers.length,
            autoSettledFreightUsd: own.autoSettledFreightUsd.toFixed(2),
            fxUnresolved: own.fxUnresolved,
          };
        }

        // TRUE BROKER BALANCE MODEL — parent supplier (broker) aggregation:
        // The broker's own balance (totalValue / currencyBalances) reflects ONLY direct broker entries
        // and explicit FX-in transfers. Linked supplier balances are NOT merged into broker-owned totals.
        // They are returned separately as linkedSupplierExposure for informational display.
        const childStats = children.map((c: any) => statsById[c.id]);
        // Informational aggregates that span all parties (container counts, kg, dates)
        const aggContainers =
          own.totalContainers + childStats.reduce((n: number, cs: any) => n + cs.totalContainers, 0);
        const aggKg = own.totalKg + childStats.reduce((n: number, cs: any) => n + cs.totalKg, 0);
        const aggPending =
          own.pendingContainers + childStats.reduce((n: number, cs: any) => n + cs.pendingContainers, 0);
        const aggOtwByCurrency: Record<string, number> = { ...own.otwByCurrency };
        for (const cs of childStats) {
          for (const [cc, n] of Object.entries(cs.otwByCurrency || {})) {
            aggOtwByCurrency[cc] = (aggOtwByCurrency[cc] || 0) + (n as number);
          }
        }
        const aggReceived =
          own.receivedContainers + childStats.reduce((n: number, cs: any) => n + cs.receivedContainers, 0);
        const allDates = [own.lastContainerDate, ...childStats.map((cs: any) => cs.lastContainerDate)].filter(Boolean);
        const aggLastDate =
          allDates.length > 0
            ? allDates.reduce((latest: string, d: string) => (new Date(d) > new Date(latest) ? d : latest))
            : null;
        const aggDueContainers = [...own.dueContainers, ...childStats.flatMap((cs: any) => cs.dueContainers)];

        // Linked supplier exposure: per-child per-currency balances (informational, NOT counted in broker totals)
        const linkedSupplierExposure = children.map((c: any, i: number) => ({
          supplierId: c.id,
          supplierName: c.name,
          currencyBalances: childStats[i].currencyBalances,
          autoSettledFreightUsd: childStats[i].autoSettledFreightUsd.toFixed(2),
        }));

        // Aggregate exposure totals for summary display (informational only).
        // Auto-settled cross-currency freight (e.g. USD freight on AUD containers) flows into
        // the broker's own USD pool automatically — exclude it from the linked exposure aggregate
        // so it doesn't appear as an unresolved obligation.
        const exposureCurrencyMap: Record<string, number> = {};
        const exposureFxMap: Record<string, { wSum: number; vSum: number }> = {};
        for (const cs of childStats) {
          const autoFreight = cs.autoSettledFreightUsd || 0;
          for (const cb of cs.currencyBalances) {
            // For USD balances on a linked supplier, subtract auto-settled freight so the broker
            // card doesn't show it as an open exposure (it's already in the broker pool).
            const effectiveBal = cb.currencyCode === "USD" ? cb.balance - autoFreight : cb.balance;
            if (effectiveBal > 0) {
              exposureCurrencyMap[cb.currencyCode] = (exposureCurrencyMap[cb.currencyCode] || 0) + effectiveBal;
              if (cb.currencyCode !== "USD" && cb.fxRateToUsd && cb.fxRateToUsd > 0) {
                if (!exposureFxMap[cb.currencyCode]) exposureFxMap[cb.currencyCode] = { wSum: 0, vSum: 0 };
                exposureFxMap[cb.currencyCode].wSum += effectiveBal * cb.fxRateToUsd;
                exposureFxMap[cb.currencyCode].vSum += effectiveBal;
              }
            }
          }
        }
        const exposureCurrencyBalances = Object.entries(exposureCurrencyMap)
          .map(([currencyCode, bal]) => ({
            currencyCode,
            balance: bal,
            fxRateToUsd:
              exposureFxMap[currencyCode]?.vSum > 0
                ? exposureFxMap[currencyCode].wSum / exposureFxMap[currencyCode].vSum
                : 1,
          }))
          .filter(({ balance: bal }) => bal > 0.001)
          .sort((a, b) => (a.currencyCode === "USD" ? 1 : -1));

        // Use broker-statement KPIs so the list card total matches the detail page.
        // Formula: USD_pool + EUR × configuredRate + AUD × configuredRate = totalValue
        const stmt = brokerStmtMap[s.id];
        let brokerPoolUsd: number = own.balance;
        let finalExposureCurrencyBalances = exposureCurrencyBalances;

        if (stmt) {
          const eurLedger = stmt.currencyLedgers.find((l: any) => l.currencyCode === "EUR");
          const audLedger = stmt.currencyLedgers.find((l: any) => l.currencyCode === "AUD");
          const usdLedger = stmt.currencyLedgers.find((l: any) => l.currencyCode === "USD");

          const eurBal = eurLedger ? parseFloat(eurLedger.netBalance) : 0;
          const audBal = audLedger ? parseFloat(audLedger.netBalance) : 0;
          brokerPoolUsd = usdLedger ? parseFloat(usdLedger.netBalance) : own.balance;

          // No silent default to 1 for an unconfigured company-level rate — leave unresolved (0)
          // so the exposure total below excludes it rather than guessing.
          const eurRate = configuredFxRates["EUR"] ?? 0;
          const audRate = configuredFxRates["AUD"] ?? 0;

          finalExposureCurrencyBalances = [
            ...(Math.abs(eurBal) > 0.001 ? [{ currencyCode: "EUR", balance: eurBal, fxRateToUsd: eurRate }] : []),
            ...(Math.abs(audBal) > 0.001 ? [{ currencyCode: "AUD", balance: audBal, fxRateToUsd: audRate }] : []),
          ];
        }

        const grandTotal =
          brokerPoolUsd +
          finalExposureCurrencyBalances.reduce((sum, e) => {
            if (e.currencyCode === "USD") return sum + e.balance;
            return sum + e.balance * (e.fxRateToUsd ?? 1);
          }, 0);

        return {
          ...s,
          totalContainers: aggContainers,
          totalKg: aggKg.toFixed(3),
          // Grand total: USD_pool + EUR × rate + AUD × rate (matches detail page)
          totalValue: grandTotal.toFixed(2),
          brokerPoolUsd: brokerPoolUsd.toFixed(2),
          totalPaid: own.totalPaid.toFixed(2),
          totalCommissionUsd: own.commissionValue.toFixed(2),
          approxFxRate: own.approxFxRate > 0 ? own.approxFxRate.toFixed(4) : null,
          pendingContainers: aggPending,
          otwByCurrency: aggOtwByCurrency,
          receivedContainers: aggReceived,
          lastContainerDate: aggLastDate,
          currencyBalances: own.currencyBalances,
          dueContainers: aggDueContainers,
          dueContainersCount: aggDueContainers.length,
          linkedSupplierExposure,
          exposureCurrencyBalances: finalExposureCurrencyBalances,
          fxUnresolved: own.fxUnresolved || childStats.some((cs: any) => cs.fxUnresolved),
        };
      });

      res.json(suppliersWithBalances.sort((a: any, b: any) => a.name.localeCompare(b.name)));
    } catch (error: any) {
      console.error("Error fetching factory suppliers with balances:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
