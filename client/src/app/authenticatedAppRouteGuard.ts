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
  { kind: "continue" } | { kind: "loading" } | { kind: "empty" } | { kind: "redirect"; to: string };

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
  const hasErpAccess = !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = !myAccess || myAccess.hasFactoryAccess;
  const factoryDefaultPage = computeFactoryDefaultPage(myAccess);

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
    decision = { kind: "redirect", to: "/sp/setup?tab=migration" };
  } else if (isSupplierPartnerCompany && isSupplierPartnerRoute && !SUPPLIER_PARTNER_PATHS.has(currentLocation)) {
    decision = { kind: "redirect", to: "/sp" };
  } else if (
    isFactoryCompany &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    if (myAccessLoading) decision = { kind: "loading" };
    else if (myAccess === undefined && !myAccessError) decision = { kind: "empty" };
    else decision = { kind: "redirect", to: factoryDefaultPage };
  } else if (isFactoryRoute && !hasFactoryAccess) {
    decision = { kind: "redirect", to: "/" };
  } else if (
    !isFactoryCompany &&
    !hasErpAccess &&
    hasFactoryAccess &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    decision = { kind: "redirect", to: factoryDefaultPage };
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
    } else if (isFactoryRoute && !isFactoryCompany) {
      // Switch away from /factory/* immediately when the company is not a factory
      // type — don't wait for myAccess to finish loading. The company type alone
      // is enough to know these routes don't apply.
      decision = { kind: "redirect", to: "/" };
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
