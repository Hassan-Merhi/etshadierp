import type { Express } from "express";
import { db, pool } from "../../db";
import { requireAuth, requireRole } from "../../auth";
import { persistSecurityEvent } from "../../services/security/securityAuditRuntime";
import {
  KNOWN_SECURITY_PERMISSIONS,
  invalidateUserCompanySessions,
  loadNamedPermissions,
  normalizePermissionList,
  replaceNamedPermissions,
} from "../../services/security/namedPermissionService";

function activeCompany(req: any): number | null {
  const value = req.session?.currentCompanyId;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function registerSecurityPermissionRoutes(app: Express) {
  app.get("/api/admin/security-permissions/catalog", requireAuth, requireRole("Admin", "Developer"), (_req, res) => {
    res.json({ permissions: KNOWN_SECURITY_PERMISSIONS });
  });

  app.get("/api/admin/users/:userId/security-permissions", requireAuth, requireRole("Admin", "Developer"), async (req, res) => {
    try {
      const companyId = activeCompany(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const permissions = await loadNamedPermissions(db, req.params.userId, companyId);
      res.json({ userId: req.params.userId, companyId, permissions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/users/:userId/security-permissions", requireAuth, requireRole("Admin", "Developer"), async (req, res) => {
    try {
      const companyId = activeCompany(req);
      const actorUserId = req.session.userId;
      if (!companyId || !actorUserId) return res.status(403).json({ message: "Forbidden" });
      const permissions = normalizePermissionList(req.body?.permissions);
      const saved = await db.transaction((tx: any) =>
        replaceNamedPermissions(tx, {
          userId: req.params.userId,
          companyId,
          permissions,
          grantedBy: actorUserId,
        })
      );
      await persistSecurityEvent(
        db,
        {
          kind: "authorization",
          action: "security.permissions.replace",
          outcome: "allowed",
          companyId,
          actorUserId,
          targetType: "user",
          targetId: req.params.userId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          metadata: { permissionCount: saved.length },
        },
        req.session.username || actorUserId
      );
      await invalidateUserCompanySessions(pool, req.params.userId, companyId);
      res.json({ userId: req.params.userId, companyId, permissions: saved });
    } catch (error: any) {
      if (error?.message === "Invalid permissions") return res.status(400).json({ message: "Invalid request" });
      if (error?.message === "User not found") return res.status(404).json({ message: "Not found" });
      res.status(500).json({ message: error.message });
    }
  });
}
