/**
 * baleScanningRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerOrderBaleScanRoutes } from "./scan";
import { registerOrderBaleBulkImportRoutes } from "./bulk-import";
import { registerOrderBaleRemovalRoutes } from "./remove";
import { registerOrderBaleSwapRoutes } from "./swap";
import { registerOrderBaleExchangeRoutes } from "./exchange";

export function registerBaleScanningRoutes(app: Express) {
  registerOrderBaleScanRoutes(app);
  registerOrderBaleBulkImportRoutes(app);
  registerOrderBaleRemovalRoutes(app);
  registerOrderBaleSwapRoutes(app);
  registerOrderBaleExchangeRoutes(app);
}
