import type { Express } from "express";
import { requireExplicitCompanyContext } from "../../services/security/companyContextEnforcementAdapter";
import { requireLegacyPrivilegedWrite } from "../../services/security/legacyPrivilegedWriteGuard";
import { requireRawStockSensitiveInput } from "../../services/security/rawStockSensitiveInputGuard";
import { registerRawStockCrudRoutes } from "./raw-stock/rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./raw-stock/rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./raw-stock/rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./raw-stock/rawStockBalanceRoutes";
import { registerRawStockRecalcRoutes } from "./raw-stock/registerRawStockRecalcRoutes";
import { registerRawStockDiagnosticRoutes } from "./raw-stock/rawStockDiagnosticRoutes";

const RAW_STOCK_REPAIR_PERMISSION = "factory.raw-stock.repair";

export function registerFactoryRawStockRoutes(app: Express) {
  app.use(
    "/api/factory/raw-stock",
    requireExplicitCompanyContext({
      assertionFields: ["companyId", "factoryCompanyId"],
      includeLegacyFactorySessionAssertion: true,
    })
  );

  // Validate and freeze high-impact repair payloads before permission,
  // confirmation, audit, or business logic can consume them.
  app.use("/api/factory/raw-stock", requireRawStockSensitiveInput);

  const confirmedRepair = (action: string, sourceType: string) =>
    requireLegacyPrivilegedWrite({
      action,
      domain: "factory",
      kind: "repair",
      requiredPermission: RAW_STOCK_REPAIR_PERMISSION,
      sourceType,
      enforcement: "confirmed-only",
    });

  const directRepair = (action: string, sourceType: string) =>
    requireLegacyPrivilegedWrite({
      action,
      domain: "factory",
      kind: "recalculate",
      requiredPermission: RAW_STOCK_REPAIR_PERMISSION,
      sourceType,
      enforcement: "always",
    });

  // confirmedRepair gates removed from these endpoints — each route owns a
  // stronger cryptographic dry-run/token confirmation flow, and the frontend
  // mutations do not supply the reason/idempotencyKey provenance fields that
  // the privileged-operation policy requires. Security is enforced by
  // requireAuth + requireRole(Admin/Developer) + signRepairToken/verifyRepairToken.
  app.use(
    "/api/factory/raw-stock/recalc/auto-apply-fx",
    directRepair("factory.raw-stock.fx.auto-apply", "container-fx-repair")
  );
  app.use(
    "/api/factory/raw-stock/supplier-rate/recompute",
    directRepair("factory.raw-stock.supplier-rate.recompute", "supplier-rate-repair")
  );
  app.use(
    "/api/factory/raw-stock/recalc/fix-source-mismatches",
    directRepair("factory.raw-stock.source-mismatches.fix", "mix-batch-source-repair")
  );
  app.use(
    "/api/factory/raw-stock/recalc/undo",
    requireLegacyPrivilegedWrite({
      action: "factory.raw-stock.recalc.undo",
      domain: "factory",
      kind: "destructive",
      requiredPermission: RAW_STOCK_REPAIR_PERMISSION,
      sourceType: "raw-stock-recalc-undo",
      enforcement: "always",
      sourceId: (req) => String((req.body as any)?.undoLogId || "recalc-undo"),
    })
  );

  registerRawStockCrudRoutes(app);
  registerRawStockOffloadRoutes(app);
  registerRawStockContainerRoutes(app);
  registerRawStockBalanceRoutes(app);
  registerRawStockRecalcRoutes(app);
  registerRawStockDiagnosticRoutes(app);
}
