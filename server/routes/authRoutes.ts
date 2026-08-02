import type { Express } from "express";

import { registerAuthAuditLogRoutes } from "./auth/auditLogRoutes";
import { registerCompanyAccessRoutes } from "./auth/companyAccessRoutes";
import { registerCoreAuthRoutes } from "./auth/coreAuthRoutes";
import { registerLanguagePreferenceRoutes } from "./auth/languagePreferenceRoutes";
import { registerSessionRoutes } from "./auth/sessionRoutes";
import { registerUserAccessRoutes } from "./auth/userAccessRoutes";
import { registerUserAdministrationRoutes } from "./auth/userAdministrationRoutes";
import { registerExchangeRateRoutes } from "./exchangeRateRoutes";
import { registerUserPresenceRoutes } from "./userPresenceRoutes";

export function registerAuthRoutes(app: Express) {
  registerCoreAuthRoutes(app);
  registerSessionRoutes(app);
  registerAuthAuditLogRoutes(app);
  registerUserAdministrationRoutes(app);
  registerUserAccessRoutes(app);
  registerLanguagePreferenceRoutes(app);
  registerCompanyAccessRoutes(app);
  registerUserPresenceRoutes(app);
  registerExchangeRateRoutes(app);
}
