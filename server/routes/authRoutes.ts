import type { Express } from "express";

import { registerAuthAuditLogRoutes } from "./auth/auditLogRoutes";
import { registerCompanyAccessRoutes } from "./auth/companyAccessRoutes";
import { registerCoreAuthRoutes } from "./auth/coreAuthRoutes";
import { registerSessionRoutes } from "./auth/sessionRoutes";
import { registerUserAccessRoutes } from "./auth/userAccessRoutes";
import { registerUserAdministrationRoutes } from "./auth/userAdministrationRoutes";
import { registerExchangeRateRoutes } from "./exchangeRateRoutes";
import { registerUserPresenceRoutes } from "./userPresenceRoutes";
import { registerAuthRoutes as registerLegacyAuthRoutes } from "./authRoutesLegacy";

export function registerAuthRoutes(app: Express) {
  registerCoreAuthRoutes(app);
  registerSessionRoutes(app);
  registerAuthAuditLogRoutes(app);
  registerUserAdministrationRoutes(app);
  registerUserAccessRoutes(app);
  registerCompanyAccessRoutes(app);
  registerUserPresenceRoutes(app);
  registerExchangeRateRoutes(app);
  registerLegacyAuthRoutes(app);
}
