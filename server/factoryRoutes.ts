import type { Express } from "express";
import { eq, and } from "drizzle-orm";
import { companies } from "@shared/schema";
import { registerFactoryStockRoutes } from "./factoryRoutes/factoryStockRoutes";
import { registerFactorySuppliersRoutes } from "./factoryRoutes/factorySuppliersRoutes";
import { registerFactoryProductsRoutes } from "./factoryRoutes/factoryProductsRoutes";
import { registerFactoryContainersRoutes } from "./factoryRoutes/factoryContainersRoutes";
import { registerFactoryBalesRoutes } from "./factoryRoutes/factoryBalesRoutes";
import { registerFactoryCustomersRoutes } from "./factoryRoutes/factoryCustomersRoutes";
import { registerFactoryDocsUsersRoutes } from "./factoryRoutes/factoryDocsUsersRoutes";
import { registerFactoryEmployeesPosRoutes } from "./factoryRoutes/factoryEmployeesPosRoutes";

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
        if (co?.companyType === "factory") {
          session.factoryCompanyId = co.id;
          return next();
        }
      }

      const [factoryComp] = await db.select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.companyType, "factory"), eq(companies.active, true)))
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
}
