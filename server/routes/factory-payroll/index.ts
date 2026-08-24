/**
 * factoryPayrollRoutes route composition.
 *
 * Registration order matches the original single-file module exactly for the
 * legacy handlers. Production-bonus subroutes are additive and use distinct
 * paths below /api/factory/payroll/:id/production-bonuses.
 */
import type { Express } from "express";
import { registerFactoryPayrollGenerateRoutes } from "./generate";
import { registerFactoryPayrollReadRoutes } from "./reads";
import { registerFactoryProductionBonusRoutes } from "./production-bonuses";
import { registerFactoryPayrollUpdateRoutes } from "./update";
import { registerFactoryPayrollDeleteRoutes } from "./delete";
import { registerFactoryPayrollExportRoutes } from "./exports";

import type { AppDb, AuthMiddleware } from "../routeBoundaryTypes";

export function registerFactoryPayrollRoutes(app: Express, requireAuth: AuthMiddleware, db: AppDb) {
  registerFactoryPayrollGenerateRoutes(app, requireAuth, db);
  registerFactoryPayrollReadRoutes(app, requireAuth, db);
  registerFactoryProductionBonusRoutes(app, requireAuth, db);
  registerFactoryPayrollUpdateRoutes(app, requireAuth, db);
  registerFactoryPayrollDeleteRoutes(app, requireAuth, db);
  registerFactoryPayrollExportRoutes(app, requireAuth, db);
}
