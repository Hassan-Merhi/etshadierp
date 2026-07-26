import type { AuthorizationDomain } from "./authorizationPolicy";
import type { CompanyScopedResourceType } from "./companyIsolationPolicy";

export interface CompanyOwnedRouteMatch {
  resourceType: CompanyScopedResourceType;
  resourceId: number;
  domain: AuthorizationDomain;
}

const ROUTES: Array<{
  pattern: RegExp;
  resourceType: CompanyScopedResourceType;
  domain: AuthorizationDomain;
}> = [
  { pattern: /^\/api\/vouchers\/(\d+)(?:\/|$)/, resourceType: "voucher", domain: "accounting" },
  { pattern: /^\/api\/voucher-detail\/(\d+)(?:\/|$)/, resourceType: "voucher", domain: "accounting" },
  { pattern: /^\/api\/ledger-accounts\/(\d+)(?:\/|$)/, resourceType: "ledger-account", domain: "accounting" },
  { pattern: /^\/api\/bank-accounts\/(\d+)(?:\/|$)/, resourceType: "bank-account", domain: "accounting" },
  { pattern: /^\/api\/fixed-assets\/(\d+)(?:\/|$)/, resourceType: "fixed-asset", domain: "accounting" },
  { pattern: /^\/api\/customers\/(\d+)(?:\/|$)/, resourceType: "customer", domain: "accounting" },
  { pattern: /^\/api\/employees\/(\d+)(?:\/|$)/, resourceType: "employee", domain: "administration" },
  { pattern: /^\/api\/stock-items\/(\d+)(?:\/|$)/, resourceType: "stock-item", domain: "inventory" },
  { pattern: /^\/api\/locations\/(\d+)(?:\/|$)/, resourceType: "stock-location", domain: "inventory" },
  { pattern: /^\/api\/containers\/(\d+)(?:\/|$)/, resourceType: "container", domain: "inventory" },
  { pattern: /^\/api\/factory\/containers\/(\d+)(?:\/|$)/, resourceType: "factory-container", domain: "factory" },
];

export function classifyCompanyOwnedRoute(path: string): CompanyOwnedRouteMatch | null {
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;

    const resourceId = Number(match[1]);
    if (!Number.isSafeInteger(resourceId) || resourceId <= 0) return null;

    return {
      resourceType: route.resourceType,
      resourceId,
      domain: route.domain,
    };
  }

  return null;
}
