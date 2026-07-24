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
import { registerSpMigrationPhase2Routes } from "./spMigrationPhase2Routes";
import { ensureSpSupplierVoucherSyncTrigger, repairSpSupplierVoucherLinks } from "./spSupplierVoucherSync";

// ── Supplier Partner (SP) route registration ─────────────────────────────────
// Structural split of the former monolithic server/routes/spRoutes.ts.
// Every endpoint, SQL query, accounting/voucher posting, and inventory
// adjustment call below is byte-for-byte identical to the original file —
// only file boundaries and helper imports changed.
export function registerSpRoutes(app: Express) {
  // These routes must register before the legacy migration router in routes.ts.
  // They safely replace only the incomplete Step 6, Step 7, review, and rollback
  // surfaces while leaving the rest of the staged migration unchanged.
  registerSpMigrationPhase2Routes(app);

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
