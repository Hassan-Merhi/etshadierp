import { Request, Response, NextFunction } from "express";
import { logger } from "./lib/logger";
import { db } from "./db";
import { userLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getClientDate } from "./lib/dateUtils";
import { enforceRuntimeSession } from "./services/security/sessionEnforcementAdapter";
import { hydrateActiveCredentialVersion } from "./services/security/credentialVersionService";
import {
  CompanyAuthorizationError,
  loadUserCompanyAuthorizationScope,
  scopeAllowsCompanyMembership,
} from "./services/security/companyAuthorizationService";
import { decideExplicitCompanyScope } from "./services/security/companyRequestScopePolicy";

function logDenied(params: {
  userId?: string | null;
  username?: string | null;
  role?: string | null;
  companyId?: number | null;
  method: string;
  path: string;
  reason: string;
}) {
  logger.error(
    JSON.stringify({
      event: "access_denied",
      ts: new Date().toISOString(),
      userId: params.userId ?? null,
      username: params.username ?? null,
      role: params.role ?? null,
      companyId: params.companyId ?? null,
      method: params.method,
      path: params.path,
      reason: params.reason,
    })
  );
}

function rejectInvalidSession(
  req: Request,
  res: Response,
  result: ReturnType<typeof enforceRuntimeSession>,
  fallbackMessage: string
) {
  logDenied({
    userId: req.session.userId ?? null,
    username: req.session.username ?? null,
    role: req.session.currentRole ?? null,
    companyId: req.session.currentCompanyId ?? null,
    method: req.method,
    path: req.path,
    reason: result.code,
  });

  if (result.destroySession) req.session.destroy(() => undefined);
  return res.status(result.status).json({ message: fallbackMessage });
}

async function enforceCredentialAwareSession(
  req: Request,
  options: { requireCompanyContext: boolean; requireRecentPasswordConfirmation?: boolean }
) {
  if (req.session.userId) await hydrateActiveCredentialVersion(db, req.session as any);
  return enforceRuntimeSession(req.session as any, options);
}

function effectiveCompanyId(req: Request): number | null {
  return (
    (req as any).authorizedCompanyId ??
    (req.session as any).factoryCompanyId ??
    req.session.currentCompanyId ??
    null
  );
}

function effectiveRole(req: Request): string | null {
  return (req as any).authorizedCompanyRole ?? req.user?.role ?? req.session.currentRole ?? null;
}

function isAlternateCompanyScope(req: Request): boolean {
  const scoped = Number((req as any).authorizedCompanyId);
  const current = Number(req.session.currentCompanyId);
  return Number.isInteger(scoped) && scoped > 0 && scoped !== current;
}

async function authorizeExplicitCompanyScope(req: Request, res: Response): Promise<boolean> {
  const decision = decideExplicitCompanyScope({
    queryCompanyId: req.query?.companyId,
    bodyCompanyId: (req.body as Record<string, unknown> | undefined)?.companyId,
    currentCompanyId: req.session.currentCompanyId,
    factoryCompanyId: (req.session as any).factoryCompanyId,
  });

  if (decision.kind === "none" || decision.kind === "authorized-session") return true;

  if (decision.kind === "invalid") {
    res.status(400).json({
      code: "COMPANY_ID_INVALID",
      message: `Invalid companyId in request ${decision.source}.`,
    });
    return false;
  }

  if (decision.kind === "conflict") {
    res.status(400).json({
      code: "COMPANY_ID_CONFLICT",
      message: "The companyId in the request query and body must match.",
    });
    return false;
  }

  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }

  const scope = await loadUserCompanyAuthorizationScope(userId);
  if (!scopeAllowsCompanyMembership(scope, decision.companyId)) {
    const error = new CompanyAuthorizationError(
      "You do not have access to the requested company.",
      403,
      "COMPANY_MEMBERSHIP_REQUIRED"
    );
    logDenied({
      userId,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      companyId: decision.companyId,
      method: req.method,
      path: req.path,
      reason: error.code,
    });
    res.status(error.status).json({ code: error.code, message: error.message });
    return false;
  }

  (req as any).authorizedCompanyId = decision.companyId;
  (req as any).authorizedCompanyRole = scope.isDeveloper
    ? "Developer"
    : scope.companyRoles.get(decision.companyId) ?? null;
  return true;
}

// Light authentication middleware — only requires a valid user session.
export async function requireLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await enforceCredentialAwareSession(req, { requireCompanyContext: false });
    if (!result.valid) return rejectInvalidSession(req, res, result, "Unauthorized");
    next();
  } catch (error) {
    next(error);
  }
}

// Authentication middleware for company-scoped routes.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionResult = await enforceCredentialAwareSession(req, { requireCompanyContext: true });
    if (!sessionResult.valid) {
      const message = sessionResult.code === "SESSION_COMPANY_REQUIRED" ? "No company selected" : "Unauthorized";
      return rejectInvalidSession(req, res, sessionResult, message);
    }

    const role = req.session.currentRole;
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    if (!(await authorizeExplicitCompanyScope(req, res))) return;

    req.user = {
      id: req.session.userId,
      username: req.session.username,
      role: effectiveRole(req) ?? role,
      assignedLocationId: req.session.currentLocationId ?? null,
      posStation: req.session.currentPOSStation ?? null,
      cashAccountId: req.session.cashAccountId ?? null,
      canSellNegativeStock: ["Admin", "Owner", "Manager", "Developer"].includes(effectiveRole(req) ?? role)
        ? true
        : (req.session.canSellNegativeStock ?? false),
      posViewOnly: (req.session as any).posViewOnly ?? false,
      daybookEditDays: req.session.daybookEditDays ?? 0,
      canAccessCustomers: req.session.canAccessCustomers ?? false,
      canDeleteRecords: req.session.canDeleteRecords ?? false,
    } as any;

    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = effectiveRole(req);
    if (!req.user || !role) return res.status(401).json({ message: "Unauthorized" });
    if (role === "Developer" || roles.includes(role)) return next();
    return res.status(403).json({ message: "Forbidden" });
  };
}

export function canDelete(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  const role = effectiveRole(req);
  const companyId = effectiveCompanyId(req);
  const denied = (reason: string, message: string) => {
    logDenied({
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role,
      companyId,
      method: req.method,
      path: req.path,
      reason,
    });
    return res.status(403).json({ message });
  };

  if (role === "Developer" || role === "Admin") return next();
  if (role === "Owner") return denied("Owner role cannot delete records", "Owners cannot delete records");
  if (role === "POS") return denied("POS role cannot delete records", "POS users cannot delete records");

  // Session permission flags belong to the active company and must never be reused
  // for a different explicitly requested company.
  if (!isAlternateCompanyScope(req) && req.session.canDeleteRecords === true) return next();

  if (role === "Manager") {
    return denied("Manager without company-scoped canDeleteRecords flag", "This manager account does not have delete permission");
  }

  return denied(`Role '${role}' is not permitted to delete records`, "You do not have permission to delete records");
}

export function canModifyDate(dateField: string = "voucherDate") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = effectiveRole(req);
    if (!req.user || !role) return res.status(401).json({ message: "Unauthorized" });
    if (role === "Admin" || role === "Developer") return next();

    const recordDate: string | undefined = req.body[dateField];
    if (!recordDate) return next();

    const today = getClientDate(req);
    if (role === "POS") {
      if (recordDate !== today) {
        return res.status(403).json({ message: "You can only create or modify records for today's date" });
      }
      return next();
    }

    if (role === "Manager" || role === "Owner") {
      if (recordDate === today) return next();
      const editDays = isAlternateCompanyScope(req) ? 0 : (req.session.daybookEditDays ?? 0);
      if (editDays === 0) {
        return res.status(403).json({ message: "You can only create or modify records for today's date" });
      }
      const diffDays = Math.floor((new Date(today).getTime() - new Date(recordDate).getTime()) / 86_400_000);
      if (diffDays < 0 || diffDays > editDays) {
        return res.status(403).json({ message: `You can only modify records within ${editDays} day(s) of today` });
      }
      return next();
    }

    next();
  };
}

export async function checkPOSLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const role = effectiveRole(req);
    if (!req.user || !role) return res.status(401).json({ message: "Unauthorized" });
    if (role !== "POS") return next();

    const rawLocationId = req.params.locationId ?? req.body?.locationId ?? req.query.locationId;
    const locationId = Number.parseInt(String(rawLocationId ?? ""), 10);
    if (!Number.isInteger(locationId) || locationId <= 0) return next();

    const companyId = effectiveCompanyId(req);
    if (!companyId) return res.status(403).json({ message: "No company selected" });

    const [assignment] = await db
      .select({ id: userLocations.id })
      .from(userLocations)
      .where(
        and(
          eq(userLocations.userId, req.user.id),
          eq(userLocations.companyId, companyId),
          eq(userLocations.locationId, locationId)
        )
      )
      .limit(1);

    if (!assignment) {
      return res.status(403).json({ message: "You can only access data for your assigned locations" });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requirePasswordConfirmation(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await enforceCredentialAwareSession(req, {
      requireCompanyContext: true,
      requireRecentPasswordConfirmation: true,
    });
    if (!result.valid) {
      const message = result.code === "SESSION_PASSWORD_CONFIRMATION_REQUIRED"
        ? "Password confirmation required"
        : "Unauthorized";
      return rejectInvalidSession(req, res, result, message);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function blockViewOnlyWrites(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!req.path.startsWith("/api")) return next();
  if (req.path.startsWith("/api/auth/")) return next();

  const role = req.session.currentRole;
  if (role === "View Only") {
    logDenied({
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      reason: "View Only role attempted a write operation",
    });
    return res.status(403).json({ message: "View Only accounts cannot make changes" });
  }
  next();
}

export function requireNonPOS(req: Request, res: Response, next: NextFunction) {
  const role = effectiveRole(req);
  if (!req.user || !role) return res.status(401).json({ message: "Unauthorized" });

  if (role === "POS") {
    logDenied({
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role,
      companyId: effectiveCompanyId(req),
      method: req.method,
      path: req.path,
      reason: "POS role attempted access to non-POS route",
    });
    return res.status(403).json({ message: "Access denied: This resource is not available for POS users" });
  }

  next();
}
