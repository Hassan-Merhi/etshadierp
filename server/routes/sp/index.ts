import type { Express } from "express";
import { logger } from "../../lib/logger";
import { GOLDEN_COAST_POST_CUTOVER_FIFO_SOURCES } from "../../services/accounting/goldenCoastPhase5PosSale";
import { GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE } from "../../services/accounting/goldenCoastPhase8ContainerOffload";
import { registerSpAccessControl } from "./spAccessControl";
import { registerSpPermissionRoutes } from "./spPermissionRoutes";
import { registerSpSetupRoutes } from "./spSetupRoutes";
import { registerSpGoldenCoastSetupRoutes } from "./spGoldenCoastSetupRoutes";
import { registerSpGoldenCoastPhase3CutoverRoutes } from "./spGoldenCoastPhase3CutoverRoutes";
import { registerSpGoldenCoastPhase4CutoverFifoRoutes } from "./spGoldenCoastPhase4CutoverFifoRoutes";
import { registerSpGoldenCoastPhase6PosSaleRoutes } from "./spGoldenCoastPhase6PosSaleRoutes";
import { registerSpGoldenCoastPhase8ContainerOffloadRoutes } from "./spGoldenCoastPhase8ContainerOffloadRoutes";
import { registerSpContainerRoutes } from "./spContainerRoutes";
import { registerSpLifecycleGuards } from "./spLifecycleGuards";
import { registerSpReoffloadPreparationGuard } from "./spReoffloadPreparationGuard";
import { registerSpOffloadConcurrencyGuard } from "./spOffloadConcurrencyGuard";
import { registerSpOffloadRoutes } from "./spOffloadRoutes";
import { registerSpOffloadLifecycleRoutes } from "./spOffloadLifecycleRoutes";
import { registerSpChargeReconciliationRoutes } from "./spChargeReconciliationRoutes";
import { registerSpFullReconciliationRoutes } from "./spFullReconciliationRoutes";
import { registerSpProductionClosureRoutes } from "./spProductionClosureRoutes";
import { ensureSpProductionClosureStorage } from "./spProductionClosureStorage";
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

function registerGoldenCoastPhase8FifoSource(): void {
  const sources = GOLDEN_COAST_POST_CUTOVER_FIFO_SOURCES as string[];
  if (!sources.includes(GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE)) {
    sources.push(GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE);
  }
}

export function registerSpRoutes(app: Express) {
  registerSpAccessControl(app);
  registerSpPermissionRoutes(app);

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
  void ensureSpProductionClosureStorage().catch((error) => {
    logger.warn("[SP Production Closure] Storage initialization deferred", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

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
  registerSpGoldenCoastSetupRoutes(app);
  registerSpGoldenCoastPhase3CutoverRoutes(app);
  registerSpGoldenCoastPhase4CutoverFifoRoutes(app);
  // Phase 8 writes its own auditable FIFO provenance. Register that provenance
  // before the mounted Phase 6 sale surface begins serving requests, so sales
  // can consume both the opening bridge and real post-cutover offloads.
  registerGoldenCoastPhase8FifoSource();
  // Phase 6 supersedes the Phase 5 mutation surface: it keeps the same FIFO
  // revenue/COGS behavior and atomically adds the Golden Coast special-location
  // Hassan Savings deduction. The Phase 5 source remains in the repository for
  // history/tests, but its production route is intentionally no longer mounted.
  registerSpGoldenCoastPhase6PosSaleRoutes(app);
  registerSpGoldenCoastPhase8ContainerOffloadRoutes(app);
  registerSpLifecycleGuards(app);
  registerSpContainerRoutes(app);
  registerSpReoffloadPreparationGuard(app);
  registerSpOffloadConcurrencyGuard(app);
  registerSpOffloadRoutes(app);
  registerSpOffloadLifecycleRoutes(app);
  registerSpChargeReconciliationRoutes(app);
  registerSpFullReconciliationRoutes(app);
  registerSpProductionClosureRoutes(app);
  registerSpSalesRoutes(app);
  registerSpLifecycleRoutes(app);
  registerSpOpeningStockRoutes(app);
  registerSpAliasRoutes(app);
  registerSpReportRoutes(app);
  registerSpExportRoutes(app);
}
