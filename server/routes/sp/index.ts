import type { Express } from "express";
import { logger } from "../../lib/logger";
import { registerSpSetupRoutes } from "./spSetupRoutes";
import { registerSpContainerRoutes } from "./spContainerRoutes";
import { registerSpOffloadConcurrencyGuard } from "./spOffloadConcurrencyGuard";
import { registerSpOffloadRoutes } from "./spOffloadRoutes";
import { registerSpSalesRoutes } from "./spSalesRoutes";
import { registerSpLifecycleRoutes } from "./spLifecycleRoutes";
import { registerSpOpeningStockRoutes } from "./spOpeningStockRoutes";
import { registerSpAliasRoutes } from "./spAliasRoutes";
import { registerSpReportRoutes } from "./spReportRoutes";
import { registerSpExportRoutes } from "./spExportRoutes";
import { registerSpMigrationPhase2Routes } from "./spMigrationPhase2Routes";
import { registerSpMigrationCutoverRoutes } from "./spMigrationCutoverRoutes";
import { registerSpMigrationFinalVerificationRoutes } from "./spMigrationFinalVerification";
import { registerSpMigrationPhase4Routes } from "./spMigrationPhase4Routes";
import { ensureCutoverHardening, installExplicitCompanyWriteGuard } from "./spMigrationCutoverHardening";
import { ensureSpSupplierVoucherSyncTrigger, repairSpSupplierVoucherLinks } from "./spSupplierVoucherSync";

// ── Supplier Partner (SP) route registration ─────────────────────────────────
// Structural split of the former monolithic server/routes/spRoutes.ts.
// Every endpoint, SQL query, accounting/voucher posting, and inventory
// adjustment call below is byte-for-byte identical to the original file —
// only file boundaries and helper imports changed.
export function registerSpRoutes(app: Express) {
  // Phase 4 registers first so strict verification, recovery and final cutover
  // endpoints supersede Phase 3 and the older final-verification compatibility route.
  // Both write guards remain before the first Express route, covering session-scoped
  // and explicit-company write paths throughout the application.
  installExplicitCompanyWriteGuard(app);
  registerSpMigrationPhase4Routes(app);
  registerSpMigrationCutoverRoutes(app);
  registerSpMigrationPhase2Routes(app);
  registerSpMigrationFinalVerificationRoutes(app);
  void ensureCutoverHardening().catch((error) => {
    logger.warn("[SP Cutover] Hardening indexes deferred", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

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
  // The guard owns company/container serialization and safe replay. The legacy
  // handler below still owns all voucher, prepaid, inventory, and intercompany
  // formulas after the lock has been acquired.
  registerSpOffloadConcurrencyGuard(app);
  registerSpOffloadRoutes(app);
  registerSpSalesRoutes(app);
  registerSpLifecycleRoutes(app);
  registerSpOpeningStockRoutes(app);
  registerSpAliasRoutes(app);
  registerSpReportRoutes(app);
  registerSpExportRoutes(app);
}
