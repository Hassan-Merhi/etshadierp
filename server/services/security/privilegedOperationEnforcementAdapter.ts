import type { NextFunction, Request, Response } from "express";
import {
  AuthorizationDeniedError,
  type AuthorizationActor,
} from "./authorizationPolicy";
import {
  PrivilegedOperationError,
  authorizePrivilegedOperation,
  type PrivilegedOperationKind,
} from "./privilegedOperationPolicy";

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

/**
 * Express adapter for destructive repair/recalculation/admin mutations.
 * Dry-runs may pass through when explicitly allowed; applying changes requires
 * a reason, deterministic idempotency key, exact confirmation token, source
 * identity, same-company context, exact permission, and recent password proof.
 */
export function requirePrivilegedOperation(options: PrivilegedRouteOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (options.allowDryRun && body.dryRun !== false) return next();

    const companyId = req.session.currentCompanyId;
    if (!companyId) return res.status(403).json({ message: "Forbidden" });

    try {
      authorizePrivilegedOperation({
        actor: actorFromRequest(req, options.requiredPermission),
        companyId,
        domain: options.domain,
        action: options.action,
        kind: options.kind,
        requiredPermission: options.requiredPermission,
        reason: normalizedText(body.reason),
        confirmationToken: normalizedText(body.confirmationToken),
        expectedConfirmationToken: options.expectedConfirmationToken(companyId),
        idempotencyKey: normalizedText(body.idempotencyKey),
        sourceType: options.sourceType,
        sourceId: normalizedText(body.sourceId),
        passwordConfirmedAt: (req.session as SecuritySession).passwordConfirmedAt,
      });
      return next();
    } catch (error) {
      if (error instanceof PrivilegedOperationError || error instanceof AuthorizationDeniedError) {
        return res.status(403).json({ message: "Forbidden" });
      }
      return next(error);
    }
  };
}
