import type { Express } from "express";
import { requireExplicitCompanyContext } from "../../services/security/companyContextEnforcementAdapter";
import { registerRawStockCrudRoutes } from "./raw-stock/rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./raw-stock/rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./raw-stock/rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./raw-stock/rawStockBalanceRoutes";
import { registerRawStockRecalcRoutes } from "./raw-stock/rawStockRecalcRoutes";
import { registerRawStockDiagnosticRoutes } from "./raw-stock/rawStockDiagnosticRoutes";

export function registerFactoryRawStockRoutes(app: Express) {
  app.use(
    "/api/factory/raw-stock",
    requireExplicitCompanyContext({
      assertionFields: ["companyId", "factoryCompanyId"],
      includeLegacyFactorySessionAssertion: true,
    })
  );

  registerRawStockCrudRoutes(app);
  registerRawStockOffloadRoutes(app);
  registerRawStockContainerRoutes(app);
  registerRawStockBalanceRoutes(app);
  registerRawStockRecalcRoutes(app);
  registerRawStockDiagnosticRoutes(app);
}
