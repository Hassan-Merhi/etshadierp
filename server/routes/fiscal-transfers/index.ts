/**
 * fiscalTransferRoutes route composition.
 *
 * Access guards register before every transfer/revision handler. The v2
 * lifecycle routes then take precedence over legacy compatibility handlers.
 */
import type { Express } from "express";
import { registerPosTransferAccessGuards } from "./pos-transfer-access";
import { registerPosTransferItemDiagnosticRoutes } from "./pos-item-diagnostics";
import { registerStockTransferReadRoutes } from "./reads";
import { registerStockTransferCreateRoutes } from "./create";
import { registerStockTransferRevisionStatusRoutes } from "./revision-status";
import { registerStockTransferRevisionLifecycleRoutesV2 } from "./revision-lifecycle";
import { registerImmutableStockTransferRevisionRoutes } from "./immutable-revisions";
import { registerStockTransferRevisionReadRoutes } from "./revisions-read";
import { registerPosTransferDetailRoutes } from "./pos-detail";
import { registerPosTransferListMetaRoutes } from "./pos-list-meta";
import { registerStockTransferRevisionWriteRoutes } from "./revisions-write";
import { registerStockTransferUpdateRoutes } from "./update";

export function registerFiscalTransferRoutes(app: Express) {
  registerPosTransferAccessGuards(app);
  registerStockTransferReadRoutes(app);
  registerStockTransferCreateRoutes(app);
  registerStockTransferRevisionStatusRoutes(app);
  registerStockTransferRevisionLifecycleRoutesV2(app);
  registerImmutableStockTransferRevisionRoutes(app);
  registerStockTransferRevisionReadRoutes(app);
  registerPosTransferDetailRoutes(app);
  registerPosTransferListMetaRoutes(app);
  registerPosTransferItemDiagnosticRoutes(app);
  registerStockTransferRevisionWriteRoutes(app);
  registerStockTransferUpdateRoutes(app);
}
