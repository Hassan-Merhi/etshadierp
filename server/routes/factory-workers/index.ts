/**
 * factoryWorkerRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryWorkerListRoutes } from "./lists";
import { registerFactoryWorkerImportExportRoutes } from "./import-export";
import { registerFactoryWorkerPayrollDelegation } from "./payroll-delegation";
import { registerFactoryWorkerCrudRoutes } from "./crud";
import { registerFactoryWorkerPhotoRoutes } from "./photos";
import { registerFactoryWorkerDocumentRoutes } from "./documents";
import { registerFactoryWorkerBaleSettleRoutes } from "./bales-settle";

import type { AppDb, AuthMiddleware } from "../routeBoundaryTypes";

export function registerFactoryWorkerRoutes(app: Express, requireAuth: AuthMiddleware, db: AppDb) {
  registerFactoryWorkerListRoutes(app, requireAuth, db);
  registerFactoryWorkerImportExportRoutes(app, requireAuth, db);
  registerFactoryWorkerPayrollDelegation(app, requireAuth, db);
  registerFactoryWorkerCrudRoutes(app, requireAuth, db);
  registerFactoryWorkerPhotoRoutes(app, requireAuth, db);
  registerFactoryWorkerDocumentRoutes(app, requireAuth, db);
  registerFactoryWorkerBaleSettleRoutes(app, requireAuth, db);
}
