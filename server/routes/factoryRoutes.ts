import type { Express } from "express";
import { eq, and, or } from "drizzle-orm";
import { companies, userCompanyRoles } from "@shared/schema";
import { registerFactoryStockRoutes } from "./factory/stock";
import { registerFactorySuppliersRoutes } from "./factory/factorySuppliersRoutes";
import { registerFactoryProductsRoutes } from "./factory/products";
import { registerFactoryContainersRoutes } from "./factory/containers";
import { registerFactoryBalesRoutes } from "./factory/bales";
import { registerFactoryCustomersRoutes } from "./factory/customers-core";
import { registerFactoryContainerReadAccessRoutes } from "./factory/factoryContainerReadAccessRoutes";
import { registerFactoryDocsUsersRoutes } from "./factory/docs-users";
import { registerFactoryEmployeesPosRoutes } from "./factory/factoryEmployeesPosRoutes";
import { registerFactoryTransporterRoutes } from "./factory/factoryTransporterRoutes";
import { registerFactoryStockAllocationV2Routes } from "./factory/factoryStockAllocationV2Routes";
import { registerFactoryStockAllocationV5Routes } from "./factory/stock-allocation-v5";
import { registerFactoryShippingContainerRoutes } from "./factory/factoryShippingContainerRoutes";
import { registerFactoryDailyScanRoutes } from "./factory/factoryDailyScanRoutes";
import { registerFactoryGroundScanRoutes } from "./factory/factoryGroundScanRoutes";
import { registerFactoryContainerTrackingRoutes } from "./factory/factoryContainerTrackingRoutes";
import { registerEndProductionRoutes } from "./factory/endProductionRoutes";
import { registerProductionPlannerRoutes } from "./factory/factoryProductionPlannerRoutes";
import { registerFactoryContactRoutes } from "./factory/factoryContactRoutes";
import { registerPerformanceReadMicrocache } from "./performance/readMicrocache";
import { registerFactoryDaybookPaginationRoutes } from "./factory/factoryDaybookPaginationRoutes";
import { registerFactoryStockEntryHistoryPaginationRoutes } from "./factory/factoryStockEntryHistoryPaginationRoutes";
import { registerFactoryStockAllocationV5PaginationRoutes } from "./factory/factoryStockAllocationV5PaginationRoutes";
import { registerCentralFactoryPayrollGenerationRoute } from "./payroll/centralFactoryPayrollGenerationRoute";
import { registerCentralGlobalTransactionRoutes } from "./global/centralGlobalTransactionRoutes";
import { createContainerDocumentDownloadHandler } from "../services/security/protectedAssetDownloadAdapter";
import { enforceCompanyUserRoleScope } from "../middleware/companyUserRoleScope";
import { enforceCompanyResourceScope } from "../middleware/companyResourceScope";
import { enforceDeletedItemCompanyScope } from "../middleware/deletedItemCompanyScope";
import { enforceGlobalTransactionCompanyScope } from "../middleware/globalTransactionCompanyScope";
import { enforceOperationalPermissionScope } from "../middleware/operationalPermissionScope";
import {
  ActiveCompanyPermissionContextError,
  getActiveCompanyPermissionContext,
} from "../services/security/activeCompanyPermissionContext";
import { chooseAuthorizedFactoryCompany } from "../services/security/factoryCompanyScopePolicy";
import { isErpContainerFactoryAlias } from "../services/security/companyResourceRoutePolicy";

export function registerFactoryRoutes(app: Express, requireAuth: any, db: any) {
  // ─────────────────────────────────────────────────────────────────────────────
  // FACTORY COMPANY RESOLUTION MIDDLEWARE
  // ─────────────────────────────────────────────────────────────────────────────
  app.use("/api/factory", async (req: any, res: any, next: any) => {
    try {
      const session = req.session as any;
      if (!session?.userId) return next();

      // Historical ERP ContainerDetail aliases live under /api/factory but use
      // the ERP containers table and their own current-company ownership checks.
      if (isErpContainerFactoryAlias(req.path)) return next();

      const assignedFactories = await db
        .select({
          id: companies.id,
          companyType: companies.companyType,
          active: companies.active,
        })
        .from(userCompanyRoles)
        .innerJoin(companies, eq(companies.id, userCompanyRoles.companyId))
        .where(
          and(
            eq(userCompanyRoles.userId, session.userId),
            eq(companies.active, true),
            or(eq(companies.companyType, "factory"), eq(companies.companyType, "factory_v2"))
          )
        )
        .orderBy(companies.id);

      let currentCompany = assignedFactories.find((company: any) => company.id === session.currentCompanyId) ?? null;

      // A Developer may explicitly switch to any company through /api/auth/set-company.
      // Preserve that explicit server-owned context, but never choose a global factory
      // merely because the user opened a factory URL from an ERP company.
      if (!currentCompany && session.currentRole === "Developer" && session.currentCompanyId) {
        const [developerCurrent] = await db
          .select({
            id: companies.id,
            companyType: companies.companyType,
            active: companies.active,
          })
          .from(companies)
          .where(eq(companies.id, session.currentCompanyId))
          .limit(1);
        if (
          developerCurrent?.active &&
          (developerCurrent.companyType === "factory" || developerCurrent.companyType === "factory_v2")
        ) {
          currentCompany = developerCurrent;
          assignedFactories.unshift(developerCurrent);
        }
      }

      const factoryCompanyId = chooseAuthorizedFactoryCompany({
        pinnedFactoryId: session.factoryCompanyId,
        currentCompany,
        assignedFactoryIds: assignedFactories.map((company: any) => company.id),
      });

      if (!factoryCompanyId) {
        delete session.factoryCompanyId;
        return res.status(403).json({
          message: "You do not have access to a Factory company.",
          code: "FACTORY_COMPANY_ACCESS_REQUIRED",
        });
      }

      session.factoryCompanyId = factoryCompanyId;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  // Program 3A global guards. registerFactoryRoutes is the first route registry in
  // server/routes.ts. Factory company resolution runs first; these guards then
  // execute before all legacy auth and business handlers.
  app.use(async (req, res, next) => {
    try {
      if (!(await enforceCompanyUserRoleScope(req, res))) return;
      if (!(await enforceCompanyResourceScope(req, res))) return;
      if (!(await enforceDeletedItemCompanyScope(req, res))) return;
      if (!(await enforceGlobalTransactionCompanyScope(req, res))) return;
      next();
    } catch (error) {
      next(error);
    }
  });

  // Program 3B operational permissions run after company ownership is resolved
  // and before every legacy import, repair, export, backup, and bulk handler.
  app.use(enforceOperationalPermissionScope);

  // Protected global transaction list/type routes run before the legacy module.
  registerCentralGlobalTransactionRoutes(app, requireAuth);

  registerPerformanceReadMicrocache(app);

  // ─────────────────────────────────────────────────────────────────────────────
  // FACTORY ADMIN GUARD — blocks PUT / PATCH / DELETE for non-admins unless
  // they have a valid admin-override session token
  // ─────────────────────────────────────────────────────────────────────────────
  app.use("/api/factory", async (req: any, res: any, next: any) => {
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

    try {
      const context = await getActiveCompanyPermissionContext(req);
      if (["Admin", "Owner", "Developer"].includes(context.role)) return next();

      const overrideUntil = req.session?.factoryAdminOverrideUntil as number | undefined;
      if (overrideUntil && Date.now() < overrideUntil) return next();

      return res.status(403).json({
        message: "Admin authorization required for this action.",
        requiresAdminOverride: true,
      });
    } catch (error) {
      if (error instanceof ActiveCompanyPermissionContextError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      return next(error);
    }
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

  // Registered here because registerFactoryRoutes runs before the legacy
  // registerFactoryPayrollRoutes module in server/routes.ts. The protected route
  // therefore owns generation without changing the remaining payroll endpoints.
  registerCentralFactoryPayrollGenerationRoute(app, requireAuth);

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
  registerFactoryContactRoutes(app);
}
