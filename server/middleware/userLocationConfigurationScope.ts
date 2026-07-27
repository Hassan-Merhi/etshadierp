import type { Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { ledgerAccounts, locations, userCompanyRoles } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { resolveActiveCompanyId } from "../routes/helpers/resolveActiveCompanyId";
import { canAccessTargetUser } from "../services/security/companyUserAdminScopePolicy";
import { classifyUserLocationConfigurationRoute } from "../services/security/userLocationConfigurationPolicy";

function positiveIds(values: unknown[]): number[] | null {
  const ids = values.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  return [...new Set(ids)];
}

function deny(
  req: Request,
  res: Response,
  reason: string,
  status = 404,
  message = "Configuration not found"
): false {
  logger.error(
    JSON.stringify({
      event: "user_location_configuration_scope_denied",
      ts: new Date().toISOString(),
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      reason,
    })
  );
  res.status(status).json({ message });
  return false;
}

export async function enforceUserLocationConfigurationScope(
  req: Request,
  res: Response
): Promise<boolean> {
  const route = classifyUserLocationConfigurationRoute(req.path);
  if (!route) return true;

  const sessionUserId = req.session.userId;
  const actorRole = req.session.currentRole;
  const activeCompanyId = resolveActiveCompanyId(req);
  if (!sessionUserId || !actorRole || !activeCompanyId) return true;

  if (route.companyId !== activeCompanyId) {
    return deny(req, res, "USER_LOCATION_COMPANY_MISMATCH");
  }

  const targetRoles = await db
    .select({
      userId: userCompanyRoles.userId,
      companyId: userCompanyRoles.companyId,
      role: userCompanyRoles.role,
    })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, route.userId));

  if (!canAccessTargetUser(targetRoles, route.userId, activeCompanyId, actorRole)) {
    return deny(req, res, "USER_LOCATION_TARGET_SCOPE_DENIED");
  }

  const method = req.method.toUpperCase();
  if (
    method === "GET" &&
    route.userId !== sessionUserId &&
    !["Admin", "Owner", "Developer"].includes(actorRole)
  ) {
    return deny(req, res, "USER_LOCATION_READ_ROLE_DENIED", 403, "Access denied");
  }

  if (method !== "PUT") return true;

  if (route.kind === "locations") {
    const locationIds = req.body?.locationIds;
    if (!Array.isArray(locationIds)) return true;
    const ids = positiveIds(locationIds);
    if (ids == null) {
      return deny(req, res, "USER_LOCATION_ID_INVALID", 400, "Invalid location ID");
    }
    if (ids.length === 0) return true;

    const rows = await db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          inArray(locations.id, ids),
          eq(locations.companyId, activeCompanyId),
          isNull(locations.deletedAt)
        )
      );
    if (rows.length !== ids.length) {
      return deny(req, res, "USER_LOCATION_OWNERSHIP_INVALID", 400, "Invalid location selection");
    }
    return true;
  }

  const mappings = req.body?.mappings;
  if (!Array.isArray(mappings)) return true;

  const locationIds = positiveIds(mappings.map((mapping: any) => mapping?.locationId));
  const cashAccountIds = positiveIds(mappings.map((mapping: any) => mapping?.cashAccountId));
  if (locationIds == null || cashAccountIds == null) {
    return deny(req, res, "USER_CASH_MAPPING_ID_INVALID", 400, "Invalid cash mapping");
  }
  if (mappings.length === 0) return true;

  const [locationRows, cashRows] = await Promise.all([
    db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          inArray(locations.id, locationIds),
          eq(locations.companyId, activeCompanyId),
          isNull(locations.deletedAt)
        )
      ),
    db
      .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType })
      .from(ledgerAccounts)
      .where(
        and(
          inArray(ledgerAccounts.id, cashAccountIds),
          eq(ledgerAccounts.companyId, activeCompanyId),
          isNull(ledgerAccounts.deletedAt)
        )
      ),
  ]);

  if (
    locationRows.length !== locationIds.length ||
    cashRows.length !== cashAccountIds.length ||
    cashRows.some((row) => row.accountType !== "Cash")
  ) {
    return deny(req, res, "USER_CASH_MAPPING_OWNERSHIP_INVALID", 400, "Invalid cash mapping");
  }

  return true;
}
