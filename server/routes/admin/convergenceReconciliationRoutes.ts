import type { Express, Request, Response } from "express";

import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { logger } from "../../lib/logger";
import {
  ConvergenceReconciliationError,
  reconcileConvergenceTx,
} from "../../services/accounting/convergenceReconciliation";
import { createDatabaseConvergenceAdapter } from "../../services/accounting/databaseConvergenceAdapter";
import { loadDatabaseStockConvergenceSnapshots } from "../../services/inventory/databaseStockConvergenceSnapshots";

const convergenceAdapter = createDatabaseConvergenceAdapter(loadDatabaseStockConvergenceSnapshots);

/**
 * Read-only accounting and inventory convergence reconciliation.
 *
 * Compares the authoritative evidence for the active company — Voucher against
 * VoucherEntry against the Factory Daybook mirror, and applied stock transfer
 * and stock adjustment documents against the canonical movement journal — and
 * reports what disagrees.
 *
 * It never repairs anything. A discrepancy is a fact to investigate, and a
 * reconciler that silently corrected one would destroy the evidence that it
 * happened. The company comes from the session via the tenant boundary; there is
 * no companyId parameter to point this at another tenant's books.
 *
 * The reconciler fails closed on evidence it cannot trust — duplicate Daybook
 * mirrors, rows that crossed a company boundary, unbalanced transfer legs — so
 * those surface as a 409 rather than as a clean report with the bad rows
 * quietly dropped.
 */
export function registerConvergenceReconciliationRoutes(app: Express): void {
  app.get(
    "/api/admin/convergence-reconciliation",
    requireAuth,
    requireRole("Admin", "Owner"),
    async (req: Request, res: Response) => {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ code: "COMPANY_REQUIRED", message: "No company selected" });
      }

      try {
        const result = await db.transaction(async (tx) => reconcileConvergenceTx(tx, companyId, convergenceAdapter));
        return res.status(200).json(result);
      } catch (error: unknown) {
        if (error instanceof ConvergenceReconciliationError) {
          // Untrustworthy evidence, not a server fault: the caller needs to know
          // which invariant failed and on which record.
          logger.warn("Convergence reconciliation rejected the evidence it read", {
            module: "convergence",
            action: "reconcile",
            companyId,
            userId: req.session.userId,
            code: error.code,
          });
          return res.status(409).json({ code: error.code, message: error.message });
        }
        throw error;
      }
    }
  );
}
