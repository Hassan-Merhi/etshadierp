import type { Express } from "express";
import { eq, and, or } from "drizzle-orm";
import { companies } from "@shared/schema";
import { registerFactoryStockRoutes } from "./factory/factoryStockRoutes";
import { registerFactorySuppliersRoutes } from "./factory/factorySuppliersRoutes";
import { registerFactoryProductsRoutes } from "./factory/factoryProductsRoutes";
import { registerFactoryContainersRoutes } from "./factory/factoryContainersRoutes";
import { registerFactoryBalesRoutes } from "./factory/factoryBalesRoutes";
import { registerFactoryCustomersRoutes } from "./factory/factoryCustomersRoutes";
import { registerFactoryContainerReadAccessRoutes } from "./factory/factoryContainerReadAccessRoutes";
import { registerFactoryDocsUsersRoutes } from "./factory/factoryDocsUsersRoutes";
import { registerFactoryEmployeesPosRoutes } from "./factory/factoryEmployeesPosRoutes";
import { registerFactoryTransporterRoutes } from "./factory/factoryTransporterRoutes";
import { registerFactoryStockAllocationV2Routes } from "./factory/factoryStockAllocationV2Routes";
import { registerFactoryStockAllocationV5Routes } from "./factory/factoryStockAllocationV5Routes";
import { registerFactoryShippingContainerRoutes } from "./factory/factoryShippingContainerRoutes";
import { registerFactoryDailyScanRoutes } from "./factory/factoryDailyScanRoutes";
import { registerFactoryGroundScanRoutes } from "./factory/factoryGroundScanRoutes";
import { registerFactoryContainerTrackingRoutes } from "./factory/factoryContainerTrackingRoutes";
import { registerEndProductionRoutes } from "./factory/endProductionRoutes";
import { registerProductionPlannerRoutes } from "./factory/factoryProductionPlannerRoutes";
import { registerPerformanceReadMicrocache } from "./performance/readMicrocache";
import { registerFactoryDaybookPaginationRoutes } from "./factory/factoryDaybookPaginationRoutes";
import { registerFactoryStockEntryHistoryPaginationRoutes } from "./factory/factoryStockEntryHistoryPaginationRoutes";
import { registerFactoryStockAllocationV5PaginationRoutes } from "./factory/factoryStockAllocationV5PaginationRoutes";
import { createContainerDocumentDownloadHandler } from "../services/security/protectedAssetDownloadAdapter";

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
        const [co] = await db
          .select({ id: companies.id, companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, currentCompanyId));
        if (co?.companyType === "factory" || co?.companyType === "factory_v2") {
          session.factoryCompanyId = co.id;
          return next();
        }
      }

      // Fall back to any active factory-type company
      const [factoryComp] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            or(eq(companies.companyType, "factory"), eq(companies.companyType, "factory_v2")),
            eq(companies.active, true)
          )
        )
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

  registerPerformanceReadMicrocache(app);

  // ─────────────────────────────────────────────────────────────────────────────
  // FACTORY ADMIN GUARD — blocks PUT / PATCH / DELETE for non-admins unless
  // they have a valid admin-override session token
  // ─────────────────────────────────────────────────────────────────────────────
  app.use("/api/factory", (req: any, res: any, next: any) => {
    if (!["PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (!req.session?.userId) return next(); // unauthenticated — let requireAuth handle it

    // Bale deletion is open to all authenticated factory users — no admin override needed
    if (req.method === "DELETE" && /^\/bales\/\d+$/.test(req.path)) return next();

    // Removing a bale from a loading session is open to all authenticated factory users
    if (req.method === "DELETE" && /^\/invoice-loading-sessions\/\d+\/bales\/\d+$/.test(req.path)) return next();

    // Removing a bale from a customer order (loading context) is open to all authenticated factory users
    if (req.method === "DELETE" && /^\/customer-orders\/\d+\/bales\/\d+$/.test(req.path)) return next();

    // Daily bale scan removals are open to all authenticated factory users
    if (req.method === "DELETE" && /^\/daily-bale-scans\/\d+$/.test(req.path)) return next();

    // Ground scan item removals/clears are open to all authenticated factory users
    if (req.method === "DELETE" && /^\/ground-scan-items(\/\d+)?$/.test(req.path)) return next();

    // Worker assignment / reassignment is open to all authenticated factory users
    if (req.method === "PATCH" && /^\/bales\/\d+\/assign-worker$/.test(req.path)) return next();
    if (req.method === "PATCH" && req.path === "/bales/bulk-assign-worker") return next();

    // Loading note edits are open to all authenticated factory users (floor staff)
    if (req.method === "PATCH" && /^\/customer-orders\/\d+\/loading-note$/.test(req.path)) return next();

    const role = req.session?.currentRole as string | undefined;
    if (["Admin", "Owner", "Developer"].includes(role || "")) return next();

    const overrideUntil = req.session?.factoryAdminOverrideUntil as number | undefined;
    if (overrideUntil && Date.now() < overrideUntil) return next();

    return res.status(403).json({
      message: "Admin authorization required for this action.",
      requiresAdminOverride: true,
    });
  });

  // Container document downloads are intercepted before the legacy docs module
  // so canonical company, storage-key, size, and filename checks run first.
  app.get(
    "/api/factory/uploads/:folder/:filename",
    requireAuth,
    createContainerDocumentDownloadHandler(db)
  );

  // Paged requests are intercepted here and perform count/limit/offset in SQL.
  // Unpaged requests call next() and continue into the unchanged legacy handlers.
  registerFactoryDaybookPaginationRoutes(app);
  registerFactoryStockEntryHistoryPaginationRoutes(app);
  registerFactoryStockAllocationV5PaginationRoutes(app);

  registerFactoryStockRoutes(app);
  registerFactorySuppliersRoutes(app);
  registerFactoryProductsRoutes(app);
  // Tracking routes registered BEFORE registerFactoryContainersRoutes: it defines
  // literal siblings (/refresh-etas, /eta-tracking-summary) under the same
  // /api/factory/containers/... prefix as the container module's GET/DELETE
  // "/api/factory/containers/:id" routes. Express matches by registration order,
  // not specificity, so :id would otherwise swallow those literal paths first.
  registerFactoryContainerTrackingRoutes(app);
  registerFactoryContainersRoutes(app);
  registerFactoryBalesRoutes(app);
  registerFactoryCustomersRoutes(app);
  // ContainerDetail is an ERP screen but its historical document/freight URLs
  // live below /api/factory. Register the ERP-company-aware GET handlers first.
  registerFactoryContainerReadAccessRoutes(app);
  registerFactoryDocsUsersRoutes(app);
  registerFactoryEmployeesPosRoutes(app);
  registerFactoryTransporterRoutes(app);
  registerFactoryStockAllocationV2Routes(app);
  registerFactoryStockAllocationV5Routes(app);
  registerFactoryShippingContainerRoutes(app);
  registerFactoryDailyScanRoutes(app);
  registerFactoryGroundScanRoutes(app);
  registerEndProductionRoutes(app, requireAuth);
  registerProductionPlannerRoutes(app);
}
