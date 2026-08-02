/**
 * factoryPayrollRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryPayrollGenerateRoutes } from "./generate";
import { registerFactoryPayrollReadRoutes } from "./reads";
import { registerFactoryPayrollUpdateRoutes } from "./update";
import { registerFactoryPayrollDeleteRoutes } from "./delete";
import { registerFactoryPayrollExportRoutes } from "./exports";

export function registerFactoryPayrollRoutes(app: Express, requireAuth: any, db: any) {
  registerFactoryPayrollGenerateRoutes(app, requireAuth, db);
  registerFactoryPayrollReadRoutes(app, requireAuth, db);
  registerFactoryPayrollUpdateRoutes(app, requireAuth, db);
  registerFactoryPayrollDeleteRoutes(app, requireAuth, db);
  registerFactoryPayrollExportRoutes(app, requireAuth, db);
}
