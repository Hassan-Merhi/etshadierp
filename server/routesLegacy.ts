import type { Express } from "express";
import type { Server } from "http";

import { registerApplicationRoutes } from "./routes/applicationRoutes";

/**
 * Compatibility export retained for callers that still import `routesLegacy`.
 *
 * All route ownership now lives in focused domain registrars composed by
 * `routes/applicationRoutes.ts`. New endpoints must not be added here.
 */
export function registerRoutes(app: Express): Promise<Server> {
  return registerApplicationRoutes(app);
}
