import type { Express } from "express";
import type { Server } from "http";

import { registerRoutes as registerLegacyRoutes } from "./routesLegacy";

/**
 * Public API composition root.
 *
 * Focused domain registries are imported by the compatibility registry while
 * the remaining historical endpoints are quarantined in routesLegacy.ts. New
 * business logic must be added to a domain module, not to this entry point.
 */
export function registerRoutes(app: Express): Promise<Server> {
  return registerLegacyRoutes(app);
}
