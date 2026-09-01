export interface UserLocationConfigurationRoute {
  kind: "locations" | "cash-accounts";
  userId: string;
  companyId: number;
}

export function classifyUserLocationConfigurationRoute(
  path: string
): UserLocationConfigurationRoute | null {
  const match = path.match(
    /^\/api\/(user-locations|user-location-cash-accounts)\/([^/]+)\/(\d+)$/
  );
  if (!match) return null;

  const companyId = Number(match[3]);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return null;

  const userId = decodeURIComponent(match[2]);
  if (!userId) return null;

  return {
    kind: match[1] === "user-locations" ? "locations" : "cash-accounts",
    userId,
    companyId,
  };
}
