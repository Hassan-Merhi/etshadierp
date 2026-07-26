import type { Express, NextFunction, Request, Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth, requireRole } from "../../auth";
import { companies, userCompanyRoles, users } from "@shared/schema";

function activeCompanyId(req: Request): number | null {
  return (
    (req.session as any).factoryCompanyId ??
    req.session.currentCompanyId ??
    null
  );
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadTargetUserCompanyScope(userId: string) {
  return db
    .select({ companyId: userCompanyRoles.companyId, role: userCompanyRoles.role })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));
}

async function guardSingleCompanyUserMutation(req: Request, res: Response, next: NextFunction) {
  try {
    const companyId = activeCompanyId(req);
    if (!companyId) {
      res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
      return;
    }

    const targetUserId = String(req.params.id ?? req.params.userId ?? "").trim();
    if (!targetUserId) {
      res.status(400).json({ code: "USER_ID_INVALID", message: "Invalid user ID" });
      return;
    }

    const roles = await loadTargetUserCompanyScope(targetUserId);
    if (!roles.some((row) => row.companyId === companyId)) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const otherCompanyRole = roles.find((row) => row.companyId !== companyId);
    if (otherCompanyRole) {
      res.status(409).json({
        code: "SHARED_USER_GLOBAL_MUTATION_BLOCKED",
        message: "This user belongs to multiple companies. Manage the company role instead of changing the shared account globally.",
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

async function guardRoleRecordCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const companyId = activeCompanyId(req);
    const roleId = parsePositiveId(req.params.id);
    if (!companyId) {
      res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
      return;
    }
    if (!roleId) {
      res.status(400).json({ code: "ROLE_ID_INVALID", message: "Invalid role ID" });
      return;
    }

    const [roleRecord] = await db
      .select({ companyId: userCompanyRoles.companyId })
      .from(userCompanyRoles)
      .where(eq(userCompanyRoles.id, roleId))
      .limit(1);

    if (!roleRecord || roleRecord.companyId !== companyId) {
      res.status(404).json({ message: "Role assignment not found" });
      return;
    }

    const requestedCompanyId = req.body?.companyId;
    if (requestedCompanyId !== undefined && Number(requestedCompanyId) !== companyId) {
      res.status(403).json({
        code: "CROSS_COMPANY_ACCESS_DENIED",
        message: "Role assignments cannot be moved between companies.",
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function registerCompanyScopedUserAdministrationRoutes(app: Express) {
  // A company administrator sees only users assigned to the active company.
  // This route intentionally shadows the legacy global user list.
  app.get("/api/users", requireAuth, requireRole("Admin"), async (req, res, next) => {
    try {
      const companyId = activeCompanyId(req);
      if (!companyId) {
        res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
        return;
      }

      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          active: users.active,
          chatbotEnabled: users.chatbotEnabled,
          hiddenErpCostFields: users.hiddenErpCostFields,
          createdAt: users.createdAt,
        })
        .from(users)
        .innerJoin(
          userCompanyRoles,
          and(eq(userCompanyRoles.userId, users.id), eq(userCompanyRoles.companyId, companyId))
        )
        .where(ne(userCompanyRoles.role, "Developer"));

      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  // A company administrator sees only the target user's assignment for the active company.
  app.get(
    "/api/users/:userId/company-roles",
    requireAuth,
    requireRole("Admin"),
    async (req, res, next) => {
      try {
        const companyId = activeCompanyId(req);
        if (!companyId) {
          res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
          return;
        }

        const roles = await db
          .select({
            id: userCompanyRoles.id,
            userId: userCompanyRoles.userId,
            companyId: userCompanyRoles.companyId,
            role: userCompanyRoles.role,
            assignedLocationId: userCompanyRoles.assignedLocationId,
            cashAccountId: userCompanyRoles.cashAccountId,
            posStation: userCompanyRoles.posStation,
            canSellNegativeStock: userCompanyRoles.canSellNegativeStock,
            posViewOnly: userCompanyRoles.posViewOnly,
            daybookEditDays: userCompanyRoles.daybookEditDays,
            canAccessCustomers: userCompanyRoles.canAccessCustomers,
            canDeleteRecords: userCompanyRoles.canDeleteRecords,
            createdAt: userCompanyRoles.createdAt,
            companyName: companies.name,
            companyCode: companies.code,
          })
          .from(userCompanyRoles)
          .innerJoin(companies, eq(companies.id, userCompanyRoles.companyId))
          .where(
            and(
              eq(userCompanyRoles.userId, req.params.userId),
              eq(userCompanyRoles.companyId, companyId)
            )
          );

        res.json(roles);
      } catch (error) {
        next(error);
      }
    }
  );

  // Global user mutations are safe only when the target belongs exclusively to the active company.
  app.patch(
    "/api/users/:id",
    requireAuth,
    requireRole("Admin"),
    guardSingleCompanyUserMutation
  );
  app.delete(
    "/api/users/:id",
    requireAuth,
    requireRole("Admin"),
    guardSingleCompanyUserMutation
  );
  app.post(
    "/api/admin/reset-password/:userId",
    requireAuth,
    requireRole("Admin"),
    guardSingleCompanyUserMutation
  );

  // ID-only role mutations must load canonical company ownership before legacy route logic runs.
  app.patch(
    "/api/user-company-roles/:id",
    requireAuth,
    requireRole("Admin"),
    guardRoleRecordCompany
  );
  app.delete(
    "/api/user-company-roles/:id",
    requireAuth,
    requireRole("Admin"),
    guardRoleRecordCompany
  );
}
