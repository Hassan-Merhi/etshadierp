// Split into ./worker-stats-advances/* — this file stays as the registrar so
// its single call site keeps working. Registration order is load-bearing:
// Express matches routes in the order they are added, and these groups were
// contiguous in the original file.
import type { Express } from "express";
import { registerWorkerStatsRoutes } from "./worker-stats-advances/statsRoutes";
import { registerWorkerAdvancesRoutes } from "./worker-stats-advances/advancesRoutes";
import { registerWorkerDeductionsRoutes } from "./worker-stats-advances/deductionsRoutes";
import { registerWorkerAdvanceAdminRoutes } from "./worker-stats-advances/advanceAdminRoutes";

export function registerWorkerStatsAdvancesRoutes(app: Express) {
  registerWorkerStatsRoutes(app);
  registerWorkerAdvancesRoutes(app);
  registerWorkerDeductionsRoutes(app);
  registerWorkerAdvanceAdminRoutes(app);
}
