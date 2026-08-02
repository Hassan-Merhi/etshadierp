/**
 * accountRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerAccountListRoutes } from "./all";
import { registerAccountPayableRoutes } from "./payables";
import { registerAccountLedgerListRoutes } from "./all-ledger";
import { registerAccountVoucherSidebarRoutes } from "./voucher-sidebar";
import { registerAccountLedgerBalanceRoutes } from "./ledger-balance";
import { registerAccountSubModules } from "./sub-modules";
import { registerAccountWhatsappRoutes } from "./whatsapp";

export function registerAccountRoutes(app: Express) {
  registerAccountListRoutes(app);
  registerAccountPayableRoutes(app);
  registerAccountLedgerListRoutes(app);
  registerAccountVoucherSidebarRoutes(app);
  registerAccountLedgerBalanceRoutes(app);
  registerAccountSubModules(app);
  registerAccountWhatsappRoutes(app);
}
