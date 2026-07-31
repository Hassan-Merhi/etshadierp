/**
 * factoryMixBatchRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryMixBatchReadRoutes } from "./reads";
import { registerFactoryMixBatchUpdateRoutes } from "./update";
import { registerFactoryMixBatchFinalizeDeleteRoutes } from "./finalize-delete";
import { registerFactoryMixBatchCreateRoutes } from "./create";
import { registerFactoryMixBatchTopUpRoutes } from "./top-up";
import { registerFactoryMixBatchSourceRoutes } from "./sources";
import { registerFactoryMixBatchConsumeRoutes } from "./consume";

export function registerFactoryMixBatchRoutes(app: Express) {
  registerFactoryMixBatchReadRoutes(app);
  registerFactoryMixBatchUpdateRoutes(app);
  registerFactoryMixBatchFinalizeDeleteRoutes(app);
  registerFactoryMixBatchCreateRoutes(app);
  registerFactoryMixBatchTopUpRoutes(app);
  registerFactoryMixBatchSourceRoutes(app);
  registerFactoryMixBatchConsumeRoutes(app);
}
