import { computeFactoryDefaultPage, computeFactoryGuardRedirect } from "./factoryAccessGuard";
import type { FactoryAccess } from "./useAuthenticatedAppData";

const SUPPLIER_PARTNER_PATHS = new Set([
  "/sp",
  "/sp/golden-coast",
  "/sp/reports",
  "/sp/opening-stock",
  "/sp/aliases",
  "/sp/setup",
  "/sp/migration",
  "/sp/gc-migration",
]);

export type AuthenticatedAppRouteDecision =
  | { kind: "continue" }
  | { kind: "loading" }
  | { kind: "bootstrap-error" }
  | { kind: "redirect"; to: string };

interface ResolveAuthenticatedAppRouteOptions {
  currentLocation: string;
  companyType?: string | null;
  isAdminOwner: boolean;
  myAccess?: FactoryAccess;
  myAccessLoading: boolean;
  myAccessError: boolean;
  factorySettings?: Record<string, unknown>;
}

export function resolveAuthenticatedAppRoute({
  currentLocation,
  companyType,
  isAdminOwner,
  myAccess,
  myAccessLoading,
  myAccessError,
  factorySettings,
}: ResolveAuthenticatedAppRouteOptions) {
  const isPropertiesCompany = companyType === "properties";
  const isPropertiesRoute = currentLocation.startsWith("/properties/");
  const isSupplierPartnerCompany = companyType === "supplier_partner";
  const isSupplierPartnerRoute = currentLocation === "/sp" || currentLocation.startsWith("/sp/");
  const isFactoryCompany = companyType === "factory" || companyType === "factory_v2";
  const isFactoryRoute = currentLocation.startsWith("/factory/");
  const hasErpAccess = !isFactoryCompany || !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = isFactoryCompany && (!myAccess || myAccess.hasFactoryAccess);
  const factoryDefaultPage = computeFactoryDefaultPage(myAccess);
  const isFactoryBootstrapRoute =
    isFactoryCompany &&
    (isFactoryRoute || (currentLocation !== "/my-settings" && currentLocation !== "/intercompany-requests"));

  let decision: AuthenticatedAppRouteDecision = { kind: "continue" };

  if (isPropertiesCompany && currentLocation === "/my-settings") {
    decision = { kind: "redirect", to: "/properties/my-settings" };
  } else if (isPropertiesCompany && currentLocation === "/balance-repair") {
    decision = { kind: "redirect", to: "/properties/balance-repair" };
  } else if (isPropertiesCompany && !isPropertiesRoute) {
    decision = { kind: "redirect", to: "/properties/daybook" };
  } else if (isPropertiesRoute && !isPropertiesCompany) {
    decision = { kind: "redirect", to: "/" };
  } else if (isSupplierPartnerRoute && !isSupplierPartnerCompany) {
    decision = { kind: "redirect", to: "/tracking" };
  } else if (
    isSupplierPartnerCompany &&
    (currentLocation === "/sp/migration" || currentLocation === "/sp/gc-migration")
  ) {
    decision = { kind: "redirect", to: "/sp/setup" };
  } else if (isSupplierPartnerCompany && isSupplierPartnerRoute && !SUPPLIER_PARTNER_PATHS.has(currentLocation)) {
    decision = { kind: "redirect", to: "/sp" };
  } else if (isFactoryRoute && !isFactoryCompany) {
    // Factory-only bootstrap data must never gate an ERP/non-Factory company.
    // The company type alone is enough to reject a stale /factory/* route.
    decision = { kind: "redirect", to: "/" };
  } else if (isFactoryBootstrapRoute && myAccessLoading) {
    decision = { kind: "loading" };
  } else if (isFactoryBootstrapRoute && myAccess === undefined && !myAccessError) {
    decision = { kind: "loading" };
  } else if (isFactoryBootstrapRoute && myAccessError) {
    // React Query has exhausted its configured retries. Only now surface the
    // recovery state; transient and not-yet-loaded states stay as loading.
    decision = { kind: "bootstrap-error" };
  } else if (
    isFactoryCompany &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    decision = { kind: "redirect", to: factoryDefaultPage };
  } else if (isFactoryRoute && !hasFactoryAccess) {
    decision = { kind: "redirect", to: "/" };
  } else {
    const factoryGuardRedirect = computeFactoryGuardRedirect({
      isFactoryRoute,
      isAdminOwner,
      myAccess,
      factorySettings,
      factoryDefaultPage,
      currentLocation,
    });
    if (factoryGuardRedirect) {
      decision = { kind: "redirect", to: factoryGuardRedirect };
    }
  }

  return {
    decision,
    isPropertiesCompany,
    isPropertiesRoute,
    isFactoryCompany,
    isFactoryRoute,
    hasErpAccess,
    factoryDefaultPage,
  };
}
