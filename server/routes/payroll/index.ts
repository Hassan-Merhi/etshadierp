import type { Express } from "express";
import { registerPayrollCoreRoutes } from "./payrollCoreRoutes";
import { registerWorkerStatsAdvancesRoutes } from "./workerStatsAdvancesRoutes";
import { registerAdvanceManagementRoutes } from "./advanceManagementRoutes";
import { registerAdvanceAccountingRoutes } from "./advanceAccountingRoutes";
import { registerWorkerStatementRoutes } from "./workerStatementRoutes";

export function registerFactoryWorkerPayrollRoutes(app: Express) {
  registerPayrollCoreRoutes(app);
  registerWorkerStatsAdvancesRoutes(app);
  registerAdvanceManagementRoutes(app);
  registerAdvanceAccountingRoutes(app);
  registerWorkerStatementRoutes(app);
}
