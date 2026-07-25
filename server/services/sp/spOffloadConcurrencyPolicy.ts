export interface SpOffloadLockScope {
  companyId: number;
  containerId: number;
}

export interface SpOffloadReplayFingerprint {
  offloadDate: string;
  locationId: number;
  totalLandedCostUsd: number;
}

export function buildSpOffloadLockScope(companyId: number, containerId: number): SpOffloadLockScope {
  return { companyId, containerId };
}

export function normalizeSpOffloadDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

export function isCompatibleSpOffloadReplay(
  existing: SpOffloadReplayFingerprint,
  requested: SpOffloadReplayFingerprint
): boolean {
  return (
    normalizeSpOffloadDate(existing.offloadDate) === normalizeSpOffloadDate(requested.offloadDate) &&
    Number(existing.locationId) === Number(requested.locationId) &&
    Math.abs(Number(existing.totalLandedCostUsd) - Number(requested.totalLandedCostUsd)) <= 0.005
  );
}

export function classifySpOffloadState(
  status: string | null | undefined,
  hasExistingOffload: boolean,
  replayCompatible: boolean
): "post" | "replay" | "conflict" | "reject" {
  if (hasExistingOffload) return replayCompatible ? "replay" : "conflict";
  if (status === "open") return "post";
  return "reject";
}
