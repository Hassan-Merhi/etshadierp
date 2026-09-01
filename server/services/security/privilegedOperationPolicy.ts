import {
  AuthorizationDeniedError,
  assertAuthorized,
  type AuthorizationActor,
  type AuthorizationDomain,
} from "./authorizationPolicy";

export const PRIVILEGED_OPERATION_KINDS = [
  "repair",
  "recalculate",
  "migration",
  "destructive",
  "credential-reset",
  "permission-change",
  "company-configuration",
  "diagnostic-write",
] as const;

export type PrivilegedOperationKind = (typeof PRIVILEGED_OPERATION_KINDS)[number];

export interface PrivilegedOperationRequest {
  actor: AuthorizationActor | null | undefined;
  companyId: number;
  domain: AuthorizationDomain;
  action: string;
  kind: PrivilegedOperationKind;
  requiredPermission: string;
  reason: string;
  confirmationToken?: string | null;
  expectedConfirmationToken?: string | null;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  passwordConfirmedAt?: number | null;
  now?: number;
  passwordConfirmationMaxAgeMs?: number;
}

export interface PrivilegedOperationDecision {
  authorized: true;
  normalizedReason: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
}

export class PrivilegedOperationError extends Error {
  readonly code:
    | "PRIVILEGED_REASON_REQUIRED"
    | "PRIVILEGED_IDEMPOTENCY_REQUIRED"
    | "PRIVILEGED_SOURCE_REQUIRED"
    | "PRIVILEGED_CONFIRMATION_REQUIRED"
    | "PRIVILEGED_PASSWORD_CONFIRMATION_REQUIRED";

  constructor(code: PrivilegedOperationError["code"]) {
    super("Forbidden");
    this.name = "PrivilegedOperationError";
    this.code = code;
  }
}

function required(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timingSafeTextEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

/**
 * Canonical fail-closed gate for repair, recalculation, migration, destructive,
 * credential, permission, configuration, and diagnostic write operations.
 *
 * This is intentionally pure. The caller must execute the operation and append
 * its audit record inside the same transaction after this gate succeeds.
 */
export function authorizePrivilegedOperation(
  request: PrivilegedOperationRequest
): PrivilegedOperationDecision {
  const reason = required(request.reason);
  if (!reason) throw new PrivilegedOperationError("PRIVILEGED_REASON_REQUIRED");

  const idempotencyKey = required(request.idempotencyKey);
  if (!idempotencyKey) {
    throw new PrivilegedOperationError("PRIVILEGED_IDEMPOTENCY_REQUIRED");
  }

  const sourceType = required(request.sourceType);
  const sourceId = required(request.sourceId);
  if (!sourceType || !sourceId) {
    throw new PrivilegedOperationError("PRIVILEGED_SOURCE_REQUIRED");
  }

  if (
    !Number.isInteger(request.companyId) ||
    request.companyId <= 0 ||
    request.actor?.companyId !== request.companyId
  ) {
    throw new AuthorizationDeniedError({
      effect: "deny",
      code: "CROSS_COMPANY_ACCESS_DENIED",
    });
  }

  const requiredPermission = required(request.requiredPermission);
  if (!requiredPermission) {
    throw new AuthorizationDeniedError({ effect: "deny", code: "POLICY_NOT_DEFINED" });
  }

  assertAuthorized({
    actor: request.actor,
    domain: request.domain,
    action: request.action,
    resource: { companyId: request.companyId },
    allowedRoles: ["Admin", "Developer"],
  });

  // Privileged roles bypass ordinary permission checks in the general policy,
  // but privileged operations intentionally require the exact named permission.
  const grantedPermissions = new Set(request.actor?.permissions ?? []);
  if (!grantedPermissions.has(requiredPermission)) {
    throw new AuthorizationDeniedError({ effect: "deny", code: "PERMISSION_REQUIRED" });
  }

  const expectedToken = required(request.expectedConfirmationToken);
  if (expectedToken) {
    const suppliedToken = required(request.confirmationToken);
    if (!suppliedToken || !timingSafeTextEquals(suppliedToken, expectedToken)) {
      throw new PrivilegedOperationError("PRIVILEGED_CONFIRMATION_REQUIRED");
    }
  }

  const maxAge = request.passwordConfirmationMaxAgeMs ?? 5 * 60 * 1000;
  const now = request.now ?? Date.now();
  if (
    request.passwordConfirmedAt == null ||
    !Number.isFinite(request.passwordConfirmedAt) ||
    request.passwordConfirmedAt > now ||
    now - request.passwordConfirmedAt > maxAge
  ) {
    throw new PrivilegedOperationError(
      "PRIVILEGED_PASSWORD_CONFIRMATION_REQUIRED"
    );
  }

  return {
    authorized: true,
    normalizedReason: reason,
    idempotencyKey,
    sourceType,
    sourceId,
  };
}
