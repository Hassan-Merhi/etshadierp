/**
 * voucherEntryRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerHassanPriceFallbackMiddleware } from "./hassan-price-fallback";
import { registerVoucherEntryReadRoutes } from "./reads";
import { registerVoucherEntryWriteRoutes } from "./write";
import { registerVoucherDeleteRoutes } from "./delete";
import { registerVoucherBulkDeleteRoutes } from "./bulk-delete";
import { registerVoucherEntryByAccountRoutes } from "./by-account";

export function registerVoucherEntryRoutes(app: Express) {
  registerHassanPriceFallbackMiddleware(app);
  registerVoucherEntryReadRoutes(app);
  registerVoucherEntryWriteRoutes(app);
  registerVoucherDeleteRoutes(app);
  registerVoucherBulkDeleteRoutes(app);
  registerVoucherEntryByAccountRoutes(app);
}
