import Decimal from "decimal.js";
import {
  reconcileTargetsTx,
  type ReconciliationAdapter,
  type ReconciliationResult,
  type ReconciliationTarget,
} from "./partyReconciliationService";

export type RepairDisposition = "none" | "manual-review" | "projection-rebuild";

export interface ReconciliationRunRequest {
  companyId: number;
  asOfDate?: string;
  runKey: string;
  targets: ReconciliationTarget[];
}

export interface RepairPlanItem {
  target: ReconciliationTarget;
  canonicalAmount: string;
  projectedAmount: string;
  difference: string;
  disposition: RepairDisposition;
  reason: string;
}

export interface ReconciliationReport {
  runKey: string;
  companyId: number;
  asOfDate?: string;
  generatedAt: string;
  matched: number;
  mismatched: number;
  items: RepairPlanItem[];
}

export interface RepairActor {
  userId?: string | number | null;
  username?: string | null;
  reason: string;
}

export interface RepairExecutionRequest {
  report: ReconciliationReport;
  approvalToken: string;
  idempotencyKey: string;
  actor: RepairActor;
}

export interface RepairExecutionResult {
  reportRunKey: string;
  repaired: number;
  skipped: number;
  repairedTargets: ReconciliationTarget[];
}

export interface ReconciliationRepairAdapter extends ReconciliationAdapter {
  findExistingReport(input: { tx: any; companyId: number; runKey: string }): Promise<ReconciliationReport | null>;
  persistReport(input: { tx: any; report: ReconciliationReport }): Promise<void>;
  classifyRepair(input: {
    tx: any;
    result: ReconciliationResult;
  }): Promise<{ disposition: RepairDisposition; reason: string }>;
  assertApprovalToken(input: {
    tx: any;
    companyId: number;
    reportRunKey: string;
    approvalToken: string;
  }): Promise<void>;
  findExistingRepair(input: {
    tx: any;
    companyId: number;
    idempotencyKey: string;
  }): Promise<RepairExecutionResult | null>;
  lockRepairTarget(input: { tx: any; target: ReconciliationTarget }): Promise<void>;
  assertPeriodOpen(input: { tx: any; target: ReconciliationTarget; actor: RepairActor }): Promise<void>;
  rebuildProjectionFromCanonical(input: {
    tx: any;
    item: RepairPlanItem;
    actor: RepairActor;
  }): Promise<void>;
  recordRepair(input: {
    tx: any;
    companyId: number;
    idempotencyKey: string;
    result: RepairExecutionResult;
    actor: RepairActor;
  }): Promise<void>;
  recordAudit(input: {
    tx: any;
    companyId: number;
    reportRunKey: string;
    idempotencyKey: string;
    actor: RepairActor;
    repaired: number;
    skipped: number;
  }): Promise<void>;
}

export class ReconciliationRepairError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReconciliationRepairError";
    this.code = code;
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ReconciliationRepairError("REPAIR_INPUT_INVALID", `${field} is required`);
  return normalized;
}

function targetKey(target: ReconciliationTarget): string {
  return [target.companyId, target.domain, target.targetId, target.asOfDate ?? "current"].join(":");
}

function validateRun(request: ReconciliationRunRequest): void {
  if (!Number.isInteger(request.companyId) || request.companyId <= 0) {
    throw new ReconciliationRepairError("REPAIR_COMPANY_INVALID", "A valid companyId is required");
  }
  requiredText(request.runKey, "runKey");
  if (!Array.isArray(request.targets) || request.targets.length === 0) {
    throw new ReconciliationRepairError("REPAIR_TARGETS_REQUIRED", "At least one target is required");
  }
  for (const target of request.targets) {
    if (target.companyId !== request.companyId) {
      throw new ReconciliationRepairError(
        "REPAIR_COMPANY_MISMATCH",
        `Target ${targetKey(target)} does not belong to company ${request.companyId}`
      );
    }
    if (request.asOfDate != null && target.asOfDate !== request.asOfDate) {
      throw new ReconciliationRepairError(
        "REPAIR_AS_OF_MISMATCH",
        `Target ${targetKey(target)} does not use run asOfDate ${request.asOfDate}`
      );
    }
  }
}

/** Generates and persists an immutable, repeat-safe reconciliation report. */
export async function generateReconciliationReportTx(
  tx: any,
  request: ReconciliationRunRequest,
  adapter: ReconciliationRepairAdapter,
  now = new Date()
): Promise<ReconciliationReport> {
  validateRun(request);
  const existing = await adapter.findExistingReport({
    tx,
    companyId: request.companyId,
    runKey: request.runKey,
  });
  if (existing) return existing;

  const batch = await reconcileTargetsTx(tx, request.targets, adapter);
  const items: RepairPlanItem[] = [];
  for (const result of batch.results) {
    let disposition: RepairDisposition = "none";
    let reason = "Canonical and projected balances match";
    if (result.status === "mismatch") {
      const classification = await adapter.classifyRepair({ tx, result });
      disposition = classification.disposition;
      reason = requiredText(classification.reason, "repair classification reason");
      if (disposition === "none") {
        throw new ReconciliationRepairError(
          "REPAIR_CLASSIFICATION_INVALID",
          `Mismatched target ${targetKey(result.target)} cannot use disposition none`
        );
      }
    }
    items.push({
      target: result.target,
      canonicalAmount: new Decimal(result.canonical.amount).toFixed(),
      projectedAmount: new Decimal(result.projected.amount).toFixed(),
      difference: new Decimal(result.difference).toFixed(),
      disposition,
      reason,
    });
  }

  const report: ReconciliationReport = {
    runKey: request.runKey,
    companyId: request.companyId,
    asOfDate: request.asOfDate,
    generatedAt: now.toISOString(),
    matched: batch.matched,
    mismatched: batch.mismatched,
    items,
  };
  await adapter.persistReport({ tx, report });
  return report;
}

/**
 * Executes only approved projection rebuilds. Canonical voucher entries are never edited;
 * repair adapters must rebuild the operational projection from canonical ledger truth.
 */
export async function executeApprovedRepairsTx(
  tx: any,
  request: RepairExecutionRequest,
  adapter: ReconciliationRepairAdapter
): Promise<RepairExecutionResult> {
  requiredText(request.approvalToken, "approvalToken");
  requiredText(request.idempotencyKey, "idempotencyKey");
  requiredText(request.actor.reason, "actor.reason");

  const existing = await adapter.findExistingRepair({
    tx,
    companyId: request.report.companyId,
    idempotencyKey: request.idempotencyKey,
  });
  if (existing) return existing;

  await adapter.assertApprovalToken({
    tx,
    companyId: request.report.companyId,
    reportRunKey: request.report.runKey,
    approvalToken: request.approvalToken,
  });

  const repairable = request.report.items
    .filter((item) => item.disposition === "projection-rebuild" && !new Decimal(item.difference).isZero())
    .sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)));

  for (const item of repairable) {
    await adapter.lockRepairTarget({ tx, target: item.target });
    await adapter.assertPeriodOpen({ tx, target: item.target, actor: request.actor });
    await adapter.rebuildProjectionFromCanonical({ tx, item, actor: request.actor });
  }

  const result: RepairExecutionResult = {
    reportRunKey: request.report.runKey,
    repaired: repairable.length,
    skipped: request.report.items.length - repairable.length,
    repairedTargets: repairable.map((item) => item.target),
  };

  await adapter.recordRepair({
    tx,
    companyId: request.report.companyId,
    idempotencyKey: request.idempotencyKey,
    result,
    actor: request.actor,
  });
  await adapter.recordAudit({
    tx,
    companyId: request.report.companyId,
    reportRunKey: request.report.runKey,
    idempotencyKey: request.idempotencyKey,
    actor: request.actor,
    repaired: result.repaired,
    skipped: result.skipped,
  });
  return result;
}
