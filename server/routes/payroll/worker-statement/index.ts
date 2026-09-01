/**
 * workerStatementRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerWorkerRepaymentDeleteRoutes } from "./repayments";
import { registerPayrollVoucherBackfillRoutes } from "./backfill";
import { registerWorkerStatementReadRoutes } from "./statement";
import { registerWorkerDeleteRoutes } from "./worker-delete";
import { registerOrphanedVoucherRepairRoutes } from "./repair";

export function registerWorkerStatementRoutes(app: Express) {
  registerWorkerRepaymentDeleteRoutes(app);
  registerPayrollVoucherBackfillRoutes(app);
  registerWorkerStatementReadRoutes(app);
  registerWorkerDeleteRoutes(app);
  registerOrphanedVoucherRepairRoutes(app);
}
