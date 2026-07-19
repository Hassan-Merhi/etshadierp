import { AuthorizationDeniedError, assertAuthorized, type AuthorizationActor, type AuthorizationDomain } from "./authorizationPolicy";

export type CompanyScopedResourceType =
  | "voucher"
  | "ledger-account"
  | "bank-account"
  | "customer"
  | "supplier"
  | "stock-item"
  | "stock-location"
  | "factory-supplier"
  | "factory-container"
  | "report"
  | "export"
  | "attachment";

export interface CompanyScopedResourceIdentity {
  type: CompanyScopedResourceType;
  id: string | number;
  companyId: number;
}

export interface CompanyIsolationLookupAdapter {
  loadResourceCompany(input: {
    tx: unknown;
    resourceType: CompanyScopedResourceType;
    resourceId: string | number;
  }): Promise<number | null>;
}

export interface CompanyIsolationRequest {
  tx: unknown;
  actor: AuthorizationActor | null | undefined;
  domain: AuthorizationDomain;
  action: string;
  resourceType: CompanyScopedResourceType;
  resourceId: string | number;
  allowedRoles?: readonly string[];
  requiredPermissions?: readonly string[];
}

export class CompanyIsolationError extends Error {
  readonly code:
    | "RESOURCE_ID_INVALID"
    | "RESOURCE_NOT_FOUND"
    | "RESOURCE_COMPANY_INVALID"
    | "CROSS_COMPANY_ACCESS_DENIED";

  constructor(code: CompanyIsolationError["code"]) {
    super(code === "RESOURCE_NOT_FOUND" ? "Not found" : "Forbidden");
    this.name = "CompanyIsolationError";
    this.code = code;
  }
}

function isValidResourceId(value: string | number): boolean {
  if (typeof value === "number") return Number.isInteger(value) && value > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCompanyId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Loads company ownership from canonical storage instead of trusting a caller-
 * supplied companyId, then delegates the final decision to the central policy.
 */
export async function authorizeCompanyScopedResourceTx(
  request: CompanyIsolationRequest,
  adapter: CompanyIsolationLookupAdapter
): Promise<CompanyScopedResourceIdentity> {
  if (!isValidResourceId(request.resourceId)) {
    throw new CompanyIsolationError("RESOURCE_ID_INVALID");
  }

  const companyId = await adapter.loadResourceCompany({
    tx: request.tx,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
  });

  if (companyId == null) {
    throw new CompanyIsolationError("RESOURCE_NOT_FOUND");
  }
  if (!isValidCompanyId(companyId)) {
    throw new CompanyIsolationError("RESOURCE_COMPANY_INVALID");
  }

  try {
    assertAuthorized({
      actor: request.actor,
      domain: request.domain,
      action: request.action,
      resource: { companyId },
      requireSameCompany: true,
      allowedRoles: request.allowedRoles,
      requiredPermissions: request.requiredPermissions,
    });
  } catch (error) {
    if (
      error instanceof AuthorizationDeniedError &&
      error.code === "CROSS_COMPANY_ACCESS_DENIED"
    ) {
      throw new CompanyIsolationError("CROSS_COMPANY_ACCESS_DENIED");
    }
    throw error;
  }

  return {
    type: request.resourceType,
    id: request.resourceId,
    companyId,
  };
}

export function assertRequestCompanyMatchesSession(
  actor: AuthorizationActor | null | undefined,
  requestedCompanyId: number
): void {
  if (!actor || !isValidCompanyId(actor.companyId) || !isValidCompanyId(requestedCompanyId)) {
    throw new CompanyIsolationError("RESOURCE_COMPANY_INVALID");
  }
  if (actor.companyId !== requestedCompanyId) {
    throw new CompanyIsolationError("CROSS_COMPANY_ACCESS_DENIED");
  }
}
