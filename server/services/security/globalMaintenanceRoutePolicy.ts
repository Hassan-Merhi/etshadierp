export interface GlobalMaintenanceRouteMatch {
  operation:
    | "recalculate-equity-all"
    | "fix-unattributable-pos-data"
    | "cleanup-orphaned-charges"
    | "account-migration"
    | "deployment-diagnostics"
    | "runtime-schema-migration"
    | "schema-diagnostic"
    | "schema-fix"
    | "historical-po-intercompany-repair";
}

const EXACT_ROUTES: Array<{
  method: string;
  path: string;
  operation: GlobalMaintenanceRouteMatch["operation"];
}> = [
  {
    method: "POST",
    path: "/api/admin/recalculate-equity-adjustment-all",
    operation: "recalculate-equity-all",
  },
  {
    method: "POST",
    path: "/api/admin/fix-orphaned-pos-data",
    operation: "fix-unattributable-pos-data",
  },
  {
    method: "POST",
    path: "/api/cleanup/orphaned-charges",
    operation: "cleanup-orphaned-charges",
  },
  {
    method: "GET",
    path: "/api/admin/deployment-diagnostics",
    operation: "deployment-diagnostics",
  },
  {
    method: "POST",
    path: "/api/admin/apply-missing-migrations",
    operation: "runtime-schema-migration",
  },
  {
    method: "GET",
    path: "/api/admin/schema-check",
    operation: "schema-diagnostic",
  },
  {
    method: "POST",
    path: "/api/admin/schema-fix",
    operation: "schema-fix",
  },
  {
    method: "POST",
    path: "/api/fix-old-po-credits",
    operation: "historical-po-intercompany-repair",
  },
];

export function classifyGlobalMaintenanceRoute(
  method: string,
  path: string
): GlobalMaintenanceRouteMatch | null {
  const normalizedMethod = method.toUpperCase();

  if (
    ["GET", "POST"].includes(normalizedMethod) &&
    path.startsWith("/api/admin/account-migration/")
  ) {
    return { operation: "account-migration" };
  }

  const match = EXACT_ROUTES.find(
    (route) => route.method === normalizedMethod && route.path === path
  );
  return match ? { operation: match.operation } : null;
}
