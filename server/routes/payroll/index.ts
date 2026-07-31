import type { Express } from "express";
import { registerPayrollCoreRoutes } from "./core";
import { registerWorkerStatsAdvancesRoutes } from "./workerStatsAdvancesRoutes";
import { registerAdvanceManagementRoutes } from "./advanceManagementRoutes";
import { registerAdvanceAccountingRoutes } from "./advance-accounting";
import { registerWorkerStatementRoutes } from "./workerStatementRoutes";

export function registerFactoryWorkerPayrollRoutes(app: Express) {
  registerPayrollCoreRoutes(app);
  registerWorkerStatsAdvancesRoutes(app);
  registerAdvanceManagementRoutes(app);
  registerAdvanceAccountingRoutes(app);
  registerWorkerStatementRoutes(app);
}
