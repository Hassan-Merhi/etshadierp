/**
 * employeePosFinancialRoutes route composition.
 *
 * Registration order matches the original single-file module exactly for the
 * pre-existing routes. New production-position routes are appended after the
 * legacy worker-category routes so existing first-match behavior is preserved.
 */
import type { Express } from "express";
import { registerPosSalesReadRoutes } from "./sales-read";
import { registerPosSaleWriteRoutes } from "./sale-write";
import { registerPosSaleDeleteRoutes } from "./sale-delete";
import { registerWorkerCategoryRoutes } from "./worker-categories";
import { registerProductionPositionRoutes } from "./production-positions";
import { registerFactoryFinancialSnapshotRoutes } from "./financial-snapshot";

export function registerEmployeePosFinancialRoutes(app: Express) {
  registerPosSalesReadRoutes(app);
  registerPosSaleWriteRoutes(app);
  registerPosSaleDeleteRoutes(app);
  registerWorkerCategoryRoutes(app);
  registerProductionPositionRoutes(app);
  registerFactoryFinancialSnapshotRoutes(app);
}
