import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { userLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getClientDate } from "./lib/dateUtils";
import { enforceRuntimeSession } from "./services/security/sessionEnforcementAdapter";

function logDenied(params: {
  userId?: string | null;
  username?: string | null;
  role?: string | null;
  companyId?: number | null;
  method: string;
  path: string;
  reason: string;
}) {
  console.error(
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

  if (result.destroySession) {
    req.session.destroy(() => undefined);
  }

  return res.status(result.status).json({ message: fallbackMessage });
}

// Light authentication middleware — only requires a valid user session.
// Does NOT require a company to be selected. Use for personal-account actions.
export function requireLogin(req: Request, res: Response, next: NextFunction) {
  const result = enforceRuntimeSession(req.session as any, {
    requireCompanyContext: false,
  });
  if (!result.valid) {
    return rejectInvalidSession(req, res, result, "Unauthorized");
  }
  next();
}

// Authentication middleware for company-scoped routes. Session validation stays
// synchronous and uses only session state, preserving the existing zero-DB-call
// hot path while adding idle, absolute-lifetime, company, and revocation checks.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionResult = enforceRuntimeSession(req.session as any, {
    requireCompanyContext: true,
  });
  if (!sessionResult.valid) {
    const message = sessionResult.code === "SESSION_COMPANY_REQUIRED" ? "No company selected" : "Unauthorized";
    return rejectInvalidSession(req, res, sessionResult, message);
  }

  const role = req.session.currentRole;
  if (!role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  req.user = {
    id: req.session.userId,
    username: req.session.username,
    role,
    assignedLocationId: req.session.currentLocationId ?? null,
    posStation: req.session.currentPOSStation ?? null,
    cashAccountId: req.session.cashAccountId ?? null,
    canSellNegativeStock: ["Admin", "Owner", "Manager", "Developer"].includes(role)
      ? true
      : (req.session.canSellNegativeStock ?? false),
    posViewOnly: (req.session as any).posViewOnly ?? false,
    daybookEditDays: req.session.daybookEditDays ?? 0,
    canAccessCustomers: req.session.canAccessCustomers ?? false,
    canDeleteRecords: req.session.canDeleteRecords ?? false,
  } as any;

  next();
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role === "Developer" || roles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ message: "Forbidden" });
  };
}

export function canDelete(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const role = req.user.role;
  const path = req.path;
  const method = req.method;
  const userId = req.session.userId ?? null;
  const username = req.session.username ?? null;
  const companyId = req.session.currentCompanyId ?? null;

  if (role === "Developer" || role === "Admin") {
    return next();
  }

  if (role === "Owner") {
    logDenied({ userId, username, role, companyId, method, path, reason: "Owner role cannot delete records" });
    return res.status(403).json({ message: "Owners cannot delete records" });
  }

  if (role === "POS") {
    logDenied({ userId, username, role, companyId, method, path, reason: "POS role cannot delete records" });
    return res.status(403).json({ message: "POS users cannot delete records" });
  }

  if (req.session.canDeleteRecords === true) {
    return next();
  }

  if (role === "Manager") {
    logDenied({ userId, username, role, companyId, method, path, reason: "Manager without canDeleteRecords flag" });
    return res.status(403).json({ message: "This manager account does not have delete permission" });
  }

  logDenied({
    userId,
    username,
    role,
    companyId,
    method,
    path,
    reason: `Role '${role}' is not permitted to delete records`,
  });
  return res.status(403).json({ message: "You do not have permission to delete records" });
}

export function canModifyDate(dateField: string = "voucherDate") {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const role = req.user.role;
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
      const editDays = req.session.daybookEditDays ?? 0;
      if (editDays === 0) {
        return res.status(403).json({ message: "You can only create or modify records for today's date" });
      }
      const todayMs = new Date(today).getTime();
      const recordMs = new Date(recordDate).getTime();
      const diffDays = Math.floor((todayMs - recordMs) / 86_400_000);
      if (diffDays < 0 || diffDays > editDays) {
        return res.status(403).json({ message: `You can only modify records within ${editDays} day(s) of today` });
      }
      return next();
    }

    next();
  };
}

export async function checkPOSLocation(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const isPOS = req.user.role === "POS";
  if (!isPOS) return next();

  const locationId = parseInt(req.params.locationId || req.body.locationId || req.query.locationId);
  if (!locationId) return next();

  const companyId = req.session.currentCompanyId;
  if (!companyId) return res.status(403).json({ message: "No company selected" });

  const assignedLocations = await db
    .select({ locationId: userLocations.locationId })
    .from(userLocations)
    .where(and(eq(userLocations.userId, req.user.id), eq(userLocations.companyId, companyId)));

  const allowedIds = assignedLocations.map((l) => l.locationId);
  if (!allowedIds.includes(locationId)) {
    return res.status(403).json({ message: "You can only access data for your assigned locations" });
  }

  next();
}

export function requirePasswordConfirmation(req: Request, res: Response, next: NextFunction) {
  const result = enforceRuntimeSession(req.session as any, {
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
}

export function blockViewOnlyWrites(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!req.path.startsWith("/api")) return next();
  if (req.path.startsWith("/api/auth/")) return next();

  const role = (req.session as any)?.currentRole;
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
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const isPOS = req.user.role === "POS";
  if (isPOS) {
    logDenied({
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.user.role,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      reason: "POS role attempted access to non-POS route",
    });
    return res.status(403).json({ message: "Access denied: This resource is not available for POS users" });
  }

  next();
}
