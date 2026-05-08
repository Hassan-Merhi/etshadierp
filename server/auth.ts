import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { userLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getClientDate } from "./lib/dateUtils";

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
    daybookEditDays: req.session.daybookEditDays ?? 0,
    canAccessCustomers: req.session.canAccessCustomers ?? false,
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

// Permission check for delete operations.
// - Owner: cannot delete (read-only oversight role)
// - POS: cannot delete (sales-entry only role)
// All other roles pass through (Manager, Normal User, Admin, Developer).
export function canDelete(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role === "Owner") {
    return res.status(403).json({ message: "Owners cannot delete records" });
  }

  if (req.user.role === "POS") {
    return res.status(403).json({ message: "POS users cannot delete records" });
  }

  next();
}

// Check if user can modify data from a specific date
export function canModifyDate(dateField: string = "voucherDate") {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Admin, Owner, and Developer can modify any date
    if (req.user.role === "Admin" || req.user.role === "Owner" || req.user.role === "Developer") {
      return next();
    }

    // Manager and POS users can only modify today's date
    const isPOS = req.user.role === "POS";
    if (req.user.role === "Manager" || isPOS) {
      const today = getClientDate(req);
      const recordDate = req.body[dateField];
      
      if (recordDate && recordDate !== today) {
        return res.status(403).json({ 
          message: "You can only create or modify records for today's date" 
        });
      }
    }

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
    .where(
      and(
        eq(userLocations.userId, req.user.id),
        eq(userLocations.companyId, companyId)
      )
    );

  const allowedIds = assignedLocations.map(l => l.locationId);

  if (!allowedIds.includes(locationId)) {
    return res.status(403).json({ 
      message: "You can only access data for your assigned locations" 
    });
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
    return res.status(403).json({ 
      message: "Access denied: This resource is not available for POS users" 
    });
  }

  next();
}
