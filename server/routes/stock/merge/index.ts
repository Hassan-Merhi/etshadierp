/**
 * stockMergeRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerStockItemEditRoutes } from "./item-edits";
import { registerStockQueryRoutes } from "./query";
import { registerStockGroupArchiveRoutes } from "./group-archives";
import { registerStockItemMergeRoutes } from "./merge";
import { registerStockItemBulkMergeRoutes } from "./bulk-merge";
import { registerStockItemReconcileRoutes } from "./reconcile";
import { registerStockMergeLogRoutes } from "./merge-logs";

export function registerStockMergeRoutes(app: Express) {
  registerStockItemEditRoutes(app);
  registerStockQueryRoutes(app);
  registerStockGroupArchiveRoutes(app);
  registerStockItemMergeRoutes(app);
  registerStockItemBulkMergeRoutes(app);
  registerStockItemReconcileRoutes(app);
  registerStockMergeLogRoutes(app);
}
