/**
 * Expanded, read-only raw-material reconciliation report.
 *
 * Complements the FX-unresolved scan (fxDiagnosticRoutes.ts) with the broader
 * set of checks a real production hardening pass needs before the FX repair
 * tooling can be trusted: kg accounting (received/used/reserved/free),
 * stored-vs-expected locked cost/kg and free-stock value, supplier currency
 * exposure, cross-company contamination, double-reserved deductions, and
 * negative stock. Every computation here is a SELECT — nothing is written,
 * and nothing here performs a lazy-backfill write (uses the ReadOnly locked
 * rate helper via getLockedRateDiagnosticsForCompany).
 */
import { eq, and, sql, isNull, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  factorySuppliers,
  factoryRawStock,
  factoryContainers,
  factoryMixBatchSources,
  factoryMixBatches,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
} from "@shared/schema";
import { getLockedRateDiagnosticsForCompany, type LockedRateDiagnosticRow } from "./rawStockLockedRate";
import { resolveStoredFxRate } from "./currencyConversion";

export interface KgSummary {
  receivedKg: number;
  usedKg: number;
  reservedKg: number;
  freeKg: number;
  negativeStockCount: number;
  negativeStockRows: Array<{ rawStockId: number; containerId: number; containerNumber: string | null; freeKg: number }>;
}

export interface SupplierCurrencyExposureRow {
  supplierId: number;
  supplierName: string;
  byCurrency: Record<string, { resolvedNative: number; unresolvedNative: number; unresolvedCount: number }>;
}

export interface CrossCompanyContaminationRow {
  table: "factory_containers" | "factory_raw_stock" | "factory_mix_batch_sources";
  rowId: number;
  rowCompanyId: number;
  referencedEntity: string;
  referencedCompanyId: number;
  detail: string;
}

export interface DoubleReservedRow {
  containerId: number;
  containerNumber: string | null;
  remainingKg: number;
  reservedKg: number;
  overCommittedKg: number;
}

export interface RawMaterialReconciliation {
  companyId: number;
  scannedAt: string;
  kgSummary: KgSummary;
  lockedRateDiagnostics: LockedRateDiagnosticRow[];
  lockedRateDriftCount: number;
  supplierCurrencyExposure: SupplierCurrencyExposureRow[];
  crossCompanyContamination: CrossCompanyContaminationRow[];
  doubleReservedDeductions: DoubleReservedRow[];
  negativeStockCount: number;
}

const EPS = 0.01;

export async function getRawMaterialReconciliation(companyId: number): Promise<RawMaterialReconciliation> {
  // ── 1. Received / used / reserved / free kg, negative stock ──────────────
  const rawStockRows = await db
    .select({
      id: factoryRawStock.id,
      containerId: factoryRawStock.containerId,
      receivedKg: factoryRawStock.receivedKg,
      usedKg: factoryRawStock.usedKg,
      containerNumber: factoryContainers.containerNumber,
    })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryContainers.id, factoryRawStock.containerId))
    .where(and(eq(factoryRawStock.companyId, companyId), isNull(factoryRawStock.deletedAt)));

  let receivedKg = 0;
  let usedKg = 0;
  const negativeStockRows: KgSummary["negativeStockRows"] = [];
  for (const r of rawStockRows) {
    const rec = parseFloat(r.receivedKg as string) || 0;
    const used = parseFloat(r.usedKg as string) || 0;
    receivedKg += rec;
    usedKg += used;
    const free = rec - used;
    if (free < -EPS) {
      negativeStockRows.push({ rawStockId: r.id, containerId: r.containerId, containerNumber: r.containerNumber, freeKg: free });
    }
  }

  const [{ reservedKgTotal }] = await db
    .select({
      reservedKgTotal: sql<string>`COALESCE(SUM(${factoryMixBatchSources.weightKg}), 0)`,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .where(
      and(
        eq(factoryMixBatches.companyId, companyId),
        sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`,
        isNull(factoryMixBatches.deletedAt)
      )
    );

  const kgSummary: KgSummary = {
    receivedKg,
    usedKg,
    reservedKg: parseFloat(reservedKgTotal || "0") || 0,
    // Model A (matches rawStockReceiptRoutes.ts / rawStockDiagnosticRoutes.ts): usedKg
    // already reflects mix-batch consumption, so freeKg is received-used, NOT that
    // minus reservedKg a second time — reservedKg is informational exposure only.
    freeKg: receivedKg - usedKg,
    negativeStockCount: negativeStockRows.length,
    negativeStockRows,
  };

  // ── 2. Stored vs expected locked cost/kg and free-stock value ────────────
  const lockedRateDiagnostics = await getLockedRateDiagnosticsForCompany(companyId);
  const lockedRateDriftCount = lockedRateDiagnostics.filter((r) => Math.abs(parseFloat(r.difference)) > EPS).length;

  // ── 3. Supplier currency exposure (resolved vs unresolved native amounts) ─
  const suppliers = await db
    .select({ id: factorySuppliers.id, name: factorySuppliers.name })
    .from(factorySuppliers)
    .where(eq(factorySuppliers.companyId, companyId));
  const supplierNameById = new Map<number, string>(suppliers.map((s) => [s.id, s.name]));

  const exposureBySupplier = new Map<number, SupplierCurrencyExposureRow>();
  function bumpExposure(
    supplierId: number | null,
    currencyCode: string,
    nativeAmount: number,
    resolved: boolean
  ) {
    if (!supplierId) return;
    if (!exposureBySupplier.has(supplierId)) {
      exposureBySupplier.set(supplierId, {
        supplierId,
        supplierName: supplierNameById.get(supplierId) || "Unknown Supplier",
        byCurrency: {},
      });
    }
    const row = exposureBySupplier.get(supplierId)!;
    if (!row.byCurrency[currencyCode]) {
      row.byCurrency[currencyCode] = { resolvedNative: 0, unresolvedNative: 0, unresolvedCount: 0 };
    }
    if (resolved) row.byCurrency[currencyCode].resolvedNative += nativeAmount;
    else {
      row.byCurrency[currencyCode].unresolvedNative += nativeAmount;
      row.byCurrency[currencyCode].unresolvedCount += 1;
    }
  }

  const nonUsdContainers = await db
    .select()
    .from(factoryContainers)
    .where(and(eq(factoryContainers.companyId, companyId), ne(factoryContainers.currencyCode, "USD")));
  for (const c of nonUsdContainers as any[]) {
    const { looksSet } = resolveStoredFxRate(c.currencyCode, c.fxRateToUsd, c.fxRateConfirmed);
    const amt = (parseFloat(c.ratePerKg || "0") || 0) * (parseFloat(c.actualReceivedKg || c.totalKg || "0") || 0);
    bumpExposure(c.supplierId, c.currencyCode, amt, looksSet);
  }

  const allContainersById = new Map<number, any>(
    (await db.select().from(factoryContainers).where(eq(factoryContainers.companyId, companyId))).map((c: any) => [
      c.id,
      c,
    ])
  );

  const nonUsdCharges = await db
    .select()
    .from(factoryOffloadAdditionalCharges)
    .where(
      and(eq(factoryOffloadAdditionalCharges.companyId, companyId), ne(factoryOffloadAdditionalCharges.currencyCode, "USD"))
    );
  for (const oc of nonUsdCharges as any[]) {
    const { looksSet } = resolveStoredFxRate(oc.currencyCode, oc.fxRateToUsd, oc.fxRateConfirmed);
    const container = allContainersById.get(oc.containerId);
    const supplierId = oc.supplierId ?? container?.supplierId ?? null;
    bumpExposure(supplierId, oc.currencyCode, parseFloat(oc.amount || "0") || 0, looksSet);
  }

  const nonUsdCommissions = await db
    .select()
    .from(factoryContainerCommissions)
    .where(
      and(eq(factoryContainerCommissions.companyId, companyId), ne(factoryContainerCommissions.currencyCode, "USD"))
    );
  for (const cm of nonUsdCommissions as any[]) {
    const { looksSet } = resolveStoredFxRate(cm.currencyCode, cm.fxRateToUsd, cm.fxRateConfirmed);
    const container = allContainersById.get(cm.containerId);
    bumpExposure(container?.supplierId ?? null, cm.currencyCode, parseFloat(cm.commissionTotal || "0") || 0, looksSet);
  }

  // ── 4. Cross-company contamination ────────────────────────────────────────
  const crossCompanyContamination: CrossCompanyContaminationRow[] = [];
  const allSuppliersEverywhere = await db.select({ id: factorySuppliers.id, companyId: factorySuppliers.companyId }).from(factorySuppliers);
  const supplierCompanyById = new Map<number, number>(allSuppliersEverywhere.map((s) => [s.id, s.companyId]));

  for (const c of allContainersById.values()) {
    if (c.supplierId && supplierCompanyById.has(c.supplierId) && supplierCompanyById.get(c.supplierId) !== c.companyId) {
      crossCompanyContamination.push({
        table: "factory_containers",
        rowId: c.id,
        rowCompanyId: c.companyId,
        referencedEntity: `supplier #${c.supplierId}`,
        referencedCompanyId: supplierCompanyById.get(c.supplierId)!,
        detail: `Container ${c.containerNumber} (company ${c.companyId}) references supplier #${c.supplierId} which belongs to company ${supplierCompanyById.get(c.supplierId)}`,
      });
    }
  }

  const allRawStockCompanyCheck = await db
    .select({ id: factoryRawStock.id, companyId: factoryRawStock.companyId, containerId: factoryRawStock.containerId, containerCompanyId: factoryContainers.companyId, containerNumber: factoryContainers.containerNumber })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryContainers.id, factoryRawStock.containerId))
    .where(isNull(factoryRawStock.deletedAt));
  for (const rs of allRawStockCompanyCheck) {
    if (rs.companyId !== rs.containerCompanyId) {
      crossCompanyContamination.push({
        table: "factory_raw_stock",
        rowId: rs.id,
        rowCompanyId: rs.companyId,
        referencedEntity: `container #${rs.containerId}`,
        referencedCompanyId: rs.containerCompanyId,
        detail: `Raw stock row #${rs.id} (company ${rs.companyId}) references container ${rs.containerNumber} which belongs to company ${rs.containerCompanyId}`,
      });
    }
  }

  const allMixSourcesCheck = await db
    .select({
      id: factoryMixBatchSources.id,
      supplierId: factoryMixBatchSources.supplierId,
      batchCompanyId: factoryMixBatches.companyId,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .where(and(sql`${factoryMixBatchSources.supplierId} IS NOT NULL`, isNull(factoryMixBatches.deletedAt)));
  for (const ms of allMixSourcesCheck) {
    const supplierCompanyId = ms.supplierId ? supplierCompanyById.get(ms.supplierId) : undefined;
    if (ms.supplierId && supplierCompanyId !== undefined && supplierCompanyId !== ms.batchCompanyId) {
      crossCompanyContamination.push({
        table: "factory_mix_batch_sources",
        rowId: ms.id,
        rowCompanyId: ms.batchCompanyId,
        referencedEntity: `supplier #${ms.supplierId}`,
        referencedCompanyId: supplierCompanyId,
        detail: `Mix batch source #${ms.id} (batch company ${ms.batchCompanyId}) references supplier #${ms.supplierId} which belongs to company ${supplierCompanyId}`,
      });
    }
  }
  // Restrict to rows visible from this company's own data (rowCompanyId === companyId),
  // avoiding a report about ANOTHER company's isolated contamination when scanning company A.
  const scopedContamination = crossCompanyContamination.filter((r) => r.rowCompanyId === companyId);

  // ── 5. Double-reserved deductions: active mix-batch reservations against a
  // specific container exceeding that container's own remaining kg ─────────
  const reservedByContainer = await db
    .select({
      containerId: factoryMixBatchSources.containerId,
      reservedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .where(
      and(
        eq(factoryMixBatches.companyId, companyId),
        sql`${factoryMixBatchSources.containerId} IS NOT NULL`,
        sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`,
        isNull(factoryMixBatches.deletedAt)
      )
    )
    .groupBy(factoryMixBatchSources.containerId);

  const remainingByContainer = new Map<number, number>();
  for (const r of rawStockRows) {
    const rec = parseFloat(r.receivedKg as string) || 0;
    const used = parseFloat(r.usedKg as string) || 0;
    remainingByContainer.set(r.containerId, (remainingByContainer.get(r.containerId) || 0) + (rec - used));
  }

  const doubleReservedDeductions: DoubleReservedRow[] = [];
  for (const r of reservedByContainer) {
    if (!r.containerId) continue;
    const reserved = parseFloat(r.reservedKg as string) || 0;
    const remaining = remainingByContainer.get(r.containerId) || 0;
    if (reserved - remaining > EPS) {
      const container = allContainersById.get(r.containerId);
      doubleReservedDeductions.push({
        containerId: r.containerId,
        containerNumber: container?.containerNumber ?? null,
        remainingKg: remaining,
        reservedKg: reserved,
        overCommittedKg: reserved - remaining,
      });
    }
  }

  return {
    companyId,
    scannedAt: new Date().toISOString(),
    kgSummary,
    lockedRateDiagnostics,
    lockedRateDriftCount,
    supplierCurrencyExposure: Array.from(exposureBySupplier.values()),
    crossCompanyContamination: scopedContamination,
    doubleReservedDeductions,
    negativeStockCount: negativeStockRows.length,
  };
}
