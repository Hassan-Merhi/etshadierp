import type { Express } from "express";
import { registerFactoryRoutes as registerFactoryRoutesLegacy } from "./factoryRoutesLegacy";
import {
  registerFactoryBilingualCatalogMiddleware,
  registerFactoryBilingualCatalogRoutes,
} from "./factory/factoryBilingualCatalogRoutes";

/**
 * Phase 3 compatibility composition. The response/request adapter must be
 * installed before the legacy catalog handlers, while the explicit bilingual
 * write endpoints are installed after the legacy registry so its company and
 * permission middleware protects them.
 */
export function registerFactoryRoutes(app: Express, requireAuth: any, db: any) {
  registerFactoryBilingualCatalogMiddleware(app);
  registerFactoryRoutesLegacy(app, requireAuth, db);
  registerFactoryBilingualCatalogRoutes(app, requireAuth);
}
