/**
 * voucherTransferRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerVoucherTransferOnlyRoutes } from "./transfer";
import { registerVoucherWithEntriesRoutes } from "./with-entries";
import { registerSalesInventoryFixRoutes } from "./fix-sales-inventory";

export function registerVoucherTransferRoutes(app: Express) {
  registerVoucherTransferOnlyRoutes(app);
  registerVoucherWithEntriesRoutes(app);
  registerSalesInventoryFixRoutes(app);
}
