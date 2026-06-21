import type { Express } from "express";
import { registerPayrollCoreRoutes } from "./payroll/payrollCoreRoutes";
import { registerWorkerStatsAdvancesRoutes } from "./payroll/workerStatsAdvancesRoutes";
import { registerAdvanceManagementRoutes } from "./payroll/advanceManagementRoutes";
import { registerAdvanceAccountingRoutes } from "./payroll/advanceAccountingRoutes";
import { registerWorkerStatementRoutes } from "./payroll/workerStatementRoutes";

export function registerFactoryWorkerPayrollRoutes(app: Express) {
  registerPayrollCoreRoutes(app);
  registerWorkerStatsAdvancesRoutes(app);
  registerAdvanceManagementRoutes(app);
  registerAdvanceAccountingRoutes(app);
  registerWorkerStatementRoutes(app);
}
