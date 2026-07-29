import type { Express } from "express";

import { registerAuthRoutes as registerLegacyAuthRoutes } from "./authRoutesLegacy";
import { registerSessionRoutes } from "./auth/sessionRoutes";

export function registerAuthRoutes(app: Express) {
  // Session management registers first and shadows its historical handlers.
  // Login, user administration, audit access, and remaining authentication
  // compatibility endpoints continue through the byte-for-byte legacy registry.
  registerSessionRoutes(app);
  registerLegacyAuthRoutes(app);
}
