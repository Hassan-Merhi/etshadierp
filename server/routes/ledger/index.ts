/**
 * ledgerRoutesLegacy route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerLedgerAccountReadRoutes } from "./reads";
import { registerLedgerAccountWriteRoutes } from "./write";
import { registerLedgerAccountDeleteRoutes } from "./delete";
import { registerLedgerZeroBalanceRoutes } from "./zero-balances";
import { registerAccountingBalanceInitRoutes } from "./initialize-balances";

export function registerLedgerRoutes(app: Express) {
  registerLedgerAccountReadRoutes(app);
  registerLedgerAccountWriteRoutes(app);
  registerLedgerAccountDeleteRoutes(app);
  registerLedgerZeroBalanceRoutes(app);
  registerAccountingBalanceInitRoutes(app);
}
