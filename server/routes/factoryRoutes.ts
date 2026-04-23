import type { Express } from "express";
import { eq, and, or } from "drizzle-orm";
import { companies } from "@shared/schema";
import { registerFactoryStockRoutes } from "./factory/factoryStockRoutes";
import { registerFactorySuppliersRoutes } from "./factory/factorySuppliersRoutes";
import { registerFactoryProductsRoutes } from "./factory/factoryProductsRoutes";
import { registerFactoryContainersRoutes } from "./factory/factoryContainersRoutes";
import { registerFactoryBalesRoutes } from "./factory/factoryBalesRoutes";
import { registerFactoryCustomersRoutes } from "./factory/factoryCustomersRoutes";
import { registerFactoryDocsUsersRoutes } from "./factory/factoryDocsUsersRoutes";
import { registerFactoryEmployeesPosRoutes } from "./factory/factoryEmployeesPosRoutes";
import { registerFactoryTransporterRoutes } from "./factory/factoryTransporterRoutes";
import { registerFactoryStockAllocationV2Routes } from "./factory/factoryStockAllocationV2Routes";

export function registerFactoryRoutes(app: Express, requireAuth: any, db: any) {

  // ─────────────────────────────────────────────────────────────────────────────
  // FACTORY COMPANY RESOLUTION MIDDLEWARE
  // ─────────────────────────────────────────────────────────────────────────────
  app.use("/api/factory", async (req: any, res: any, next: any) => {
    try {
      const session = req.session as any;
      if (!session?.userId) return next();
      if (session.factoryCompanyId) return next();

      const currentCompanyId = session.currentCompanyId;

      if (currentCompanyId) {
        const [co] = await db.select({ id: companies.id, companyType: companies.companyType })
          .from(companies).where(eq(companies.id, currentCompanyId));
        if (co?.companyType === "factory" || co?.companyType === "factory_v2") {
          session.factoryCompanyId = co.id;
          return next();
        }
      }

      // Fall back to any active factory-type company
      const [factoryComp] = await db.select({ id: companies.id })
        .from(companies)
        .where(and(
          or(eq(companies.companyType, "factory"), eq(companies.companyType, "factory_v2")),
          eq(companies.active, true),
        ))
        .limit(1);
      if (factoryComp) {
        session.factoryCompanyId = factoryComp.id;
        return next();
      }

      if (currentCompanyId) session.factoryCompanyId = currentCompanyId;
      next();
    } catch {
      next();
    }
  });

  registerFactoryStockRoutes(app);
  registerFactorySuppliersRoutes(app);
  registerFactoryProductsRoutes(app);
  registerFactoryContainersRoutes(app);
  registerFactoryBalesRoutes(app);
  registerFactoryCustomersRoutes(app);
  registerFactoryDocsUsersRoutes(app);
  registerFactoryEmployeesPosRoutes(app);
  registerFactoryTransporterRoutes(app);
  registerFactoryStockAllocationV2Routes(app);
}
