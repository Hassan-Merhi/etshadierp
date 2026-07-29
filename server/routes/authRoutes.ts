import type { Express } from "express";

import { registerAuthAuditLogRoutes } from "./auth/auditLogRoutes";
import { registerAuthRoutes as registerLegacyAuthRoutes } from "./authRoutesLegacy";
import { registerSessionRoutes } from "./auth/sessionRoutes";

export function registerAuthRoutes(app: Express) {
  // Focused authentication domains register before the legacy compatibility
  // registry so extracted handlers preserve their existing public URLs.
  registerSessionRoutes(app);
  registerAuthAuditLogRoutes(app);
  registerLegacyAuthRoutes(app);
}
