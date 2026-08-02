/**
 * voucherEntryRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerVoucherEntryReadRoutes } from "./reads";
import { registerVoucherEntryWriteRoutes } from "./write";
import { registerVoucherDeleteRoutes } from "./delete";
import { registerVoucherBulkDeleteRoutes } from "./bulk-delete";
import { registerVoucherEntryByAccountRoutes } from "./by-account";

export function registerVoucherEntryRoutes(app: Express) {
  registerVoucherEntryReadRoutes(app);
  registerVoucherEntryWriteRoutes(app);
  registerVoucherDeleteRoutes(app);
  registerVoucherBulkDeleteRoutes(app);
  registerVoucherEntryByAccountRoutes(app);
}
