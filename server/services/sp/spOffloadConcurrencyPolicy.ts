export interface SpOffloadLockScope {
  companyId: number;
  containerId: number;
}

export function buildSpOffloadLockScope(companyId: number, containerId: number): SpOffloadLockScope {
  return { companyId, containerId };
}

export function classifySpOffloadState(
  status: string | null | undefined,
  hasExistingOffload: boolean
): "post" | "replay" | "reject" {
  if (status === "open") return "post";
  if (hasExistingOffload) return "replay";
  return "reject";
}
