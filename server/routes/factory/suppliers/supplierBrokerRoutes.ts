import { parseId, parseOptionalId } from "../../../lib/parseId";
import { logger } from "../../../lib/logger";
import { getClientDate } from "../../../lib/dateUtils";
import { buildSafeFilename, contentDisposition } from "../../../lib/contentDisposition";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import { sqlArray } from "../../../lib/sqlArray";
import { resolveStoredFxRate } from "../../../services/factory/currencyConversion";
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
      const totalCommission = rows.reduce((s, r) => s + (r.commissionAmount || 0), 0);
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
        totalCommission: totalCommission.toFixed(2),
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

export function registerSupplierBrokerRoutes(app: Express) {
  app.get("/api/factory/suppliers/:id/broker-statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const includeOtw = req.query.includeOtw === "true";
      const data = await buildBrokerStatement(brokerId, companyId, includeOtw);
      if (!data) return res.status(404).json({ message: "Supplier not found" });
      return res.json(data);
    } catch (err: any) {
      logger.error("Broker statement error:", { error: err });
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/factory/suppliers/:id/broker-statement/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const includeOtw = req.query.includeOtw === "true";
      const data = await buildBrokerStatement(brokerId, companyId, includeOtw);
      if (!data) return res.status(404).json({ message: "Supplier not found" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      const typeLabel: Record<string, string> = {
        container: "Container",
        payment: "Payment",
        fx_out: "FX Out",
        fx_in: "FX In",
        commission: "Commission",
        other_charge: "Other Charge",
        freight: "Freight",
      };
      const rowTypeFill: Record<string, string> = {
        container: "FFFAFAFA",
        payment: "FFE8F5E9",
        fx_out: "FFFFF8E1",
        fx_in: "FFE3F2FD",
        commission: "FFFFF3E0",
        other_charge: "FFEDE7F6",
        freight: "FFFFF3E0",
      };

      for (const section of data.currencyLedgers) {
        const ws = wb.addWorksheet(section.currencyCode);
        ws.properties.defaultRowHeight = 15;

        // Title row
        const titleRow = ws.addRow([`Broker Statement — ${(data.supplier as any).name} — ${section.currencyCode}`]);
        titleRow.font = { bold: true, size: 13 };
        ws.mergeCells(`A${titleRow.number}:G${titleRow.number}`);
        ws.addRow([]);

        // Column headers
        const hdrRow = ws.addRow([
          "Date",
          "Type",
          "Description",
          "Amount",
          "Commission",
          "Comm. Currency",
          "Running Balance",
        ]);
        hdrRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        hdrRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        hdrRow.alignment = { horizontal: "left" };
        ["D", "E", "G"].forEach((col) => {
          const cell = hdrRow.getCell(col);
          cell.alignment = { horizontal: "right" };
        });

        ws.columns = [
          { key: "date", width: 14 },
          { key: "type", width: 14 },
          { key: "description", width: 40 },
          { key: "amount", width: 18 },
          { key: "commission", width: 16 },
          { key: "commCcy", width: 14 },
          { key: "runBal", width: 18 },
        ];

        for (const row of section.rows) {
          const dr = ws.addRow([
            row.date || "",
            typeLabel[row.type] || row.type,
            row.description,
            parseFloat((row.amount as any).toFixed(2)),
            row.commissionAmount != null ? parseFloat((row.commissionAmount as any).toFixed(2)) : "",
            row.commissionCurrency || "",
            parseFloat((row.runningBalance as any).toFixed(2)),
          ]);
          dr.getCell("D").numFmt = "#,##0.00";
          dr.getCell("E").numFmt = "#,##0.00";
          dr.getCell("G").numFmt = "#,##0.00";
          dr.getCell("D").alignment = { horizontal: "right" };
          dr.getCell("E").alignment = { horizontal: "right" };
          dr.getCell("G").alignment = { horizontal: "right" };
          const fillArgb = rowTypeFill[row.type] || "FFFFFFFF";
          dr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        }

        // Spacer
        ws.addRow([]);

        // Totals
        const totalsLabel = ws.addRow(["SECTION TOTALS"]);
        totalsLabel.font = { bold: true };
        const totalsData = ws.addRow([
          "",
          "",
          `Containers: ${section.totalContainers}  |  Freight: ${section.totalFreight}  |  Paid: ${section.totalPaid}  |  FX Out: ${section.totalFxOut}`,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          "",
          parseFloat(section.netBalance),
        ]);
        totalsData.font = { bold: true };
        totalsData.getCell("D").numFmt = "#,##0.00";
        totalsData.getCell("E").numFmt = "#,##0.00";
        totalsData.getCell("G").numFmt = "#,##0.00";
        ["D", "E", "G"].forEach((col) => {
          totalsData.getCell(col).alignment = { horizontal: "right" };
        });
        totalsData.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFD8DC" } };
      }

      // Summary sheet
      const sumWs = wb.addWorksheet("Summary");
      sumWs.addRow([`Broker Consolidated Statement — ${(data.supplier as any).name}`]).font = { bold: true, size: 13 };
      sumWs.addRow([
        `Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
      ]).font = { italic: true };
      sumWs.addRow([]);
      const sumHdr = sumWs.addRow([
        "Currency",
        "Containers",
        "Gross Value",
        "Commission",
        "Freight",
        "FX Out",
        "FX In",
        "Paid",
        "Net Balance",
      ]);
      sumHdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
      sumHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      for (const section of data.currencyLedgers) {
        const dr = sumWs.addRow([
          section.currencyCode,
          section.totalContainers,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          parseFloat(section.totalFreight || "0"),
          parseFloat(section.totalFxOut),
          parseFloat(section.totalFxIn),
          parseFloat(section.totalPaid),
          parseFloat(section.netBalance),
        ]);
        // Colour FX Out red, FX In green for clarity
        ["C", "D", "E", "F", "G", "H", "I"].forEach((col) => {
          dr.getCell(col).numFmt = "#,##0.00";
          dr.getCell(col).alignment = { horizontal: "right" };
        });
        const fxOutVal = parseFloat(section.totalFxOut);
        const fxInVal = parseFloat(section.totalFxIn);
        const freightVal = parseFloat(section.totalFreight || "0");
        if (fxOutVal > 0) {
          dr.getCell("F").font = { color: { argb: "FFCC0000" } };
        }
        if (fxInVal > 0) {
          dr.getCell("G").font = { color: { argb: "FF006600" } };
        }
        if (freightVal > 0) {
          dr.getCell("E").font = { color: { argb: "FFE65100" } };
        }
        // Bold the Net Balance
        dr.getCell("I").font = { bold: true };
      }
      sumWs.columns = [
        { width: 12 },
        { width: 14 },
        { width: 18 },
        { width: 16 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 16 },
        { width: 18 },
      ];

      const xlsBuffer = Buffer.from(await wb.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        contentDisposition(buildSafeFilename(["broker-statement", (data.supplier as any).name || String(brokerId), getClientDate(req)], "xlsx"))
      );
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (err: any) {
      logger.error("Broker statement export error:", { error: err });
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // ── Broker Visual Statement (container-centric view for the new dedicated page) ──
  app.get("/api/factory/suppliers/:id/broker-visual-statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const from: string | undefined = req.query.from as string | undefined;
      const to: string | undefined = req.query.to as string | undefined;

      // Broker + linked suppliers
      const [broker] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
      if (!broker) return res.status(404).json({ message: "Supplier not found" });

      const linked = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId)));
      const allSupplierIds = [broker.id, ...linked.map((s: any) => s.id)];
      const nameMap: Record<number, string> = {};
      for (const s of [broker, ...linked]) nameMap[(s as any).id] = (s as any).name;

      // Containers (filtered by arrival date if provided)
      let containerQuery = db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), inArray(factoryContainers.supplierId, allSupplierIds)))
        .$dynamic();
      if (from) containerQuery = containerQuery.where(sql`${factoryContainers.arrivalDate} >= ${from}`);
      if (to) containerQuery = containerQuery.where(sql`${factoryContainers.arrivalDate} <= ${to}`);
      const containers = await containerQuery.orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt);

      // Build container rows
      const containerRows = (containers as any[]).map((c: any) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        return {
          id: c.id,
          supplierName: nameMap[c.supplierId] || "Unknown",
          containerNumber: c.containerNumber,
          weight: kg,
          ratePerKg: rate,
          goodsAmount: kg * rate,
          goodsCurrency: c.currencyCode || "USD",
          freightAmount: parseFloat(c.freight || "0"),
          freightCurrency: c.freightCurrencyCode || "USD",
          commissionAmount: parseFloat(c.commissionAmount || "0"),
          commissionCurrency: c.commissionCurrencyCode || "USD",
          arrivalDate: c.arrivalDate ? String(c.arrivalDate) : null,
          status: c.status,
        };
      });

      // Payments (direct)
      let payQuery = db
        .select()
        .from(factorySupplierPayments)
        .where(
          and(
            eq(factorySupplierPayments.companyId, companyId),
            inArray(factorySupplierPayments.supplierId, allSupplierIds)
          )
        )
        .$dynamic();
      if (from) payQuery = payQuery.where(sql`${factorySupplierPayments.date} >= ${from}`);
      if (to) payQuery = payQuery.where(sql`${factorySupplierPayments.date} <= ${to}`);
      const payments = await payQuery.orderBy(factorySupplierPayments.date);

      // FX transfers involving any of the suppliers
      let fxQuery = db
        .select()
        .from(factorySupplierFxTransfers)
        .where(
          and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            sql`(${factorySupplierFxTransfers.fromSupplierId} = ANY(${sqlArray(allSupplierIds)}) OR ${factorySupplierFxTransfers.toSupplierId} = ANY(${sqlArray(allSupplierIds)}))`
          )
        )
        .$dynamic();
      if (from) fxQuery = fxQuery.where(sql`${factorySupplierFxTransfers.date} >= ${from}`);
      if (to) fxQuery = fxQuery.where(sql`${factorySupplierFxTransfers.date} <= ${to}`);
      const fxTransfers = await fxQuery.orderBy(factorySupplierFxTransfers.date);

      // Voucher payments (non-optional only)
      let vpayRows: any[] = [];
      if (allSupplierIds.length > 0) {
        let vpayQ = db
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
              sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`,
              eq(vouchers.optional, false)
            )
          )
          .$dynamic();
        if (from) vpayQ = vpayQ.where(sql`${vouchers.voucherDate} >= ${from}`);
        if (to) vpayQ = vpayQ.where(sql`${vouchers.voucherDate} <= ${to}`);
        vpayRows = await vpayQ.orderBy(vouchers.voucherDate);
      }

      // Build payment rows (unified format)
      type PayRow = {
        id: string;
        date: string | null;
        type: "payment" | "fx_in" | "fx_out" | "voucher";
        fromCurrency: string;
        fromAmount: number;
        fxRate: number | null;
        usdAmount: number;
        notes: string | null;
        supplierName?: string;
      };

      const paymentRows: PayRow[] = [];

      for (const p of payments as any[]) {
        const amt = parseFloat(p.amount || "0");
        const cc = p.currencyCode || "USD";
        // factory_supplier_payments has no fxRateConfirmed column yet — legacy heuristic stopgap.
        // usdAmount always uses the actually-persisted amountUsd (never recomputed here); this
        // rate is purely a display hint, and is shown as null (not a guessed 1) when unresolved.
        const { fxRate: rate, looksSet } = resolveStoredFxRate(cc, p.fxRateToUsd);
        const usd = parseFloat(p.amountUsd || String(amt));
        paymentRows.push({
          id: `pay-${p.id}`,
          date: p.date ? String(p.date) : null,
          type: "payment",
          fromCurrency: cc,
          fromAmount: amt,
          fxRate: cc === "USD" || !looksSet ? null : rate,
          usdAmount: usd,
          notes: p.notes || null,
          supplierName: nameMap[p.supplierId],
        });
      }

      for (const v of vpayRows as any[]) {
        const amt = parseFloat(v.debitAmount || "0");
        paymentRows.push({
          id: `vpay-${v.id}`,
          date: v.voucherDate ? String(v.voucherDate) : null,
          type: "voucher",
          fromCurrency: v.currency || "USD",
          fromAmount: amt,
          fxRate: null,
          usdAmount: amt,
          notes: v.voucherNumber || v.description || null,
          supplierName: nameMap[v.supplierId],
        });
      }

      const seenFx = new Set<number>();
      for (const t of fxTransfers as any[]) {
        if (seenFx.has(t.id)) continue;
        seenFx.add(t.id);
        const fromCc = t.fromCurrencyCode || "USD";
        const fromAmt = parseFloat(t.fromAmount || "0");
        const toUsd = parseFloat(t.toAmountUsd || "0");
        const rate = fromAmt > 0 ? toUsd / fromAmt : 1;
        const dateVal = t.date ? String(t.date) : null;

        if (t.toSupplierId === brokerId) {
          // FX In to broker
          paymentRows.push({
            id: `fx-in-${t.id}`,
            date: dateVal,
            type: "fx_in",
            fromCurrency: fromCc,
            fromAmount: fromAmt,
            fxRate: fromCc !== "USD" ? parseFloat(rate.toFixed(6)) : null,
            usdAmount: toUsd,
            notes: t.notes || null,
            supplierName: nameMap[t.fromSupplierId],
          });
        }

        if (t.fromSupplierId === brokerId && fromCc === "USD") {
          // FX Out from broker (USD redistribution)
          paymentRows.push({
            id: `fx-out-${t.id}`,
            date: dateVal,
            type: "fx_out",
            fromCurrency: "USD",
            fromAmount: -fromAmt,
            fxRate: null,
            usdAmount: -fromAmt,
            notes: t.notes || null,
            supplierName: nameMap[t.toSupplierId],
          });
        }
      }

      // Sort payment rows by date
      paymentRows.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return -1;
        if (!b.date) return 1;
        return a.date.localeCompare(b.date);
      });

      // Summary: credit (containers owed) and paid, per currency
      const creditByCurrency: Record<string, number> = {};
      const addCredit = (cc: string, amt: number) => {
        creditByCurrency[cc] = (creditByCurrency[cc] || 0) + amt;
      };
      for (const c of containerRows) {
        if (c.goodsAmount > 0) addCredit(c.goodsCurrency, c.goodsAmount);
        if (c.freightAmount > 0) addCredit(c.freightCurrency, c.freightAmount);
        if (c.commissionAmount > 0) addCredit(c.commissionCurrency, c.commissionAmount);
      }
      const paidByCurrency: Record<string, number> = {};
      const addPaid = (cc: string, amt: number) => {
        paidByCurrency[cc] = (paidByCurrency[cc] || 0) + amt;
      };
      for (const p of paymentRows) {
        addPaid(p.fromCurrency, p.fromAmount);
      }

      return res.json({
        broker: { id: broker.id, name: (broker as any).name },
        linkedSuppliers: linked.map((s: any) => ({ id: s.id, name: s.name })),
        containers: containerRows,
        payments: paymentRows,
        creditByCurrency,
        paidByCurrency,
      });
    } catch (err: any) {
      logger.error("Broker visual statement error:", { error: err });
      return res.status(500).json({ message: err.message });
    }
  });

  // ── Direct containers for a broker ────────────────────────────────────────
  // Returns containers whose supplier_id = brokerId (excludes children's containers).
  // Used by the Broker Overview Panel to show unassigned / direct containers.
  app.get("/api/factory/suppliers/:id/direct-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });

      const containers = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          status: factoryContainers.status,
          currencyCode: factoryContainers.currencyCode,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          finalPayableAmount: factoryContainers.finalPayableAmount,
          arrivalDate: factoryContainers.arrivalDate,
          origin: factoryContainers.origin,
        })
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            eq(factoryContainers.supplierId, brokerId),
            isNull(factoryContainers.deletedAt)
          )
        )
        .orderBy(desc(factoryContainers.arrivalDate), desc(factoryContainers.createdAt));

      return res.json(containers);
    } catch (err: any) {
      logger.error("Direct containers error:", { error: err });
      return res.status(500).json({ message: err.message });
    }
  });

  // ───────────────────────────────────────────────
  // 2. Factory Categories CRUD
  // ───────────────────────────────────────────────
}
