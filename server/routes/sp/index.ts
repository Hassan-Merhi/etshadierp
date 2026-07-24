import type { Express } from "express";
import { logger } from "../../lib/logger";
import { registerSpSetupRoutes } from "./spSetupRoutes";
import { registerSpContainerRoutes } from "./spContainerRoutes";
import { registerSpOffloadRoutes } from "./spOffloadRoutes";
import { registerSpSalesRoutes } from "./spSalesRoutes";
import { registerSpOpeningStockRoutes } from "./spOpeningStockRoutes";
import { registerSpAliasRoutes } from "./spAliasRoutes";
import { registerSpReportRoutes } from "./spReportRoutes";
import { registerSpExportRoutes } from "./spExportRoutes";
import { ensureSpSupplierVoucherSyncTrigger, repairSpSupplierVoucherLinks } from "./spSupplierVoucherSync";

// ── Supplier Partner (SP) route registration ─────────────────────────────────
// Structural split of the former monolithic server/routes/spRoutes.ts.
// Every endpoint, SQL query, accounting/voucher posting, and inventory
// adjustment call below is byte-for-byte identical to the original file —
// only file boundaries and helper imports changed.
export function registerSpRoutes(app: Express) {
  // Keep SP container supplier linkage correct even when an older company does
  // not revisit the Setup screen after deployment. Fresh-database startup can
  // register routes before every table exists, so failure is logged and Setup
  // remains an idempotent retry path.
  void (async () => {
    await ensureSpSupplierVoucherSyncTrigger();
    const repairedCount = await repairSpSupplierVoucherLinks();
    if (repairedCount > 0) {
      logger.info("[SP] Repaired Goods-OTW voucher supplier links", { repairedCount });
    }
  })().catch((error) => {
    logger.warn("[SP] Supplier voucher synchronization deferred until Setup", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  registerSpSetupRoutes(app);
  registerSpContainerRoutes(app);
  registerSpOffloadRoutes(app);
  registerSpSalesRoutes(app);
  registerSpOpeningStockRoutes(app);
  registerSpAliasRoutes(app);
  registerSpReportRoutes(app);
  registerSpExportRoutes(app);
}
