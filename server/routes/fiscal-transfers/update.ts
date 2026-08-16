/**
 * fiscalTransferRoutes: StockTransferUpdate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { registerStockAdjustmentWasteRoutes } from "../stockAdjustmentWasteRoutes";

/**
 * The PUT /api/stock-transfers/:id handler that lived here has been removed.
 *
 * It could never run. server/routes/vouchers/stockTransferLifecycleRoutes.ts
 * registers the same method and path, and registerVoucherRoutes is called
 * before registerFiscalTransferRoutes, so Express first-match gave the
 * lifecycle route every request. The handler was found while adding canonical
 * journal evidence to stock transfer edits: the evidence was written here, the
 * test drove the real endpoint, and no rows appeared.
 *
 * The registrar itself stays because it also wires the stock adjustment waste
 * routes, which are live.
 */
export function registerStockTransferUpdateRoutes(app: Express) {
  registerStockAdjustmentWasteRoutes(app);
}
