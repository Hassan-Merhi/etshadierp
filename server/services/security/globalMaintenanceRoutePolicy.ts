export interface GlobalMaintenanceRouteMatch {
  operation:
    | "recalculate-equity-all"
    | "fix-unattributable-pos-data"
    | "cleanup-orphaned-charges";
}

const ROUTES: Array<{ method: string; path: string; operation: GlobalMaintenanceRouteMatch["operation"] }> = [
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
];

export function classifyGlobalMaintenanceRoute(
  method: string,
  path: string
): GlobalMaintenanceRouteMatch | null {
  const normalizedMethod = method.toUpperCase();
  const match = ROUTES.find(
    (route) => route.method === normalizedMethod && route.path === path
  );
  return match ? { operation: match.operation } : null;
}
