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
import { checkFactoryAdmin } from "../_helpers";
import { logAudit } from "../../helpers/auditHelpers";
import {
  planFxResolutionRepair,
  applyFxResolutionRepair,
  type FxResolutionSource,
} from "../../../services/factory/fxResolutionRepair";
import crypto from "node:crypto";

const VALID_SOURCES: FxResolutionSource[] = ["container", "offload_additional_charge", "commission"];

/** Simple confirmation-token scheme: ties a dry-run preview to the exact repair it
 * previewed, so an apply request can't be replayed against a different rate/row
 * than the one an admin actually reviewed. Not a security boundary — just anti-fat-finger. */
function makeConfirmationToken(companyId: number, source: string, id: number, newFxRateToUsd: number): string {
  return crypto
    .createHash("sha256")
    .update(`${companyId}:${source}:${id}:${newFxRateToUsd}`)
    .digest("hex")
    .slice(0, 16);
}

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

  // Safe repair: resolve ONE unresolved row's exchange rate by supplying the real,
  // explicitly-known rate. Admin-only. Defaults to a dry-run preview (which returns a
  // confirmationToken); the actual write only happens when the caller re-submits with
  // { confirm: true, confirmationToken } matching that exact (source, id, rate) triple.
  // Never touches CLOSED/COMPLETED/OFFLOADED containers — those come back as
  // MANUAL_REVIEW_REQUIRED instead. Never recalculates cost/kg or cascades — see
  // rawStockRecalc.ts's separate preview/apply flow for that, which already refuses
  // to run on fx-unresolved containers.
  app.post("/api/factory/suppliers/fx-diagnostic/repair", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { source, id, fxRateToUsd, confirm, confirmationToken } = req.body || {};
      const parsedId = parseInt(id);
      const parsedRate = parseFloat(fxRateToUsd);

      if (!VALID_SOURCES.includes(source)) {
        return res.status(400).json({ message: `source must be one of: ${VALID_SOURCES.join(", ")}` });
      }
      if (isNaN(parsedId)) return res.status(400).json({ message: "id must be a number" });
      if (!(parsedRate > 0)) return res.status(400).json({ message: "fxRateToUsd must be a positive number" });

      const plan = await planFxResolutionRepair(source, parsedId, companyId, parsedRate);
      if (!plan) return res.status(404).json({ message: `${source} #${parsedId} not found` });

      const expectedToken = makeConfirmationToken(companyId, source, parsedId, parsedRate);

      if (!confirm) {
        return res.json({ dryRun: true, plan, confirmationToken: expectedToken });
      }

      if (confirmationToken !== expectedToken) {
        return res.status(400).json({
          message: "confirmationToken does not match this exact repair — re-run the dry-run preview first.",
        });
      }

      const result = await applyFxResolutionRepair(source, parsedId, companyId, parsedRate);

      await logAudit({
        userId: req.session.userId,
        username: req.session.username || req.session.userId,
        companyId,
        action: "update",
        tableName:
          source === "container"
            ? "factory_containers"
            : source === "offload_additional_charge"
              ? "factory_offload_additional_charges"
              : "factory_container_commissions",
        recordId: parsedId,
        recordIdentifier: `FX resolution repair — ${source} #${parsedId}`,
        changes: {
          fxRateToUsd: { old: result.oldFxRateToUsd, new: result.newFxRateToUsd },
          fxRateConfirmed: { old: result.oldFxRateConfirmed, new: true },
        },
      });

      res.json({ dryRun: false, result });
    } catch (error: any) {
      if (String(error.message || "").startsWith("MANUAL_REVIEW_REQUIRED")) {
        return res.status(409).json({ message: error.message, code: "MANUAL_REVIEW_REQUIRED" });
      }
      console.error("Error applying FX resolution repair:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
