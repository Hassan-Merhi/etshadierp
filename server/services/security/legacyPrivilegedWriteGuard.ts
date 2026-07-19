import type { NextFunction, Request, Response } from "express";
import { db } from "../../db";
import {
  AuthorizationDeniedError,
  type AuthorizationActor,
  type AuthorizationDomain,
} from "./authorizationPolicy";
import {
  authorizePrivilegedOperation,
  PrivilegedOperationError,
  type PrivilegedOperationKind,
} from "./privilegedOperationPolicy";
import { hydrateSessionNamedPermissions } from "./namedPermissionService";
import { persistSecurityEvent } from "./securityAuditRuntime";

export interface LegacyPrivilegedWriteOptions {
  action: string;
  domain: AuthorizationDomain;
  kind: PrivilegedOperationKind;
  requiredPermission: string;
  sourceType: string;
  enforcement: "always" | "confirmed-only";
  sourceId?: (req: Request) => string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLegacyIdempotencyKey(value: unknown): string {
  const normalized = text(value);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(normalized) ? normalized : "";
}

export function shouldEnforceLegacyPrivilegedWrite(
  enforcement: LegacyPrivilegedWriteOptions["enforcement"],
  body: Record<string, unknown>
): boolean {
  return enforcement === "always" || body.confirm === true;
}

function actor(req: Request, permissions: string[]): AuthorizationActor | null {
  const companyId = req.session.currentCompanyId;
  const role = req.session.currentRole;
  const userId = req.session.userId;
  if (!companyId || !role || !userId) return null;
  return { userId, role, companyId, permissions };
}

async function audit(
  req: Request,
  options: LegacyPrivilegedWriteOptions,
  outcome: "allowed" | "denied",
  reasonCode: string,
  sourceId: string
): Promise<void> {
  await persistSecurityEvent(
    db,
    {
      kind: "privileged-operation",
      action: options.action,
      outcome,
      companyId: req.session.currentCompanyId ?? null,
      actorUserId: req.session.userId ?? null,
      targetType: options.sourceType,
      targetId: sourceId || null,
      reasonCode,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      metadata: {
        domain: options.domain,
        operationKind: options.kind,
        method: req.method,
        path: req.path,
      },
    },
    req.session.username || req.session.userId || "anonymous"
  );
}

/**
 * Adds Program 3 privileged-operation controls around legacy write routes that
 * already own a stronger domain-specific confirmation flow. For confirmed-only
 * routes, previews remain available; the actual confirmed apply is gated.
 */
export function requireLegacyPrivilegedWrite(options: LegacyPrivilegedWriteOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    if (!shouldEnforceLegacyPrivilegedWrite(options.enforcement, body)) return next();

    const sourceId = options.sourceId?.(req) || text(body.sourceId) || options.action;
    try {
      const permissions = await hydrateSessionNamedPermissions(db, req.session as any);
      authorizePrivilegedOperation({
        actor: actor(req, permissions),
        companyId: req.session.currentCompanyId as number,
        domain: options.domain,
        action: options.action,
        kind: options.kind,
        requiredPermission: options.requiredPermission,
        reason: text(body.reason),
        idempotencyKey: normalizeLegacyIdempotencyKey(body.idempotencyKey),
        sourceType: options.sourceType,
        sourceId,
        passwordConfirmedAt: (req.session as any).passwordConfirmedAt,
      });
      await audit(req, options, "allowed", "AUTHORIZED", sourceId);
      return next();
    } catch (error: any) {
      const denied = error instanceof PrivilegedOperationError || error instanceof AuthorizationDeniedError;
      if (!denied) return next(error);
      try {
        await audit(req, options, "denied", error.code || error.name || "DENIED", sourceId);
      } catch (auditError) {
        console.error("Security audit persistence failed:", auditError);
      }
      return res.status(403).json({ message: "Forbidden" });
    }
  };
}
