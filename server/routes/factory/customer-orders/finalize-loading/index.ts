/**
 * orderFinalizeLoadingRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerOrderFinalizeRoutes } from "./finalize";
import { registerOrderUnfinalizeRoutes } from "./unfinalize";
import { registerOrderCancelRoutes } from "./cancel";
import { registerOrderLoadingRoutes } from "./loading";

export function registerOrderFinalizeLoadingRoutes(app: Express) {
  registerOrderFinalizeRoutes(app);
  registerOrderUnfinalizeRoutes(app);
  registerOrderCancelRoutes(app);
  registerOrderLoadingRoutes(app);
}
