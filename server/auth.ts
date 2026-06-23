import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { userLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getClientDate } from "./lib/dateUtils";

// Lightweight structured log for security-denied events. Fire-and-forget; never
// throws so it never interrupts the request that triggered it.
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

// Light authentication middleware — only requires a valid user session.
// Does NOT require a company to be selected. Use for personal-account actions
// such as changing one's own password.
export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

// Authentication middleware - checks if user is logged in.
// Uses ONLY session data — zero database calls — to avoid pool exhaustion
// under burst traffic. Role, location, and permission flags are written to
// the session at login and on every company-switch, so they are always fresh.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!req.session.currentCompanyId) {
    return res.status(401).json({ message: "No company selected" });
  }

  const role = req.session.currentRole;
  if (!role) {
    // Session is missing role — force re-login so it gets repopulated
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Build req.user from session cache — no DB round-trip needed
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

// Role-based authorization middleware
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

// Permission check for delete/void/archive operations.
// - Developer / Admin: always allowed.
// - Any role with canDeleteRecords === true: allowed.
// - Owner / POS: always blocked.
// - Manager without canDeleteRecords: blocked.
// - Normal User and unknown/future roles: blocked by default.
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

  // Any role with canDeleteRecords explicitly granted: allowed
  if (req.session.canDeleteRecords === true) {
    return next();
  }

  // Manager without the flag: blocked
  if (role === "Manager") {
    logDenied({ userId, username, role, companyId, method, path, reason: "Manager without canDeleteRecords flag" });
    return res.status(403).json({ message: "This manager account does not have delete permission" });
  }

  // Normal User, unknown/future roles — default deny
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

// Check if user can modify data from a specific date.
// - Admin / Developer: bypass all date restrictions.
// - POS: today only, always.
// - Manager / Owner: obey the daybookEditDays window.
//     0  → today only
//     N  → today or within N calendar days in the past
// - Normal User: no restrictions.
export function canModifyDate(dateField: string = "voucherDate") {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const role = req.user.role;

    // Admin and Developer bypass all date restrictions
    if (role === "Admin" || role === "Developer") {
      return next();
    }

    const recordDate: string | undefined = req.body[dateField];
    if (!recordDate) {
      return next();
    }

    const today = getClientDate(req);

    // POS: today only, no exceptions
    if (role === "POS") {
      if (recordDate !== today) {
        return res.status(403).json({
          message: "You can only create or modify records for today's date",
        });
      }
      return next();
    }

    // Manager and Owner: respect daybookEditDays window
    if (role === "Manager" || role === "Owner") {
      if (recordDate === today) return next();

      const editDays = req.session.daybookEditDays ?? 0;
      if (editDays === 0) {
        return res.status(403).json({
          message: "You can only create or modify records for today's date",
        });
      }

      // Allow records within editDays calendar days in the past
      const todayMs = new Date(today).getTime();
      const recordMs = new Date(recordDate).getTime();
      const diffDays = Math.floor((todayMs - recordMs) / 86_400_000);

      if (diffDays < 0 || diffDays > editDays) {
        return res.status(403).json({
          message: `You can only modify records within ${editDays} day(s) of today`,
        });
      }
      return next();
    }

    // Normal User: no date restrictions
    next();
  };
}

// Check if POS user can access a specific location
export async function checkPOSLocation(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const isPOS = req.user.role === "POS";
  if (!isPOS) {
    return next();
  }

  const locationId = parseInt(req.params.locationId || req.body.locationId || req.query.locationId);

  if (!locationId) {
    return next();
  }

  const companyId = req.session.currentCompanyId;
  if (!companyId) {
    return res.status(403).json({ message: "No company selected" });
  }

  const assignedLocations = await db
    .select({ locationId: userLocations.locationId })
    .from(userLocations)
    .where(and(eq(userLocations.userId, req.user.id), eq(userLocations.companyId, companyId)));

  const allowedIds = assignedLocations.map((l) => l.locationId);

  if (!allowedIds.includes(locationId)) {
    return res.status(403).json({
      message: "You can only access data for your assigned locations",
    });
  }

  next();
}

// ── Password re-confirmation gate ─────────────────────────────────────────────
// Routes protected by this middleware require the user to have successfully
// called POST /api/auth/confirm-password within the last 5 minutes.
// The frontend should show a ConfirmPasswordDialog before calling such routes.
export function requirePasswordConfirmation(req: Request, res: Response, next: NextFunction) {
  const confirmedAt = (req.session as any).passwordConfirmedAt as number | undefined;
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  if (!confirmedAt || Date.now() - confirmedAt > FIVE_MINUTES_MS) {
    logDenied({
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      reason: "Password confirmation required (expired or missing)",
    });
    return res.status(403).json({ message: "Password confirmation required" });
  }
  next();
}

// Block all write (mutation) operations for the View Only role.
// GET / HEAD / OPTIONS pass through. Every other method is rejected with 403.
// Applied globally so no individual route needs to remember to add it.
export function blockViewOnlyWrites(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!req.path.startsWith("/api")) return next();
  // Auth routes (login, logout, switch-company, confirm-password) must always
  // be reachable — even for View Only sessions — so View Only users can log in,
  // log out, and switch companies.
  if (req.path.startsWith("/api/auth/")) return next();

  // Read role from session (available before requireAuth populates req.user)
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

// Block POS users from accessing sensitive routes
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
    return res.status(403).json({
      message: "Access denied: This resource is not available for POS users",
    });
  }

  next();
}
