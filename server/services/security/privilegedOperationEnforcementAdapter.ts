import type { NextFunction, Request, Response } from "express";
import { db } from "../../db";
import {
  AuthorizationDeniedError,
  type AuthorizationActor,
} from "./authorizationPolicy";
import {
  PrivilegedOperationError,
  authorizePrivilegedOperation,
  type PrivilegedOperationKind,
} from "./privilegedOperationPolicy";
import { persistSecurityEvent } from "./securityAuditRuntime";

export interface PrivilegedRouteOptions {
  domain: "administration" | "accounting" | "inventory" | "factory" | "reporting";
  action: string;
  kind: PrivilegedOperationKind;
  requiredPermission: string;
  sourceType: string;
  expectedConfirmationToken: (companyId: number) => string;
  allowDryRun?: boolean;
}

type SecuritySession = Request["session"] & {
  securityPermissions?: string[];
  passwordConfirmedAt?: number;
  username?: string;
  currentUsername?: string;
};

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function actorFromRequest(req: Request, permission: string): AuthorizationActor | null {
  const session = req.session as SecuritySession;
  const companyId = session.currentCompanyId;
  const role = session.currentRole;
  const userId = session.userId;
  if (!companyId || !role || !userId) return null;

  const explicit = Array.isArray(session.securityPermissions)
    ? session.securityPermissions.filter((item): item is string => typeof item === "string")
    : [];

  // Compatibility bridge: existing Admin/Developer sessions do not yet persist
  // named security permissions. Preserve their current route access while still
  // presenting the exact route permission to the fail-closed Program 3 policy.
  const permissions =
    explicit.length > 0
      ? explicit
      : ["Admin", "Developer"].includes(role)
        ? [permission]
        : [];

  return {
    userId,
    role,
    companyId,
    permissions,
  };
}

function auditUsername(req: Request): string {
  const session = req.session as SecuritySession;
  return session.currentUsername || session.username || String(session.userId || "anonymous");
}

async function recordPrivilegedDecision(
  req: Request,
  options: PrivilegedRouteOptions,
  outcome: "allowed" | "denied",
  reasonCode: string
) {
  const session = req.session as SecuritySession;
  await persistSecurityEvent(
    db,
    {
      kind: "privileged-operation",
      action: options.action,
      outcome,
      companyId: session.currentCompanyId ?? null,
      actorUserId: session.userId ?? null,
      targetType: options.sourceType,
      targetId: normalizedText((req.body as any)?.sourceId) || null,
      reasonCode,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      metadata: {
        domain: options.domain,
        operationKind: options.kind,
        role: session.currentRole ?? null,
        method: req.method,
        path: req.path,
      },
    },
    auditUsername(req)
  );
}

/**
 * Express adapter for destructive repair/recalculation/admin mutations.
 * Dry-runs may pass through when explicitly allowed; applying changes requires
 * a reason, deterministic idempotency key, exact confirmation token, source
 * identity, same-company context, exact permission, and recent password proof.
 * Applied attempts are persisted before route logic can mutate data.
 */
export function requirePrivilegedOperation(options: PrivilegedRouteOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (options.allowDryRun && (body as any).dryRun !== false) return next();

    const companyId = req.session.currentCompanyId;
    if (!companyId) {
      try {
        await recordPrivilegedDecision(req, options, "denied", "COMPANY_CONTEXT_REQUIRED");
      } catch (auditError) {
        console.error("Security audit persistence failed:", auditError);
      }
      return res.status(403).json({ message: "Forbidden" });
    }

    try {
      authorizePrivilegedOperation({
        actor: actorFromRequest(req, options.requiredPermission),
        companyId,
        domain: options.domain,
        action: options.action,
        kind: options.kind,
        requiredPermission: options.requiredPermission,
        reason: normalizedText((body as any).reason),
        confirmationToken: normalizedText((body as any).confirmationToken),
        expectedConfirmationToken: options.expectedConfirmationToken(companyId),
        idempotencyKey: normalizedText((body as any).idempotencyKey),
        sourceType: options.sourceType,
        sourceId: normalizedText((body as any).sourceId),
        passwordConfirmedAt: (req.session as SecuritySession).passwordConfirmedAt,
      });
      await recordPrivilegedDecision(req, options, "allowed", "AUTHORIZED");
      return next();
    } catch (error: any) {
      if (error instanceof PrivilegedOperationError || error instanceof AuthorizationDeniedError) {
        try {
          await recordPrivilegedDecision(req, options, "denied", error.code || error.name || "DENIED");
        } catch (auditError) {
          console.error("Security audit persistence failed:", auditError);
        }
        return res.status(403).json({ message: "Forbidden" });
      }
      return next(error);
    }
  };
}
