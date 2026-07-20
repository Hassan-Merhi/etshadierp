import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { storedFiles } from "@shared/schema";
import { db } from "../../db";
import { hydrateSessionNamedPermissions } from "./namedPermissionService";
import {
  ProtectedAssetAccessError,
  authorizeProtectedAssetAccess,
  type ProtectedAssetLookup,
  type ProtectedAssetRecord,
} from "./protectedAssetAccessPolicy";
import { AuthorizationDeniedError, type AuthorizationActor } from "./authorizationPolicy";
import { persistSecurityEvent } from "./securityAuditRuntime";

const STORED_FILE_PERMISSION = "files.download";

type StoredFileAsset = ProtectedAssetRecord & { fileData: string; fileType: string | null };

function actorFromRequest(req: Request, permissions: string[]): AuthorizationActor | null {
  const companyId = req.session.currentCompanyId;
  const role = req.session.currentRole;
  const userId = req.session.userId;
  if (!companyId || !role || !userId) return null;
  return { userId, role, companyId, permissions };
}

async function audit(
  req: Request,
  action: "read" | "download",
  outcome: "allowed" | "denied",
  reasonCode: string,
  assetId: string
) {
  await persistSecurityEvent(
    db,
    {
      kind: "protected-asset",
      action: action === "read" ? "asset.uploaded-file.read" : "asset.uploaded-file.download",
      outcome,
      companyId: req.session.currentCompanyId ?? null,
      actorUserId: req.session.userId ?? null,
      targetType: "stored-file",
      targetId: assetId,
      reasonCode,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      metadata: { method: req.method, path: req.originalUrl || req.url },
    },
    req.session.username || req.session.userId || "anonymous"
  );
}

/**
 * Authorizes legacy /api/files/:id/download and /preview routes before their
 * existing company-scoped handlers run. The legacy handler still owns byte
 * streaming; this adapter supplies canonical asset integrity, company scope,
 * named permission, and persistent security decisions.
 */
export function requireStoredFileAccess(action: "read" | "download") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const assetId = String(req.params.id ?? "");
    try {
      const permissions = await hydrateSessionNamedPermissions(db, req.session as any);
      const lookup: ProtectedAssetLookup = {
        async loadAsset(id, kind) {
          if (kind !== "uploaded-file") return null;
          const numericId = Number(id);
          if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
          const [file] = await db
            .select({
              id: storedFiles.id,
              companyId: storedFiles.companyId,
              uploadedBy: storedFiles.uploadedBy,
              fileName: storedFiles.fileName,
              displayName: storedFiles.displayName,
              fileType: storedFiles.fileType,
              fileSize: storedFiles.fileSize,
              fileData: storedFiles.fileData,
            })
            .from(storedFiles)
            .where(eq(storedFiles.id, numericId))
            .limit(1);
          if (!file) return null;
          return {
            id: file.id,
            kind: "uploaded-file",
            companyId: file.companyId,
            ownerUserId: file.uploadedBy,
            storageKey: `stored-files/${file.id}`,
            fileName: file.displayName || file.fileName,
            mimeType: file.fileType,
            byteSize: file.fileSize,
            deletedAt: null,
            fileData: file.fileData,
            fileType: file.fileType,
          } as StoredFileAsset;
        },
      };

      await authorizeProtectedAssetAccess(lookup, {
        actor: actorFromRequest(req, permissions),
        assetId,
        kind: "uploaded-file",
        action,
        domain: "reporting",
        requiredPermission: STORED_FILE_PERMISSION,
        allowedRoles: [],
        allowOwnerAccess: true,
      });
      await audit(req, action, "allowed", "AUTHORIZED", assetId);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      return next();
    } catch (error: any) {
      const denied = error instanceof AuthorizationDeniedError || error instanceof ProtectedAssetAccessError;
      if (!denied) return next(error);
      try {
        await audit(req, action, "denied", error.code || error.name || "DENIED", assetId);
      } catch (auditError) {
        console.error("Security audit persistence failed:", auditError);
      }
      return res.status(404).json({ message: "Not found" });
    }
  };
}
