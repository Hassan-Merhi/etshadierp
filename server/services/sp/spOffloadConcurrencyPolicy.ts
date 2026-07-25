export interface SpOffloadLockScope {
  companyId: number;
  containerId: number;
}

export interface SpOffloadReplayFingerprint {
  offloadDate: string;
  locationId: number;
  totalLandedCostUsd: number;
  chargeSignature: string;
}

export interface SpOffloadChargeFingerprintInput {
  chargeType?: unknown;
  description?: unknown;
  amountUsd?: unknown;
  prepaidChargeId?: unknown;
  creditLedgerAccountId?: unknown;
  creditBankAccountId?: unknown;
  parentAgentAccountId?: unknown;
}

export function buildSpOffloadLockScope(companyId: number, containerId: number): SpOffloadLockScope {
  return { companyId, containerId };
}

export function normalizeSpOffloadDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function optionalPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedAmount(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "NaN";
}

/**
 * Canonical signature for persisted and requested landed-charge lines.
 * Parent-agent requests are persisted in creditLedgerAccountId, so both shapes
 * normalize to the same accounting identity.
 */
export function buildSpOffloadChargeSignature(lines: SpOffloadChargeFingerprintInput[]): string {
  const normalized = (Array.isArray(lines) ? lines : [])
    .filter((line) => Number(line?.amountUsd ?? 0) > 0)
    .map((line) => {
      const chargeType = String(line?.chargeType ?? "").trim();
      const parentAgentAccountId = optionalPositiveInteger(line?.parentAgentAccountId);
      return {
        chargeType,
        description: String(line?.description ?? "").trim(),
        amountUsd: normalizedAmount(line?.amountUsd),
        prepaidChargeId: optionalPositiveInteger(line?.prepaidChargeId),
        creditLedgerAccountId:
          chargeType === "parent_agent"
            ? parentAgentAccountId ?? optionalPositiveInteger(line?.creditLedgerAccountId)
            : optionalPositiveInteger(line?.creditLedgerAccountId),
        creditBankAccountId: optionalPositiveInteger(line?.creditBankAccountId),
      };
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return JSON.stringify(normalized);
}

export function isCompatibleSpOffloadReplay(
  existing: SpOffloadReplayFingerprint,
  requested: SpOffloadReplayFingerprint
): boolean {
  return (
    normalizeSpOffloadDate(existing.offloadDate) === normalizeSpOffloadDate(requested.offloadDate) &&
    Number(existing.locationId) === Number(requested.locationId) &&
    Math.abs(Number(existing.totalLandedCostUsd) - Number(requested.totalLandedCostUsd)) <= 0.005 &&
    existing.chargeSignature === requested.chargeSignature
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
