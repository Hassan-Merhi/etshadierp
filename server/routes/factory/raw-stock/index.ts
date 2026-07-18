import type { Express } from "express";
import { requireExplicitCompanyContext } from "../../../services/security/companyContextEnforcementAdapter";
import { registerRawStockCrudRoutes } from "./rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./rawStockBalanceRoutes";

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
}
