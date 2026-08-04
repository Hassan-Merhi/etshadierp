import type { RemoteMouseCommandType } from "./remoteControlCommandService";

const HIGH_RISK_ROUTE_PATTERNS = [
  /^\/settings(?:\/|$)/i,
  /^\/admin(?:\/|$)/i,
  /account-migration/i,
  /permission/i,
  /role-management/i,
  /password/i,
  /period-close/i,
  /closing-period/i,
  /payroll.*(?:approve|final|post)/i,
  /(?:offload|reverse-offload|container-reversal)/i,
];

export function isRemoteSupportHighRiskRoute(route: unknown): boolean {
  if (typeof route !== "string") return true;
  const normalized = route.trim().slice(0, 500);
  if (!normalized.startsWith("/")) return true;
  return HIGH_RISK_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isRemoteMouseCommandAllowedOnRoute(
  route: unknown,
  commandType: RemoteMouseCommandType
): boolean {
  if (!isRemoteSupportHighRiskRoute(route)) return true;
  return commandType === "pointer-move" || commandType === "scroll";
}

export function isRemoteKeyboardAllowedOnRoute(route: unknown): boolean {
  return !isRemoteSupportHighRiskRoute(route);
}
