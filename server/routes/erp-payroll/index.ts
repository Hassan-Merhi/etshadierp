/**
 * payrollRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerPayrollEmployeeDepositRoutes } from "./employee-deposits";
import { registerPayrollBulkAdjustmentRoutes } from "./bulk-adjustments";
import { registerPayrollBonusRoutes } from "./bonuses";
import { registerPayrollWithdrawalRoutes } from "./withdrawals";
import { registerPayrollWorkerPaymentRoutes } from "./worker-payments";
import { registerPayrollRunRoutes } from "./runs";
import { registerPayrollRunLifecycleRoutes } from "./runs-lifecycle";
import { registerPayrollRunMigrationRoutes } from "./runs-migration";
import { registerPayrollSummaryRoutes } from "./summaries";

export function registerPayrollRoutes(app: Express) {
  registerPayrollEmployeeDepositRoutes(app);
  registerPayrollBulkAdjustmentRoutes(app);
  registerPayrollBonusRoutes(app);
  registerPayrollWithdrawalRoutes(app);
  registerPayrollWorkerPaymentRoutes(app);
  registerPayrollRunRoutes(app);
  registerPayrollRunLifecycleRoutes(app);
  registerPayrollRunMigrationRoutes(app);
  registerPayrollSummaryRoutes(app);
}
