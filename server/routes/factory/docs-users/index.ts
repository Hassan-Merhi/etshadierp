/**
 * factoryDocsUsersRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryDocsRoutes } from "./docsRoutes";
import { registerFactoryFreightRoutes } from "./freightRoutes";
import { registerFactoryDaybookEditRoutes } from "./daybookEditRoutes";
import { registerFactoryUsersAccessRoutes } from "./usersAccessRoutes";
import { registerFactoryChatRoutes } from "./chatRoutes";
import { registerFactoryCompanyExportRoutes } from "./companyExportRoutes";
import { registerFactoryCompanyImportRoutes } from "./companyImportRoutes";
import { registerFactoryAnalyticsRoutes } from "./analyticsRoutes";
import { registerFactoryBaleRelabelRoutes } from "./baleRelabelRoutes";

export function registerFactoryDocsUsersRoutes(app: Express) {
  registerFactoryDocsRoutes(app);
  registerFactoryFreightRoutes(app);
  registerFactoryDaybookEditRoutes(app);
  registerFactoryUsersAccessRoutes(app);
  registerFactoryChatRoutes(app);
  registerFactoryCompanyExportRoutes(app);
  registerFactoryCompanyImportRoutes(app);
  registerFactoryAnalyticsRoutes(app);
  registerFactoryBaleRelabelRoutes(app);
}
