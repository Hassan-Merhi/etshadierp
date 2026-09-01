export const AUTHORIZATION_DOMAINS = [
  "accounting",
  "inventory",
  "factory",
  "administration",
  "reporting",
  "configuration",
] as const;

export type AuthorizationDomain = (typeof AUTHORIZATION_DOMAINS)[number];
export type AuthorizationEffect = "allow" | "deny";

export interface AuthorizationActor {
  userId: string | number;
  role: string;
  companyId: number;
  permissions?: readonly string[];
}

export interface AuthorizationResource {
  companyId?: number | null;
  ownerUserId?: string | number | null;
  attributes?: Readonly<Record<string, unknown>>;
}

export interface AuthorizationRequest {
  actor: AuthorizationActor | null | undefined;
  domain: AuthorizationDomain;
  action: string;
  resource?: AuthorizationResource;
  requireSameCompany?: boolean;
  requiredPermissions?: readonly string[];
  allowedRoles?: readonly string[];
}

export interface AuthorizationDecision {
  effect: AuthorizationEffect;
  code:
    | "AUTHENTICATION_REQUIRED"
    | "COMPANY_CONTEXT_INVALID"
    | "CROSS_COMPANY_ACCESS_DENIED"
    | "ROLE_NOT_ALLOWED"
    | "PERMISSION_REQUIRED"
    | "POLICY_NOT_DEFINED"
    | "AUTHORIZED";
}

export class AuthorizationDeniedError extends Error {
  readonly code: AuthorizationDecision["code"];

  constructor(decision: AuthorizationDecision) {
    super("Forbidden");
    this.name = "AuthorizationDeniedError";
    this.code = decision.code;
  }
}

const privilegedRoles = new Set(["Developer", "Admin"]);

function requiredText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Canonical, pure authorization decision boundary.
 *
 * Default deny is intentional: callers must provide at least one explicit
 * role or permission policy. Company isolation runs before role/permission
 * evaluation so privileged roles cannot accidentally bypass tenant scope.
 */
export function decideAuthorization(request: AuthorizationRequest): AuthorizationDecision {
  const actor = request.actor;
  if (!actor) return { effect: "deny", code: "AUTHENTICATION_REQUIRED" };

  if (!Number.isInteger(actor.companyId) || actor.companyId <= 0) {
    return { effect: "deny", code: "COMPANY_CONTEXT_INVALID" };
  }

  if (!requiredText(request.action)) {
    return { effect: "deny", code: "POLICY_NOT_DEFINED" };
  }

  const requireSameCompany = request.requireSameCompany !== false;
  const resourceCompanyId = request.resource?.companyId;
  if (
    requireSameCompany &&
    resourceCompanyId != null &&
    (!Number.isInteger(resourceCompanyId) || resourceCompanyId <= 0 || resourceCompanyId !== actor.companyId)
  ) {
    return { effect: "deny", code: "CROSS_COMPANY_ACCESS_DENIED" };
  }

  const roles = request.allowedRoles ?? [];
  const permissions = request.requiredPermissions ?? [];
  if (roles.length === 0 && permissions.length === 0) {
    return { effect: "deny", code: "POLICY_NOT_DEFINED" };
  }

  const roleAllowed = privilegedRoles.has(actor.role) || roles.includes(actor.role);
  if (roles.length > 0 && !roleAllowed) {
    return { effect: "deny", code: "ROLE_NOT_ALLOWED" };
  }

  if (!privilegedRoles.has(actor.role) && permissions.length > 0) {
    const granted = new Set(actor.permissions ?? []);
    if (!permissions.every((permission) => granted.has(permission))) {
      return { effect: "deny", code: "PERMISSION_REQUIRED" };
    }
  }

  return { effect: "allow", code: "AUTHORIZED" };
}

export function assertAuthorized(request: AuthorizationRequest): void {
  const decision = decideAuthorization(request);
  if (decision.effect === "deny") throw new AuthorizationDeniedError(decision);
}
