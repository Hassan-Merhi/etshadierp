import Decimal from "decimal.js";

export type ReconciliationDomain = "cash" | "bank" | "customer" | "supplier";

export interface ReconciliationTarget {
  domain: ReconciliationDomain;
  companyId: number;
  targetId: string;
  asOfDate?: string;
}

export interface ReconciliationBalance {
  amount: string;
  currency?: string | null;
  source: string;
  lastActivityAt?: string | null;
}

export interface ReconciliationAdapter {
  loadCanonicalLedgerBalance(input: ReconciliationTarget & { tx: any }): Promise<ReconciliationBalance>;
  loadProjectedBalance(input: ReconciliationTarget & { tx: any }): Promise<ReconciliationBalance>;
}

export interface ReconciliationResult {
  target: ReconciliationTarget;
  canonical: ReconciliationBalance;
  projected: ReconciliationBalance;
  difference: string;
  status: "matched" | "mismatch";
}

export interface ReconciliationBatchResult {
  results: ReconciliationResult[];
  matched: number;
  mismatched: number;
}

export class ReconciliationValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReconciliationValidationError";
    this.code = code;
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new ReconciliationValidationError("RECONCILIATION_TARGET_INVALID", `${field} is required`);
  }
  return normalized;
}

function parseAmount(value: unknown, label: string): Decimal {
  try {
    const amount = new Decimal(String(value));
    if (!amount.isFinite()) throw new Error("non-finite");
    return amount;
  } catch {
    throw new ReconciliationValidationError(
      "RECONCILIATION_AMOUNT_INVALID",
      `${label} returned an invalid amount`
    );
  }
}

export function validateReconciliationTarget(target: ReconciliationTarget): ReconciliationTarget {
  if (!Number.isInteger(target.companyId) || target.companyId <= 0) {
    throw new ReconciliationValidationError(
      "RECONCILIATION_COMPANY_INVALID",
      "A valid companyId is required"
    );
  }

  if (!["cash", "bank", "customer", "supplier"].includes(target.domain)) {
    throw new ReconciliationValidationError(
      "RECONCILIATION_DOMAIN_INVALID",
      `Unsupported reconciliation domain: ${String(target.domain)}`
    );
  }

  requiredText(target.targetId, "targetId");
  if (target.asOfDate != null) requiredText(target.asOfDate, "asOfDate");
  return target;
}

/**
 * Read-only reconciliation boundary for cash, bank, customer, and supplier balances.
 *
 * Voucher entries are the canonical accounting source. Operational account, bank,
 * customer, and supplier balances are projections and must be compared against the
 * canonical ledger inside one caller-owned transaction/snapshot. This service never
 * mutates or repairs balances; repair planning belongs to Phase 2I.
 */
export async function reconcileTargetTx(
  tx: any,
  target: ReconciliationTarget,
  adapter: ReconciliationAdapter
): Promise<ReconciliationResult> {
  validateReconciliationTarget(target);

  const [canonical, projected] = await Promise.all([
    adapter.loadCanonicalLedgerBalance({ ...target, tx }),
    adapter.loadProjectedBalance({ ...target, tx }),
  ]);

  const canonicalAmount = parseAmount(canonical.amount, "Canonical ledger");
  const projectedAmount = parseAmount(projected.amount, "Projected balance");
  const canonicalCurrency = String(canonical.currency ?? "").trim().toUpperCase();
  const projectedCurrency = String(projected.currency ?? "").trim().toUpperCase();

  if (canonicalCurrency && projectedCurrency && canonicalCurrency !== projectedCurrency) {
    throw new ReconciliationValidationError(
      "RECONCILIATION_CURRENCY_MISMATCH",
      `Cannot compare ${canonicalCurrency} with ${projectedCurrency}`
    );
  }

  const difference = projectedAmount.minus(canonicalAmount);
  return {
    target,
    canonical,
    projected,
    difference: difference.toFixed(),
    status: difference.isZero() ? "matched" : "mismatch",
  };
}

export async function reconcileTargetsTx(
  tx: any,
  targets: ReconciliationTarget[],
  adapter: ReconciliationAdapter
): Promise<ReconciliationBatchResult> {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new ReconciliationValidationError(
      "RECONCILIATION_TARGETS_REQUIRED",
      "At least one reconciliation target is required"
    );
  }

  const uniqueKeys = new Set<string>();
  for (const target of targets) {
    validateReconciliationTarget(target);
    const key = [target.companyId, target.domain, target.targetId, target.asOfDate ?? "current"].join(":");
    if (uniqueKeys.has(key)) {
      throw new ReconciliationValidationError(
        "RECONCILIATION_TARGET_DUPLICATE",
        `Duplicate reconciliation target: ${key}`
      );
    }
    uniqueKeys.add(key);
  }

  const results: ReconciliationResult[] = [];
  for (const target of targets) {
    results.push(await reconcileTargetTx(tx, target, adapter));
  }

  const mismatched = results.filter((result) => result.status === "mismatch").length;
  return {
    results,
    matched: results.length - mismatched,
    mismatched,
  };
}
