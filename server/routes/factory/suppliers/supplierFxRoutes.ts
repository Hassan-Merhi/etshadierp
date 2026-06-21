import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import { sqlArray } from "../../../lib/sqlArray";
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
  factorySupplierCategories, insertFactorySupplierCategorySchema,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

const PAYABLE_CONTAINER_STATUSES = new Set([
  "OFFLOADED",
  "RECEIVED",
  "PARTIALLY_RECEIVED",
]);

const isPayableContainer = (c: any) =>
  PAYABLE_CONTAINER_STATUSES.has(String(c.status || "").toUpperCase());


export async function buildBrokerStatement(brokerId: number, companyId: number, includeOtw = false) {
  // Fetch broker
  const [broker] = await db.select().from(factorySuppliers)
    .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
  if (!broker) return null;

  // Linked suppliers
  const linkedRaw = await db.select().from(factorySuppliers)
    .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId)));

  const allSuppliers = [broker, ...linkedRaw];
  const allSupplierIds = allSuppliers.map((s: any) => s.id);
  const supplierNameMap: Record<number, string> = {};
  for (const s of allSuppliers) supplierNameMap[(s as any).id] = (s as any).name;

  // Containers — exclude OTW unless caller opts in; always exclude soft-deleted
  const containersWhereClause = includeOtw
    ? and(eq(factoryContainers.companyId, companyId), inArray(factoryContainers.supplierId, allSupplierIds), isNull(factoryContainers.deletedAt))
    : and(eq(factoryContainers.companyId, companyId), inArray(factoryContainers.supplierId, allSupplierIds), isNull(factoryContainers.deletedAt), sql`${factoryContainers.status} NOT IN ('PENDING', 'IN_TRANSIT')`);
  const allContainers = allSupplierIds.length > 0
    ? await db.select().from(factoryContainers)
        .where(containersWhereClause)
        .orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt)
    : [];
  // Build a Set of the filtered container IDs so charge queries can be scoped to the same set.
  const filteredContainerIdSet = new Set((allContainers as any[]).map((c: any) => c.id as number));

  // Payments (direct)
  const allPayments = allSupplierIds.length > 0
    ? await db.select().from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, allSupplierIds)))
        .orderBy(factorySupplierPayments.date)
    : [];

  // Voucher-based payments (from general accounting, linked via factorySupplierId)
  const allVoucherPayments = allSupplierIds.length > 0
    ? await db.select({
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
      .where(and(
        inArray(voucherEntries.factorySupplierId as any, allSupplierIds),
        sql`${voucherEntries.debitAmount}::numeric > 0`,
        sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
      ))
      .orderBy(vouchers.voucherDate)
    : [];

  // FX transfers (involving any of the suppliers)
  const allFx = allSupplierIds.length > 0
    ? await db.select().from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          sql`(${factorySupplierFxTransfers.fromSupplierId} = ANY(${sqlArray(allSupplierIds)}) OR ${factorySupplierFxTransfers.toSupplierId} = ANY(${sqlArray(allSupplierIds)}))`
        ))
        .orderBy(factorySupplierFxTransfers.date)
    : [];

  // Offload additional charges explicitly assigned to any of the broker's suppliers.
  // Only rows where supplierId IS NOT NULL are included — if a charge was posted to a ledger
  // account (loan, payable, etc.) its supplierId is null intentionally and must NOT appear here.
  const allOffloadCharges = allSupplierIds.length > 0
    ? await db.select({
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
      .where(and(
        eq(factoryOffloadAdditionalCharges.companyId, companyId),
        sql`${(factoryOffloadAdditionalCharges as any).supplierId} = ANY(${sqlArray(allSupplierIds)})`
      ))
      .orderBy(factoryOffloadAdditionalCharges.createdAt)
    : [];

  // Container-level other charges (entered per-container, use charge's own currency first)
  const allContainerOtherCharges = allSupplierIds.length > 0
    ? await db.select({
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
      .where(and(
        eq(factoryContainerOtherCharges.companyId, companyId),
        inArray(factoryContainers.supplierId, allSupplierIds)
      ))
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
  for (const c of (allContainers as any[])) {
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
    const dateVal = c.arrivalDate ? String(c.arrivalDate) : c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : null;

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
    const supplierName = suppId ? (supplierNameMap[suppId] || "Unknown") : "Unknown";
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
  const containerColOtherCharges = allSupplierIds.length > 0
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
        .where(and(
          eq(factoryContainers.companyId, companyId),
          sql`${factoryContainers.otherChargesSupplierId} = ANY(${sqlArray(allSupplierIds)})`,
          sql`${factoryContainers.otherCharges}::numeric > 0`,
          isNull(factoryContainers.deletedAt)
        ))
    : [];

  for (const c of containerColOtherCharges as any[]) {
    // Skip charges tied to OTW containers when toggle is off
    if (!filteredContainerIdSet.has(c.id)) continue;
    const cc = c.otherChargesCurrencyCode || "USD";
    const amt = parseFloat(c.otherCharges || "0");
    const chargeSupplierName = supplierNameMap[c.otherChargesSupplierId] || "Unknown";
    const containerSupplierName = supplierNameMap[c.supplierId] || "Unknown";
    const dateVal = c.arrivalDate ? String(c.arrivalDate) : c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : null;
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
  const currencyLedgers = Object.entries(ledgerByCurrency).map(([cc, rows]) => {
    let runBal = 0;
    const rowsWithBal = rows.map((row) => {
      // Commission is excluded from the broker balance until explicitly transferred.
      // commissionAmount is always null now, but guard defensively.
      runBal += row.amount;
      return { ...row, runningBalance: runBal };
    });
    const containerRows = rows.filter(r => r.type === "container");
    const totalContainers = containerRows.length;
    const totalValue = containerRows.reduce((s, r) => s + r.amount, 0);
    const totalPaid = Math.abs(rows.filter(r => r.type === "payment").reduce((s, r) => s + r.amount, 0));
    const totalFxOut = Math.abs(rows.filter(r => r.type === "fx_out").reduce((s, r) => s + r.amount, 0));
    const totalFxIn = rows.filter(r => r.type === "fx_in").reduce((s, r) => s + r.amount, 0);
    const totalOtherCharges = rows.filter(r => r.type === "other_charge").reduce((s, r) => s + r.amount, 0);
    const totalFreight = rows.filter(r => r.type === "freight").reduce((s, r) => s + r.amount, 0);
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
  }).sort((a, b) => (a.currencyCode === "USD" ? 1 : b.currencyCode === "USD" ? -1 : a.currencyCode.localeCompare(b.currencyCode)));

  return { supplier: broker, linkedSuppliers: linkedRaw, currencyLedgers };
}


export function registerSupplierFxRoutes(app: Express) {
  app.get("/api/factory/supplier-fx-transfers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId))
        .orderBy(desc(factorySupplierFxTransfers.date));
      res.json(transfers);
    } catch (error: any) {
      console.error("Error fetching FX transfers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/supplier-fx-transfers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierFxTransferSchema.parse({ ...req.body, companyId });

      // Validate both suppliers exist and belong to this company
      const [fromSupplier] = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name, parentId: factorySuppliers.parentId })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.fromSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!fromSupplier) return res.status(404).json({ message: "From-supplier not found" });

      const [toSupplier] = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.toSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!toSupplier) return res.status(404).json({ message: "To-supplier not found" });

      // ── Balance validation (Phase 3) ─────────────────────────────────────────
      const currCode = parsed.fromCurrencyCode;
      const fromSupId = parsed.fromSupplierId;
      const sourceType = (parsed as any).sourceType || "supplier";

      // 1a. Containers for this supplier in this currency (for supplier-bucket validation)
      const contRowsInCurrency = await db
        .select({
          finalPayableAmount: factoryContainers.finalPayableAmount,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          freight: factoryContainers.freight,
          id: factoryContainers.id,
        })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.supplierId, fromSupId),
          eq(factoryContainers.currencyCode, currCode)
        ));

      const containerIds = contRowsInCurrency.map((c: any) => c.id);
      const totalValue = contRowsInCurrency.reduce((s: number, c: any) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const freight = parseFloat(c.freight || "0");
        return s + (kg * rate + freight);
      }, 0);

      // 1b. For commission validation: ALL containers for this supplier (commission may be in a
      //     different currency than the container, e.g. EUR container with USD commission).
      const allContainerIds: number[] = containerIds.slice(); // start with same-currency containers
      if (sourceType === "commission" || sourceType === "both") {
        const allContRows = await db
          .select({ id: factoryContainers.id })
          .from(factoryContainers)
          .where(and(
            eq(factoryContainers.companyId, companyId),
            eq(factoryContainers.supplierId, fromSupId)
          ));
        for (const c of allContRows) {
          if (!allContainerIds.includes(c.id)) allContainerIds.push(c.id);
        }
      }

      // 2. Commissions from factoryContainerCommissions for relevant containers,
      //    filtered by commission currency code (handles cross-currency commissions).
      let totalCommission = 0;
      if (allContainerIds.length > 0) {
        const commRows = await db
          .select({ commissionTotal: factoryContainerCommissions.commissionTotal, currencyCode: factoryContainerCommissions.currencyCode })
          .from(factoryContainerCommissions)
          .where(and(
            eq(factoryContainerCommissions.companyId, companyId),
            inArray(factoryContainerCommissions.containerId, allContainerIds)
          ));
        // Only count commissions denominated in the transfer currency
        totalCommission = commRows
          .filter((cm: any) => (cm.currencyCode || "USD") === currCode)
          .reduce((s: number, cm: any) => s + parseFloat(cm.commissionTotal || "0"), 0);

        // Also include direct commissions from containers (commissionAmount / commissionCurrencyCode)
        if (sourceType === "commission" || sourceType === "both") {
          const directRows = await db
            .select({ commissionAmount: factoryContainers.commissionAmount, commissionCurrencyCode: factoryContainers.commissionCurrencyCode })
            .from(factoryContainers)
            .where(and(
              eq(factoryContainers.companyId, companyId),
              eq(factoryContainers.supplierId, fromSupId)
            ));
          const directAmt = directRows
            .filter((r: any) => (r.commissionCurrencyCode || "USD") === currCode)
            .reduce((s: number, r: any) => s + parseFloat(r.commissionAmount || "0"), 0);
          // Use whichever is larger (factoryContainerCommissions may supersede commissionAmount)
          if (directAmt > totalCommission) totalCommission = directAmt;
        }
      }

      // 3. Payments in this currency
      const payRows = await db
        .select({ amount: factorySupplierPayments.amount })
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          eq(factorySupplierPayments.supplierId, fromSupId),
          eq(factorySupplierPayments.currencyCode, currCode)
        ));
      const totalPaid = payRows.reduce((s: number, p: any) => s + parseFloat(p.amount || "0"), 0);

      // 4. Existing FX transfers out for this supplier + currency
      const fxRows = await db
        .select({ fromAmount: factorySupplierFxTransfers.fromAmount, sourceType: factorySupplierFxTransfers.sourceType })
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          eq(factorySupplierFxTransfers.fromSupplierId, fromSupId),
          eq(factorySupplierFxTransfers.fromCurrencyCode, currCode)
        ));

      // FX deducted from supplier bucket (source = supplier or both)
      const fxSupplierOut = fxRows
        .filter((t: any) => !t.sourceType || t.sourceType === "supplier" || t.sourceType === "both")
        .reduce((s: number, t: any) => s + parseFloat(t.fromAmount || "0"), 0);
      // FX deducted from commission bucket (source = commission or both)
      const fxCommOut = fxRows
        .filter((t: any) => t.sourceType === "commission" || t.sourceType === "both")
        .reduce((s: number, t: any) => s + parseFloat(t.fromAmount || "0"), 0);

      const supplierAvail = totalValue - totalCommission - totalPaid - fxSupplierOut;
      const commAvail = totalCommission - fxCommOut;

      let available: number;
      if (sourceType === "commission") {
        available = commAvail;
      } else if (sourceType === "both") {
        available = supplierAvail + commAvail;
      } else {
        available = supplierAvail; // "supplier" (default)
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Overpayments are allowed — the remaining balance will go negative (CR),
      // visible on the statement so the company knows the supplier owes money back.

      const [created] = await db.insert(factorySupplierFxTransfers).values(parsed).returning();

      // ── Phase 1: Oldest-first allocation persistence ──────────────────────────
      // Allocate this FX transfer against containers ordered by creation date
      try {
        const allContainers = await db
          .select({ id: factoryContainers.id, finalPayableAmount: factoryContainers.finalPayableAmount, actualReceivedKg: factoryContainers.actualReceivedKg, totalKg: factoryContainers.totalKg, ratePerKg: factoryContainers.ratePerKg, freight: factoryContainers.freight })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, fromSupId), eq(factoryContainers.currencyCode, currCode)))
          .orderBy(factoryContainers.createdAt); // oldest first

        const cIds = allContainers.map((c: any) => c.id);
        const prevAllocs = cIds.length > 0
          ? await db.select({ containerId: factoryFxAllocations.containerId, allocatedAmount: factoryFxAllocations.allocatedAmount })
              .from(factoryFxAllocations)
              .where(and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, cIds)))
          : [];

        const allocatedPerContainer: Record<number, number> = {};
        for (const a of prevAllocs) allocatedPerContainer[a.containerId] = (allocatedPerContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

        let rem = parseFloat(created.fromAmount);
        const rows: any[] = [];
        for (const c of allContainers) {
          if (rem <= 0.001) break;
          // Use totalKg (agreed weight) for FX allocation ceiling — same as supplier balance.
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const val = kg * rate + freight;
          const used = allocatedPerContainer[c.id] || 0;
          const avail = Math.max(0, val - used);
          if (avail <= 0.001) continue;
          const toAlloc = Math.min(rem, avail);
          rows.push({ companyId, fxTransferId: created.id, containerId: c.id, sourceType: created.sourceType || "supplier", allocatedAmount: toAlloc.toFixed(4), currencyCode: currCode });
          rem -= toAlloc;
        }
        if (rows.length > 0) await db.insert(factoryFxAllocations).values(rows);
      } catch (allocErr) {
        console.error("FX allocation error (non-fatal):", allocErr);
      }
      // ─────────────────────────────────────────────────────────────────────────

      const transferKind = (created as any).sourceType === "commission" ? "Commission Transfer" : "FX Transfer";
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_FX_TRANSFER",
        referenceId: created.id,
        description: `${transferKind}: ${fromSupplier.name} ${created.fromCurrencyCode} ${parseFloat(created.fromAmount).toFixed(2)} → ${toSupplier.name} USD ${parseFloat(created.toAmountUsd).toFixed(2)}`,
        amountCurrency: parseFloat(created.fromAmount),
        amountUsd: parseFloat(created.toAmountUsd),
        currencyCode: created.fromCurrencyCode,
        effectiveDate: (req.body.effectiveDate as string) || null,
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating FX transfer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/supplier-fx-transfers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [transfer] = await db.select().from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      // Cascade-delete allocation rows before removing the transfer
      await db.delete(factoryFxAllocations)
        .where(and(eq(factoryFxAllocations.fxTransferId, id), eq(factoryFxAllocations.companyId, companyId)));

      await db.delete(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));

      await writeDaybookEntry(db, {
        companyId,
        txDate: getClientDate(req),
        txType: "SUPPLIER_FX_TRANSFER_DELETE",
        description: `FX Transfer deleted: ${transfer.fromCurrencyCode} ${parseFloat(transfer.fromAmount).toFixed(2)} → USD ${parseFloat(transfer.toAmountUsd).toFixed(2)} (dated ${transfer.date})`,
      });

      res.json({ message: "FX transfer deleted" });
    } catch (error: any) {
      console.error("Error deleting FX transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk FX Prefetch (offline cache) ─────────────────────────────────────
  // GET /api/factory/suppliers/:brokerId/bulk-fx-prefetch?currency=EUR
  // Returns per-linked-supplier available balance for the given currency so the
  // client can run the greedy allocation algorithm offline.
  app.get("/api/factory/suppliers/:brokerId/bulk-fx-prefetch", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.brokerId);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(brokerId)) return res.status(400).json({ message: "Invalid broker ID" });
      const currency = req.query.currency as string;
      if (!currency) return res.status(400).json({ message: "currency query param required" });

      const linkedSuppliers = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId), eq(factorySuppliers.isActive, true)));
      if (linkedSuppliers.length === 0) return res.json({ suppliers: [] });

      const linkedIds = linkedSuppliers.map((s: any) => s.id);

      const allContainers = (await db.select({
        id: factoryContainers.id, supplierId: factoryContainers.supplierId,
        status: factoryContainers.status,
        totalKg: factoryContainers.totalKg, actualReceivedKg: factoryContainers.actualReceivedKg,
        ratePerKg: factoryContainers.ratePerKg, freight: factoryContainers.freight,
        freightCurrencyCode: factoryContainers.freightCurrencyCode, currencyCode: factoryContainers.currencyCode,
        commissionAmount: factoryContainers.commissionAmount, commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
        createdAt: factoryContainers.createdAt, arrivalDate: factoryContainers.arrivalDate,
      }).from(factoryContainers).where(and(
        eq(factoryContainers.companyId, companyId),
        inArray(factoryContainers.supplierId, linkedIds),
        eq(factoryContainers.currencyCode, currency)
      ))).filter(isPayableContainer);

      const allPayments = await db.select({ supplierId: factorySupplierPayments.supplierId, amount: factorySupplierPayments.amount })
        .from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, linkedIds), eq(factorySupplierPayments.currencyCode, currency)));

      const allFxOut = await db.select({ fromSupplierId: factorySupplierFxTransfers.fromSupplierId, fromAmount: factorySupplierFxTransfers.fromAmount })
        .from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.companyId, companyId), inArray(factorySupplierFxTransfers.fromSupplierId, linkedIds), eq(factorySupplierFxTransfers.fromCurrencyCode, currency)));

      const paymentsBySupplier: Record<number, number> = {};
      for (const p of allPayments) paymentsBySupplier[p.supplierId] = (paymentsBySupplier[p.supplierId] || 0) + parseFloat(p.amount || "0");

      const fxOutBySupplier: Record<number, number> = {};
      for (const f of allFxOut) fxOutBySupplier[f.fromSupplierId] = (fxOutBySupplier[f.fromSupplierId] || 0) + parseFloat(f.fromAmount || "0");

      const result: Array<{ id: number; name: string; available: number; oldestDate: string | null; newestDate: string | null }> = [];
      for (const sup of linkedSuppliers) {
        const supContainers = allContainers.filter((c: any) => c.supplierId === sup.id);
        const totalValue = supContainers.reduce((s: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || c.currencyCode || currency;
          // Commission accumulates under supplier (true broker balance model)
          const commAmt = parseFloat(c.commissionAmount || "0");
          const commCc = c.commissionCurrencyCode || c.currencyCode || currency;
          return s + (kg * rate + (freightCc === currency ? freight : 0) + (commCc === currency ? commAmt : 0));
        }, 0);
        const available = Math.max(0, totalValue - (paymentsBySupplier[sup.id] || 0) - (fxOutBySupplier[sup.id] || 0));
        const dates = supContainers.map((c: any) => c.arrivalDate || c.createdAt).filter(Boolean) as string[];
        const oldestDate = dates.length ? dates.reduce((a, b) => new Date(a) < new Date(b) ? a : b) : null;
        const newestDate = dates.length ? dates.reduce((a, b) => new Date(a) > new Date(b) ? a : b) : null;
        if (available > 0.001) result.push({ id: sup.id, name: sup.name, available, oldestDate, newestDate });
      }

      return res.json({ suppliers: result, cachedAt: Date.now() });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── Bulk FX Settlement for Broker ────────────────────────────────────────
  // POST /api/factory/suppliers/:brokerId/bulk-fx-settlement
  // Distributes a total foreign-currency amount across all linked suppliers of
  // a broker, creating individual FX transfer records for each, capped at each
  // supplier's outstanding balance.
  app.post("/api/factory/suppliers/:brokerId/bulk-fx-settlement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.brokerId);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(brokerId)) return res.status(400).json({ message: "Invalid broker ID" });

      const { fromCurrencyCode, totalAmount, fxRateToUsd, date, notes, order = "oldest", dryRun = false } = req.body;
      if (!fromCurrencyCode || !totalAmount || !fxRateToUsd)
        return res.status(400).json({ message: "fromCurrencyCode, totalAmount, and fxRateToUsd are required" });

      const total = parseFloat(totalAmount);
      const fxRate = parseFloat(fxRateToUsd);
      if (total <= 0 || fxRate <= 0)
        return res.status(400).json({ message: "Amount and rate must be greater than zero" });

      // Verify broker exists
      const [broker] = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
      if (!broker) return res.status(404).json({ message: "Broker not found" });

      // Get all active linked suppliers
      const linkedSuppliers = await db.select().from(factorySuppliers)
        .where(and(
          eq(factorySuppliers.parentId, brokerId),
          eq(factorySuppliers.companyId, companyId),
          eq(factorySuppliers.isActive, true)
        ));
      if (linkedSuppliers.length === 0)
        return res.status(400).json({ message: "No active linked suppliers found for this broker" });

      const linkedIds = linkedSuppliers.map((s: any) => s.id);

      // Get all payable containers for linked suppliers in the given currency
      const allContainers = (await db.select({
        id: factoryContainers.id,
        supplierId: factoryContainers.supplierId,
        status: factoryContainers.status,
        totalKg: factoryContainers.totalKg,
        actualReceivedKg: factoryContainers.actualReceivedKg,
        ratePerKg: factoryContainers.ratePerKg,
        freight: factoryContainers.freight,
        freightCurrencyCode: factoryContainers.freightCurrencyCode,
        currencyCode: factoryContainers.currencyCode,
        commissionAmount: factoryContainers.commissionAmount,
        commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
        createdAt: factoryContainers.createdAt,
        arrivalDate: factoryContainers.arrivalDate,
      })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          inArray(factoryContainers.supplierId, linkedIds),
          eq(factoryContainers.currencyCode, fromCurrencyCode)
        ))
        .orderBy(order === "newest" ? desc(factoryContainers.createdAt) : factoryContainers.createdAt)
      ).filter(isPayableContainer);

      // Get payments in this currency for linked suppliers
      const allPayments = await db.select({
        supplierId: factorySupplierPayments.supplierId,
        amount: factorySupplierPayments.amount,
      })
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          inArray(factorySupplierPayments.supplierId, linkedIds),
          eq(factorySupplierPayments.currencyCode, fromCurrencyCode)
        ));

      // Get existing FX transfers out for linked suppliers in this currency
      const allFxOut = await db.select({
        fromSupplierId: factorySupplierFxTransfers.fromSupplierId,
        fromAmount: factorySupplierFxTransfers.fromAmount,
      })
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          inArray(factorySupplierFxTransfers.fromSupplierId, linkedIds),
          eq(factorySupplierFxTransfers.fromCurrencyCode, fromCurrencyCode)
        ));

      // Aggregate payment and FX-out totals per supplier
      const paymentsBySupplier: Record<number, number> = {};
      for (const p of allPayments)
        paymentsBySupplier[p.supplierId] = (paymentsBySupplier[p.supplierId] || 0) + parseFloat(p.amount || "0");

      const fxOutBySupplier: Record<number, number> = {};
      for (const f of allFxOut)
        fxOutBySupplier[f.fromSupplierId] = (fxOutBySupplier[f.fromSupplierId] || 0) + parseFloat(f.fromAmount || "0");

      // Previous container-level allocations (to avoid over-allocating)
      const allContainerIds = allContainers.map((c: any) => c.id);
      const prevAllocs = allContainerIds.length > 0
        ? await db.select({
          containerId: factoryFxAllocations.containerId,
          allocatedAmount: factoryFxAllocations.allocatedAmount,
        })
          .from(factoryFxAllocations)
          .where(and(
            eq(factoryFxAllocations.companyId, companyId),
            inArray(factoryFxAllocations.containerId, allContainerIds)
          ))
        : [];

      const prevAllocByContainer: Record<number, number> = {};
      for (const a of prevAllocs)
        prevAllocByContainer[a.containerId] = (prevAllocByContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

      // Build per-supplier data: available balance + their containers
      const supplierData: Array<{ supplierId: number; name: string; available: number; containers: any[] }> = [];
      for (const sup of linkedSuppliers) {
        const supContainers = allContainers.filter((c: any) => c.supplierId === sup.id);
        const totalValue = supContainers.reduce((s: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          // Use freightCurrencyCode directly (DB default is "USD", so AUD containers correctly separate USD freight)
          const containerCcy = c.currencyCode || fromCurrencyCode;
          const freightCc = c.freightCurrencyCode || containerCcy;
          // Commission accumulates under supplier (true broker balance model) — include in available for settlement
          const commAmt = parseFloat(c.commissionAmount || "0");
          const commCc = c.commissionCurrencyCode || containerCcy;
          return s + (kg * rate + (freightCc === fromCurrencyCode ? freight : 0) + (commCc === fromCurrencyCode ? commAmt : 0));
        }, 0);
        const paid = paymentsBySupplier[sup.id] || 0;
        const fxOut = fxOutBySupplier[sup.id] || 0;
        const available = Math.max(0, totalValue - paid - fxOut);
        if (available > 0.001 && supContainers.length > 0) {
          supplierData.push({ supplierId: sup.id, name: sup.name, available, containers: supContainers });
        }
      }

      if (supplierData.length === 0)
        return res.status(400).json({ message: `No linked suppliers have an outstanding balance in ${fromCurrencyCode}` });

      // Sort suppliers by their oldest (or newest) container date
      supplierData.sort((a, b) => {
        const dateOf = (sd: typeof a) => sd.containers.reduce((best: string | null, c: any) => {
          const d = c.arrivalDate || c.createdAt;
          if (!best) return d;
          return order === "newest"
            ? (new Date(d) > new Date(best) ? d : best)
            : (new Date(d) < new Date(best) ? d : best);
        }, null);
        const da = dateOf(a), db2 = dateOf(b);
        if (!da) return 1; if (!db2) return -1;
        return order === "newest"
          ? new Date(db2).getTime() - new Date(da).getTime()
          : new Date(da).getTime() - new Date(db2).getTime();
      });

      // Greedy allocation: fill each supplier before moving to the next
      let rem = total;
      const allocations: Array<{ supplierId: number; name: string; allocated: number; toAmountUsd: number; overpayment: number; containers: any[] }> = [];
      for (const sd of supplierData) {
        if (rem <= 0.001) break;
        const toAllocate = Math.min(rem, sd.available);
        if (toAllocate < 0.001) continue;
        allocations.push({ supplierId: sd.supplierId, name: sd.name, allocated: toAllocate, toAmountUsd: toAllocate * fxRate, overpayment: 0, containers: sd.containers });
        rem -= toAllocate;
      }

      if (allocations.length === 0)
        return res.status(400).json({ message: "Could not allocate any amount" });

      // Any remaining after all suppliers are filled goes to the last supplier as an overpayment
      // (creates a CR balance — the supplier owes the company that amount back)
      if (rem > 0.001) {
        const last = allocations[allocations.length - 1];
        last.overpayment = rem;
        last.allocated += rem;
        last.toAmountUsd += rem * fxRate;
        rem = 0;
      }

      // Dry-run: return preview without saving
      if (dryRun) {
        const totalAllocated = allocations.reduce((s, a) => s + a.allocated, 0);
        const totalUsd = allocations.reduce((s, a) => s + a.toAmountUsd, 0);
        return res.json({
          dryRun: true,
          totalRequested: total.toFixed(4),
          totalAllocated: totalAllocated.toFixed(4),
          remaining: (total - totalAllocated).toFixed(4),
          totalUsd: totalUsd.toFixed(4),
          transfers: allocations.map(a => ({
            supplierId: a.supplierId,
            supplierName: a.name,
            allocated: a.allocated.toFixed(4),
            toAmountUsd: a.toAmountUsd.toFixed(4),
            overpayment: a.overpayment.toFixed(4),
          })),
        });
      }

      // Create FX transfers and allocation rows in a transaction
      const settlementDate = date || getClientDate(req);
      const results = await db.transaction(async (tx: any) => {
        const created: any[] = [];
        for (const alloc of allocations) {
          const [fxTransfer] = await tx.insert(factorySupplierFxTransfers).values({
            companyId,
            fromSupplierId: alloc.supplierId,
            toSupplierId: brokerId,
            fromCurrencyCode,
            fromAmount: alloc.allocated.toFixed(4),
            fxRateToUsd: fxRate.toString(),
            toAmountUsd: alloc.toAmountUsd.toFixed(4),
            date: settlementDate,
            notes: notes || null,
            sourceType: "supplier",
          }).returning();

          // Container-level allocations (oldest-first within each supplier)
          const sortedCont = [...alloc.containers].sort((a, b) =>
            order === "newest"
              ? new Date(b.arrivalDate || b.createdAt).getTime() - new Date(a.arrivalDate || a.createdAt).getTime()
              : new Date(a.arrivalDate || a.createdAt).getTime() - new Date(b.arrivalDate || b.createdAt).getTime()
          );
          let allocRem = alloc.allocated;
          const allocRows: any[] = [];
          for (const c of sortedCont) {
            if (allocRem <= 0.001) break;
            const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
            const rate = parseFloat(c.ratePerKg || "0");
            const freight = parseFloat(c.freight || "0");
            const val = kg * rate + freight;
            const used = prevAllocByContainer[c.id] || 0;
            const avail = Math.max(0, val - used);
            if (avail <= 0.001) continue;
            const toAlloc2 = Math.min(allocRem, avail);
            allocRows.push({ companyId, fxTransferId: fxTransfer.id, containerId: c.id, sourceType: "supplier", allocatedAmount: toAlloc2.toFixed(4), currencyCode: fromCurrencyCode });
            allocRem -= toAlloc2;
          }
          if (allocRows.length > 0) await tx.insert(factoryFxAllocations).values(allocRows);

          created.push({ id: fxTransfer.id, supplierId: alloc.supplierId, supplierName: alloc.name, allocated: alloc.allocated.toFixed(4), toAmountUsd: alloc.toAmountUsd.toFixed(4) });
        }
        return created;
      });

      res.json({
        success: true,
        totalRequested: total.toFixed(4),
        totalAllocated: (total - rem).toFixed(4),
        remaining: rem.toFixed(4),
        transfers: results,
      });
    } catch (error: any) {
      console.error("Bulk FX settlement error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1b. Factory Suppliers - Balances & Statement
  // ───────────────────────────────────────────────

  // Get outstanding balance for a single factory supplier (used by voucher payment balance display)
  // Uses the SAME logic as computeStats in with-balances (including freight, FX transfers,
  // voucher-based payments, and broker aggregation across linked suppliers).
}
