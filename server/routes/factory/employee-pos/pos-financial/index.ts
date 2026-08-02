/**
 * employeePosFinancialRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerPosSalesReadRoutes } from "./sales-read";
import { registerPosSaleWriteRoutes } from "./sale-write";
import { registerPosSaleDeleteRoutes } from "./sale-delete";
import { registerWorkerCategoryRoutes } from "./worker-categories";
import { registerFactoryFinancialSnapshotRoutes } from "./financial-snapshot";

export function registerEmployeePosFinancialRoutes(app: Express) {
  registerPosSalesReadRoutes(app);
  registerPosSaleWriteRoutes(app);
  registerPosSaleDeleteRoutes(app);
  registerWorkerCategoryRoutes(app);
  registerFactoryFinancialSnapshotRoutes(app);
}
