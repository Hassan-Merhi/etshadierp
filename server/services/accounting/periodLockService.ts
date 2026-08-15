export type ProtectedDomain = "accounting" | "inventory" | "factory";

export interface PeriodLockScope {
  companyId: number;
  domain: ProtectedDomain;
  effectiveDate: string;
}

export interface PeriodLockRecord {
  id: number;
  companyId: number;
  domain: ProtectedDomain;
  lockedThrough: string;
  version: number;
  reason?: string | null;
}

export interface PeriodLockActor {
  userId?: string | number | null;
  username?: string | null;
  reason?: string | null;
}

export interface PeriodLockAdapter {
  findApplicableLock(input: { tx: any; scope: PeriodLockScope }): Promise<PeriodLockRecord | null>;
  lockPeriodState(input: { tx: any; companyId: number; domain: ProtectedDomain }): Promise<PeriodLockRecord | null>;
  persistLock(input: {
    tx: any;
    companyId: number;
    domain: ProtectedDomain;
    lockedThrough: string;
    expectedVersion: number | null;
    actor: PeriodLockActor;
  }): Promise<PeriodLockRecord>;
  recordAudit(input: {
    tx: any;
    action: "lock" | "extend" | "override";
    companyId: number;
    domain: ProtectedDomain;
    effectiveDate: string;
    lockedThrough: string;
    actor: PeriodLockActor;
    sourceType: string;
    sourceId: string;
  }): Promise<void>;
  findExistingOverride(input: {
    tx: any;
    companyId: number;
    domain: ProtectedDomain;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
  }): Promise<boolean>;
  recordOverride(input: {
    tx: any;
    companyId: number;
    domain: ProtectedDomain;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    effectiveDate: string;
    actor: PeriodLockActor;
  }): Promise<void>;
}

export interface ClosedPeriodOverride {
  allowed: true;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  actor: PeriodLockActor;
}

export class PeriodLockError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PeriodLockError";
    this.code = code;
    this.details = details;
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new PeriodLockError("PERIOD_LOCK_FIELD_REQUIRED", `${field} is required`);
  return normalized;
}

function normalizeDate(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new PeriodLockError("PERIOD_LOCK_DATE_INVALID", `${field} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new PeriodLockError("PERIOD_LOCK_DATE_INVALID", `${field} is not a valid calendar date`);
  }
  return text;
}

function validateScope(scope: PeriodLockScope): PeriodLockScope {
  if (!Number.isInteger(scope.companyId) || scope.companyId <= 0) {
    throw new PeriodLockError("PERIOD_LOCK_COMPANY_INVALID", "A valid companyId is required");
  }
  if (!(["accounting", "inventory", "factory"] as string[]).includes(scope.domain)) {
    throw new PeriodLockError("PERIOD_LOCK_DOMAIN_INVALID", "domain must be accounting, inventory, or factory");
  }
  return { ...scope, effectiveDate: normalizeDate(scope.effectiveDate, "effectiveDate") };
}

export async function assertPeriodOpenTx(
  tx: any,
  scopeInput: PeriodLockScope,
  adapter: PeriodLockAdapter,
  override?: ClosedPeriodOverride
): Promise<{ open: true; lock: PeriodLockRecord | null; overridden: boolean }> {
  const scope = validateScope(scopeInput);
  const lock = await adapter.findApplicableLock({ tx, scope });
  if (!lock || scope.effectiveDate > normalizeDate(lock.lockedThrough, "lockedThrough")) {
    return { open: true, lock, overridden: false };
  }

  if (!override?.allowed) {
    throw new PeriodLockError(
      "PERIOD_CLOSED",
      `${scope.domain} is locked through ${lock.lockedThrough}; ${scope.effectiveDate} cannot be changed`,
      { companyId: scope.companyId, domain: scope.domain, effectiveDate: scope.effectiveDate, lockedThrough: lock.lockedThrough }
    );
  }

  const sourceType = requiredText(override.sourceType, "override.sourceType");
  const sourceId = requiredText(override.sourceId, "override.sourceId");
  const idempotencyKey = requiredText(override.idempotencyKey, "override.idempotencyKey");
  const reason = requiredText(override.actor?.reason, "override.actor.reason");
  const actor = { ...override.actor, reason };

  const existing = await adapter.findExistingOverride({
    tx,
    companyId: scope.companyId,
    domain: scope.domain,
    sourceType,
    sourceId,
    idempotencyKey,
  });
  if (!existing) {
    await adapter.recordOverride({
      tx,
      companyId: scope.companyId,
      domain: scope.domain,
      sourceType,
      sourceId,
      idempotencyKey,
      effectiveDate: scope.effectiveDate,
      actor,
    });
    await adapter.recordAudit({
      tx,
      action: "override",
      companyId: scope.companyId,
      domain: scope.domain,
      effectiveDate: scope.effectiveDate,
      lockedThrough: lock.lockedThrough,
      actor,
      sourceType,
      sourceId,
    });
  }

  return { open: true, lock, overridden: true };
}

export async function lockThroughTx(
  tx: any,
  request: {
    companyId: number;
    domain: ProtectedDomain;
    lockedThrough: string;
    expectedVersion?: number | null;
    sourceType: string;
    sourceId: string;
    actor: PeriodLockActor;
  },
  adapter: PeriodLockAdapter
): Promise<PeriodLockRecord> {
  const scope = validateScope({
    companyId: request.companyId,
    domain: request.domain,
    effectiveDate: request.lockedThrough,
  });
  const sourceType = requiredText(request.sourceType, "sourceType");
  const sourceId = requiredText(request.sourceId, "sourceId");
  const reason = requiredText(request.actor?.reason, "actor.reason");
  const actor = { ...request.actor, reason };
  const current = await adapter.lockPeriodState({ tx, companyId: scope.companyId, domain: scope.domain });

  if (current && request.expectedVersion != null && current.version !== request.expectedVersion) {
    throw new PeriodLockError("PERIOD_LOCK_STALE", "Period lock changed since it was loaded", {
      expectedVersion: request.expectedVersion,
      actualVersion: current.version,
    });
  }
  if (current && scope.effectiveDate < normalizeDate(current.lockedThrough, "current.lockedThrough")) {
    throw new PeriodLockError(
      "PERIOD_LOCK_REOPEN_FORBIDDEN",
      "A closed period cannot be shortened or reopened through the normal lock path"
    );
  }
  if (current && scope.effectiveDate === current.lockedThrough) return current;

  const saved = await adapter.persistLock({
    tx,
    companyId: scope.companyId,
    domain: scope.domain,
    lockedThrough: scope.effectiveDate,
    expectedVersion: current?.version ?? null,
    actor,
  });
  await adapter.recordAudit({
    tx,
    action: current ? "extend" : "lock",
    companyId: scope.companyId,
    domain: scope.domain,
    effectiveDate: scope.effectiveDate,
    lockedThrough: scope.effectiveDate,
    actor,
    sourceType,
    sourceId,
  });
  return saved;
}

/**
 * Every accounting, inventory, factory-costing, reversal, repair, import, and
 * back-date path must call assertPeriodOpenTx inside the same transaction before
 * its first business write. Administrative overrides are exceptional, reasoned,
 * idempotent, and audit-recorded; they do not silently reopen the period.
 */