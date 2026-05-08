/**
 * Express middleware factory for route-level permission enforcement.
 *
 * Uses the same semantics as permissionHelpers.ts:
 *   Developer / Admin     → always allowed (never restricted via this system)
 *   Owner / Manager / POS → allowed by default; enabled=false in DB = restricted
 *   Normal User           → denied by default; enabled=true in DB = explicitly allowed
 *
 * Reads role/company from req.session directly so it works whether placed
 * before or after per-route requireAuth calls.
 * Silently passes (calls next()) if the session has no userId — the per-route
 * requireAuth will then return 401 as usual.
 *
 * Request-scoped cache (_permMap) avoids redundant DB queries when multiple
 * middleware are chained on the same request.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { buildPermissionMap, canAccess } from "./permissionHelpers";

// ─── Types ────────────────────────────────────────────────────────────────────

type PermMiddlewareType = "module" | "page" | "action" | "export";

// Augment Express Request to hold the per-request permission cache
declare module "express-serve-static-core" {
  interface Request {
    _permMap?: Map<string, boolean>;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Load (or return cached) permission map for the current user/company.
 * Falls back to an empty map on DB error so we fail-open rather than
 * breaking legitimate sessions.
 */
async function getPermMap(req: any): Promise<Map<string, boolean>> {
  if (req._permMap) return req._permMap as Map<string, boolean>;

  const role: string | undefined = req.session?.currentRole;
  const companyId: number | undefined = req.session?.currentCompanyId;

  if (!role || !companyId) {
    req._permMap = new Map<string, boolean>();
    return req._permMap;
  }

  try {
    const rows = await storage.getRoleFeaturePermissions(companyId);
    req._permMap = buildPermissionMap(rows, role);
  } catch (err) {
    console.error("[permissionMiddleware] Failed to load permissions:", err);
    req._permMap = new Map<string, boolean>();
  }

  return req._permMap;
}

/** Emit a structured access-denied log line and respond with 403. */
function sendDenied(req: any, res: Response, key: string, permType: PermMiddlewareType): void {
  const role     = req.session?.currentRole     ?? "unknown";
  const userId   = req.session?.userId          ?? null;
  const username = req.session?.username        ?? null;
  const companyId = req.session?.currentCompanyId ?? null;

  console.warn(
    JSON.stringify({
      event:     "access_denied",
      permType,
      key,
      role,
      userId,
      username,
      companyId,
      method:    req.method,
      path:      req.path,
      ip:        req.ip,
      ts:        new Date().toISOString(),
    })
  );

  res.status(403).json({
    message:  "Access denied: you do not have permission for this resource.",
    key,
    permType,
  });
}

// ─── Core factory ─────────────────────────────────────────────────────────────

/**
 * Generic permission middleware factory.
 *
 * Usage:
 *   app.use("/api/factory", requirePermission("mod_factory", "module"));
 *   app.post("/api/vouchers", requirePermission("act_create_voucher", "action"), handler);
 */
export function requirePermission(key: string, permType: PermMiddlewareType = "module") {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    // No session user → unauthenticated request; pass through so that
    // per-route requireAuth returns the correct 401.
    if (!req.session?.userId) {
      next();
      return;
    }

    try {
      const permMap = await getPermMap(req);
      const role: string = req.session?.currentRole ?? "";

      if (!canAccess(role, key, permMap)) {
        sendDenied(req, res, key, permType);
        return;
      }

      next();
    } catch (err) {
      // Fail-open: unexpected errors must not lock out legitimate users.
      console.error("[permissionMiddleware] Unexpected error for key", key, err);
      next();
    }
  };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Top-level module guard (e.g. "mod_factory", "mod_pos"). */
export function requireModuleAccess(moduleKey: string) {
  return requirePermission(moduleKey, "module");
}

/** Page/route guard (e.g. "page_dashboard"). */
export function requirePageAccess(pageKey: string) {
  return requirePermission(pageKey, "page");
}

/**
 * Action guard for write operations (e.g. "act_create_voucher").
 * Typically applied as an inline middleware on POST/PATCH/PUT/DELETE routes.
 */
export function requireActionAccess(actionKey: string) {
  return requirePermission(actionKey, "action");
}

/** Export / print guard (e.g. "exp_pdf", "exp_excel"). */
export function requireExportAccess(exportKey: string) {
  return requirePermission(exportKey, "export");
}
