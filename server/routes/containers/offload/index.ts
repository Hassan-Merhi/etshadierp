/**
 * containerOffloadRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerContainerOffloadCreateRoutes } from "./create";
import { registerContainerOffloadRecalcRoutes } from "./recalc";
import { registerContainerOffloadUpdateRoutes } from "./update";
import { registerContainerOffloadChargeRoutes } from "./charges";

export function registerContainerOffloadRoutes(app: Express) {
  registerContainerOffloadCreateRoutes(app);
  registerContainerOffloadRecalcRoutes(app);
  registerContainerOffloadUpdateRoutes(app);
  registerContainerOffloadChargeRoutes(app);
}
