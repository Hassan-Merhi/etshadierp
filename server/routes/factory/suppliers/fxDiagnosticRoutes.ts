/**
 * Read-only raw-material FX diagnostic.
 *
 * Scans every raw-material financial write surface that carries a per-row
 * currency + exchange rate (containers, post-offload additional charges,
 * container commissions) for the current company and reports, without
 * writing anything, which rows have an unresolved (unconfirmed, non-USD)
 * rate — broken down by supplier, container, currency, and status.
 *
 * This is intentionally separate from the repair service: it never mutates
 * data, so it is safe for any authenticated factory user, not just admins.
 */
import type { Express } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import {
  factoryContainers,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factorySuppliers,
} from "@shared/schema";
import { resolveStoredFxRate } from "../../../services/factory/currencyConversion";

interface UnresolvedRow {
  source: "container" | "offload_additional_charge" | "commission";
  id: number;
  containerId: number;
  containerNumber: string | null;
  supplierId: number | null;
  supplierName: string | null;
  status: string | null;
  currencyCode: string;
  storedFxRateToUsd: string | null;
  fxRateConfirmed: boolean;
  amountNative: string | null;
  description: string | null;
}

export function registerFactoryFxDiagnosticRoutes(app: Express) {
  app.get("/api/factory/suppliers/fx-diagnostic", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliers = await db
        .select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));
      const supplierNameById = new Map<number, string>(suppliers.map((s: any) => [s.id, s.name]));

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), ne(factoryContainers.currencyCode, "USD")));
      const containerById = new Map<number, any>(containers.map((c: any) => [c.id, c]));

      const containerIds = containers.map((c: any) => c.id);

      const offloadCharges =
        containerIds.length > 0
          ? await db
              .select()
              .from(factoryOffloadAdditionalCharges)
              .where(
                and(
                  eq(factoryOffloadAdditionalCharges.companyId, companyId),
                  ne(factoryOffloadAdditionalCharges.currencyCode, "USD")
                )
              )
          : [];

      const commissions =
        await db
          .select()
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              ne(factoryContainerCommissions.currencyCode, "USD")
            )
          );

      const unresolved: UnresolvedRow[] = [];
      let containersScanned = 0;
      let chargesScanned = 0;
      let commissionsScanned = 0;

      for (const c of containers as any[]) {
        containersScanned++;
        const { looksSet } = resolveStoredFxRate(c.currencyCode, c.fxRateToUsd, c.fxRateConfirmed);
        if (!looksSet) {
          unresolved.push({
            source: "container",
            id: c.id,
            containerId: c.id,
            containerNumber: c.containerNumber,
            supplierId: c.supplierId,
            supplierName: c.supplierId ? supplierNameById.get(c.supplierId) || null : null,
            status: c.status,
            currencyCode: c.currencyCode,
            storedFxRateToUsd: c.fxRateToUsd,
            fxRateConfirmed: !!c.fxRateConfirmed,
            amountNative: c.ratePerKg && c.totalKg ? String(parseFloat(c.ratePerKg) * parseFloat(c.totalKg)) : null,
            description: `Container ${c.containerNumber}`,
          });
        }
      }

      for (const oc of offloadCharges as any[]) {
        chargesScanned++;
        const { looksSet } = resolveStoredFxRate(oc.currencyCode, oc.fxRateToUsd, oc.fxRateConfirmed);
        if (!looksSet) {
          const container = containerById.get(oc.containerId);
          const supplierId = oc.supplierId ?? container?.supplierId ?? null;
          unresolved.push({
            source: "offload_additional_charge",
            id: oc.id,
            containerId: oc.containerId,
            containerNumber: container?.containerNumber ?? null,
            supplierId,
            supplierName: supplierId ? supplierNameById.get(supplierId) || null : null,
            status: container?.status ?? null,
            currencyCode: oc.currencyCode,
            storedFxRateToUsd: oc.fxRateToUsd,
            fxRateConfirmed: !!oc.fxRateConfirmed,
            amountNative: oc.amount,
            description: oc.description,
          });
        }
      }

      for (const cm of commissions as any[]) {
        commissionsScanned++;
        const { looksSet } = resolveStoredFxRate(cm.currencyCode, cm.fxRateToUsd, cm.fxRateConfirmed);
        if (!looksSet) {
          const container = containerById.get(cm.containerId);
          unresolved.push({
            source: "commission",
            id: cm.id,
            containerId: cm.containerId,
            containerNumber: container?.containerNumber ?? null,
            supplierId: container?.supplierId ?? null,
            supplierName: container?.supplierId ? supplierNameById.get(container.supplierId) || null : null,
            status: container?.status ?? null,
            currencyCode: cm.currencyCode,
            storedFxRateToUsd: cm.fxRateToUsd,
            fxRateConfirmed: !!cm.fxRateConfirmed,
            amountNative: cm.commissionTotal,
            description: `Commission — ${cm.personName}`,
          });
        }
      }

      // Group for the summary views the UI/report will actually want.
      const bySupplier: Record<string, { supplierId: number | null; supplierName: string | null; count: number }> = {};
      const byCurrency: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const byContainer: Record<
        number,
        { containerId: number; containerNumber: string | null; supplierName: string | null; rows: UnresolvedRow[] }
      > = {};

      for (const row of unresolved) {
        const supKey = String(row.supplierId ?? "none");
        if (!bySupplier[supKey]) bySupplier[supKey] = { supplierId: row.supplierId, supplierName: row.supplierName, count: 0 };
        bySupplier[supKey].count++;

        byCurrency[row.currencyCode] = (byCurrency[row.currencyCode] || 0) + 1;

        const statusKey = row.status || "UNKNOWN";
        byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

        if (!byContainer[row.containerId]) {
          byContainer[row.containerId] = {
            containerId: row.containerId,
            containerNumber: row.containerNumber,
            supplierName: row.supplierName,
            rows: [],
          };
        }
        byContainer[row.containerId].rows.push(row);
      }

      // CLOSED/COMPLETED containers must never be auto-repaired — surfaced explicitly so
      // the repair service (and any human reviewer) knows these need MANUAL_REVIEW_REQUIRED,
      // never an automatic fix, even in dry-run preview.
      const manualReviewRequired = unresolved.filter(
        (r) => r.status === "CLOSED" || r.status === "COMPLETED" || r.status === "OFFLOADED"
      );

      res.json({
        scannedAt: new Date().toISOString(),
        companyId,
        totals: {
          containersScanned,
          chargesScanned,
          commissionsScanned,
          unresolvedCount: unresolved.length,
          manualReviewRequiredCount: manualReviewRequired.length,
        },
        bySupplier: Object.values(bySupplier),
        byCurrency,
        byStatus,
        byContainer: Object.values(byContainer),
        manualReviewRequired,
        rows: unresolved,
      });
    } catch (error: any) {
      console.error("Error running factory FX diagnostic:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
