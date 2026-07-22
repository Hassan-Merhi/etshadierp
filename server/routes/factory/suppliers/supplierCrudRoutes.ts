import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { removeDaybookEntriesForSource } from "../../../services/factory/daybookSourceIntegrity";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import { sqlArray } from "../../../lib/sqlArray";
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

export function registerSupplierCrudRoutes(app: Express) {
  app.get("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierSchema.parse({ ...req.body, companyId });
      const [supplier] = await db.insert(factorySuppliers).values(parsed).returning();
      res.json(supplier);
    } catch (error: any) {
      console.error("Error creating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factorySuppliers)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factorySuppliers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/suppliers/:id/reactivate", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factorySuppliers)
        .set({ isActive: true, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error reactivating factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Overwrite a factory supplier's opening balance
  app.patch("/api/factory/suppliers/:id/opening-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid supplier id" });

      const { openingBalance } = req.body;
      if (openingBalance === undefined || openingBalance === null || openingBalance === "") {
        return res.status(400).json({ message: "openingBalance is required" });
      }
      const val = parseFloat(openingBalance);
      if (isNaN(val)) {
        return res.status(400).json({ message: "openingBalance must be a valid number" });
      }

      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .limit(1);

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const [updated] = await db
        .update(factorySuppliers)
        .set({ openingBalance: String(val) })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supplier opening balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Mark / unmark a supplier as broker (explicit flag, independent of whether children exist)
  app.patch("/api/factory/suppliers/:id/set-broker", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { isBroker } = req.body;
      if (typeof isBroker !== "boolean") return res.status(400).json({ message: "isBroker must be boolean" });
      // A broker cannot itself have a parent (it IS the parent)
      if (isBroker) {
        const [sup] = await db
          .select({ parentId: factorySuppliers.parentId })
          .from(factorySuppliers)
          .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
          .limit(1);
        if (sup?.parentId) {
          return res.status(400).json({ message: "A linked supplier (child) cannot be set as broker directly. Remove the parent link first." });
        }
      }
      const [updated] = await db
        .update(factorySuppliers)
        .set({ isBroker, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error setting broker flag:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Hard-delete a factory supplier — cascades through all related records
  app.delete("/api/factory/suppliers/:id/permanent", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)));

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      // 1. Collect container IDs belonging to this supplier
      const supplierContainers = await db
        .select({ id: factoryContainers.id })
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, id)));
      const containerIds = supplierContainers.map((c) => c.id);

      // 2. Cascade-delete container-level dependents (only when containers exist)
      if (containerIds.length > 0) {
        await db.delete(factoryFxAllocations).where(inArray(factoryFxAllocations.containerId, containerIds));
        await db
          .delete(factoryOffloadAdditionalCharges)
          .where(inArray(factoryOffloadAdditionalCharges.containerId, containerIds));
        await db
          .delete(factoryContainerCommissions)
          .where(inArray(factoryContainerCommissions.containerId, containerIds));
        await db.delete(factoryMixBatchSources).where(inArray(factoryMixBatchSources.containerId, containerIds));
        await db.delete(factoryRawStock).where(inArray(factoryRawStock.containerId, containerIds));
        await db.delete(factoryContainers).where(inArray(factoryContainers.id, containerIds));
      }

      // 3. Delete supplier-level financial records
      await db
        .delete(factorySupplierFxTransfers)
        .where(
          and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            or(eq(factorySupplierFxTransfers.fromSupplierId, id), eq(factorySupplierFxTransfers.toSupplierId, id))
          )
        );
      await db
        .delete(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), eq(factorySupplierPayments.supplierId, id)));
      await db
        .delete(factorySupplierScoreSnapshots)
        .where(
          and(eq(factorySupplierScoreSnapshots.companyId, companyId), eq(factorySupplierScoreSnapshots.supplierId, id))
        );

      // 4. Finally delete the supplier itself
      await db
        .delete(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)));

      res.json({ message: "Supplier permanently deleted" });
    } catch (error: any) {
      console.error("Error permanently deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1b. Factory Supplier Categories
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const cats = await db
        .select()
        .from(factorySupplierCategories)
        .where(eq(factorySupplierCategories.companyId, companyId))
        .orderBy(asc(factorySupplierCategories.displayOrder), asc(factorySupplierCategories.name));
      res.json(cats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/factory/supplier-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertFactorySupplierCategorySchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(factorySupplierCategories).values(parsed).returning();
      res.json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/factory/supplier-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { name, displayOrder } = req.body;
      const [updated] = await db
        .update(factorySupplierCategories)
        .set({
          ...(name !== undefined && { name }),
          ...(displayOrder !== undefined && { displayOrder }),
          updatedAt: new Date(),
        })
        .where(and(eq(factorySupplierCategories.id, id), eq(factorySupplierCategories.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/factory/supplier-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      // Unassign any suppliers that belong to this category
      await db
        .update(factorySuppliers)
        .set({ supplierCategoryId: null, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.companyId, companyId), eq(factorySuppliers.supplierCategoryId, id)));
      const [deleted] = await db
        .delete(factorySupplierCategories)
        .where(and(eq(factorySupplierCategories.id, id), eq(factorySupplierCategories.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Category not found" });
      res.json({ message: "Category deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1c. Factory Supplier Payments
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = req.query.supplierId ? parseOptionalId(req.query.supplierId) : null;

      // Also fetch all sub-accounts of the supplier to include their payments
      const supplierIds: number[] = supplierId ? [supplierId] : [];
      if (supplierId) {
        const children = await db
          .select({ id: factorySuppliers.id })
          .from(factorySuppliers)
          .where(and(eq(factorySuppliers.companyId, companyId), eq((factorySuppliers as any).parentId, supplierId)));
        children.forEach((c: any) => supplierIds.push(c.id));
      }

      const paymentConditions = [eq(factorySupplierPayments.companyId, companyId)];
      if (supplierIds.length > 0) {
        paymentConditions.push(inArray(factorySupplierPayments.supplierId, supplierIds));
      }

      const payments = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(...paymentConditions))
        .orderBy(desc(factorySupplierPayments.date));
      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching supplier payments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierPaymentSchema.parse({ ...req.body, companyId });

      // Reject writes with an unresolved non-USD rate rather than silently posting the
      // payment voucher at an assumed rate of 1 — factory_supplier_payments has no
      // fxRateConfirmed flag yet, so any explicitly-supplied rate is trusted as-is.
      const payCurrency = (parsed as any).currencyCode || "USD";
      if (payCurrency !== "USD") {
        const suppliedRate = parseFloat((parsed as any).fxRateToUsd || "0");
        if (!(suppliedRate > 0)) {
          return res.status(400).json({
            message: `Cannot record a ${payCurrency} payment without an explicit exchange rate to USD.`,
          });
        }
      }

      const created = await db.transaction(async (tx: any) => {
        const [payment] = await tx.insert(factorySupplierPayments).values(parsed).returning();

        // Double-entry Payment voucher: DR Supplier Payable / CR Bank or Cash
        const payAmt = parseFloat(payment.amount);
        const payAmtStr = payAmt.toFixed(2);
        const payVoucherNum = `FACTORY-PAY-${payment.id}-${Date.now()}`;

        const [payVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherType: "Payment",
            voucherNumber: payVoucherNum,
            voucherDate: payment.date,
            description: `Supplier payment – see factory payment #${payment.id}`,
            totalAmount: payAmtStr,
            currency: payment.currencyCode || "USD",
            exchangeRate: String(parseFloat((payment.fxRateToUsd as string) || "1")),
            sourceModule: "FACTORY",
            effectiveDate: (req.body.effectiveDate as string) || null,
          })
          .returning();

        // DR: Factory Supplier (debit reduces the liability we owe them)
        await tx.insert(voucherEntries).values({
          voucherId: payVoucher.id,
          factorySupplierId: payment.supplierId,
          debitAmount: payAmtStr,
          creditAmount: "0",
          narration: `Payment to supplier – factory payment #${payment.id}`,
        });

        // CR: Bank/Cash ledger account (or auto-created "Factory Cash Payments" if not specified)
        const crAccountId = payment.paidFromAccountId
          ? payment.paidFromAccountId
          : await getOrCreateLedgerAccount(companyId, "FACTORY_CASH_PAYMENTS", "Factory Cash Payments", "ASSET");

        await tx.insert(voucherEntries).values({
          voucherId: payVoucher.id,
          ledgerAccountId: crAccountId,
          debitAmount: "0",
          creditAmount: payAmtStr,
          narration: `Bank/cash outflow – factory payment #${payment.id}`,
        });

        return payment;
      });

      const [spSupplier] = await db
        .select({ name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(eq(factorySuppliers.id, created.supplierId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_PAYMENT",
        referenceId: created.id,
        referenceTable: "factory_supplier_payments",
        description: `Supplier payment: ${spSupplier?.name || "Unknown"} – ${parseFloat(created.amount).toFixed(2)} ${created.currencyCode}`,
        amountCurrency: parseFloat(created.amount),
        amountUsd: parseFloat(created.amountUsd),
        currencyCode: created.currencyCode,
        effectiveDate: (req.body.effectiveDate as string) || null,
      });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating supplier payment:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/supplier-payments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [payment] = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      const [spDelSupplier] = payment
        ? await db
            .select({ name: factorySuppliers.name })
            .from(factorySuppliers)
            .where(eq(factorySuppliers.id, payment.supplierId))
        : [null];

      await db.transaction(async (tx: any) => {
        // Hard-delete the auto-generated Payment voucher and its entries for this payment
        const payVoucherPattern = `FACTORY-PAY-${id}-%`;
        const payVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE ${payVoucherPattern}`));
        if (payVouchers.length > 0) {
          const vIds = payVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }
        // Remove the original SUPPLIER_PAYMENT daybook entry (including legacy rows
        // written before referenceTable was populated).
        await removeDaybookEntriesForSource(tx, {
          companyId,
          referenceTable: "factory_supplier_payments",
          referenceId: id,
          txTypes: ["SUPPLIER_PAYMENT"],
        });
        await tx
          .delete(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      });

      if (payment) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: getClientDate(req),
          txType: "SUPPLIER_PAYMENT_DELETE",
          description: `Supplier payment deleted: ${spDelSupplier?.name || "Unknown"} – ${parseFloat(payment.amount).toFixed(2)} ${payment.currencyCode} (dated ${payment.date})`,
        });
      }
      res.json({ message: "Payment deleted" });
    } catch (error: any) {
      console.error("Error deleting supplier payment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1a-ii. Factory Supplier FX Transfers
  // ───────────────────────────────────────────────
}
