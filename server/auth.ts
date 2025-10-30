import { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";

// Authentication middleware - checks if user is logged in via Replit Auth and has company access
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // First check Replit Auth
  const authResult = await new Promise<boolean>((resolve) => {
    isAuthenticated(req, res, () => resolve(true));
    res.on('finish', () => resolve(false));
  });

  if (!authResult) {
    return; // isAuthenticated already sent the 401 response
  }

  // Get user ID from Replit Auth claims
  const userId = (req.user as any)?.claims?.sub;
  if (!userId) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const user = await storage.getUser(userId);
  if (!user) {
    return res.status(401).json({ message: "User not found" });
  }

  // Check if a company is selected
  if (!req.session.currentCompanyId) {
    return res.status(401).json({ message: "No company selected" });
  }

  // Load the user's role for the current company
  const userCompanyRole = await storage.getUserCompanyRole(userId, req.session.currentCompanyId);
  if (!userCompanyRole) {
    return res.status(403).json({ message: "You do not have access to this company" });
  }

  // Attach user with company-specific role and location info
  req.user = {
    ...user,
    role: userCompanyRole.role,
    assignedLocationId: userCompanyRole.assignedLocationId,
    posStation: userCompanyRole.posStation,
  };

  next();
}

// Role-based authorization middleware
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    next();
  };
}

// Permission check for delete operations (Owner can't delete)
export function canDelete(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role === "Owner") {
    return res.status(403).json({ message: "Owners cannot delete records" });
  }

  next();
}

// Check if user can modify data from a specific date
export function canModifyDate(dateField: string = "voucherDate") {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Admin and Owner can modify any date
    if (req.user.role === "Admin" || req.user.role === "Owner") {
      return next();
    }

    // Manager and POS users can only modify today's date
    const isPOS = req.user.role.startsWith("POS");
    if (req.user.role === "Manager" || isPOS) {
      const today = new Date().toISOString().split('T')[0];
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
export function checkPOSLocation(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const isPOS = req.user.role.startsWith("POS");
  if (!isPOS) {
    return next(); // Non-POS users can access all locations
  }

  // POS users can only access their assigned location
  const locationId = parseInt(req.params.locationId || req.body.locationId || req.query.locationId);
  
  if (locationId && req.user.assignedLocationId !== locationId) {
    return res.status(403).json({ 
      message: "You can only access data for your assigned location" 
    });
  }

  next();
}
