import type {
  HistoricalReplayPreviewResult,
  ReplayQueryExecutor,
  ReplaySummary,
} from "./types";
import { REPLAY_ALGORITHM_VERSION } from "./types";

export const HISTORICAL_REPLAY_APPLY_MODE_ENV = "HISTORICAL_REPLAY_APPLY_MODE";
export const HISTORICAL_REPLAY_APPLY_MODE_VALUE = "APPROVED_V8_CONTROLLED_APPLY";
export const HISTORICAL_REPLAY_RELEASE_ID_ENV = "HISTORICAL_REPLAY_RELEASE_ID";

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export interface HistoricalReplayProductionControl {
  enabled: boolean;
  releaseId: string | null;
  configurationErrors: string[];
}

export interface HistoricalReplaySchemaObjectStatus {
  kind: "table" | "column" | "index" | "trigger" | "constraint";
  name: string;
  present: boolean;
}

export interface HistoricalReplaySchemaReadiness {
  ready: boolean;
  objects: HistoricalReplaySchemaObjectStatus[];
  missingObjects: string[];
}

export interface HistoricalReplaySafetyReadiness {
  allSafetyGatesPassed: boolean;
  applicableSupplierCount: number;
  applicableChangeCount: number;
  blockers: Array<{ gate: string; count: number }>;
}

const REQUIRED_TABLES = [
  "audit_log",
  "factory_recalc_undo_log",
  "factory_replay_consumed_tokens",
] as const;

const REQUIRED_COLUMNS = [
  ["factory_mix_batch_sources", "inventory_supplier_id"],
  ["factory_raw_material_adjustments", "valuation_basis"],
  ["factory_recalc_undo_log", "snapshot"],
  ["factory_recalc_undo_log", "operation_type"],
  ["factory_recalc_undo_log", "algorithm_version"],
  ["factory_recalc_undo_log", "scope_fingerprint"],
  ["factory_recalc_undo_log", "applied_at"],
  ["factory_recalc_undo_log", "undone_at"],
  ["factory_recalc_undo_log", "undone_by_user_id"],
  ["factory_replay_consumed_tokens", "token_hash"],
  ["factory_replay_consumed_tokens", "company_id"],
  ["factory_replay_consumed_tokens", "user_id"],
  ["factory_replay_consumed_tokens", "replay_algorithm_version"],
  ["factory_replay_consumed_tokens", "scope_fingerprint"],
  ["factory_replay_consumed_tokens", "consumed_at"],
] as const;

const REQUIRED_INDEXES = [
  "factory_mix_batch_sources_inventory_supplier_idx",
  "factory_raw_material_adjustments_unclassified_valuation_idx",
  "factory_recalc_undo_log_exact_fingerprint_idx",
  "factory_replay_consumed_tokens_company_consumed_idx",
] as const;

const REQUIRED_TRIGGERS = [
  "factory_adjustment_valuation_basis_trg",
  "factory_mix_source_inventory_supplier_trg",
] as const;

const REQUIRED_CONSTRAINTS = [
  "factory_mix_batch_sources_inventory_supplier_fk",
  "factory_raw_material_adjustments_valuation_basis_chk",
] as const;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function readHistoricalReplayProductionControl(
  environment: NodeJS.ProcessEnv = process.env
): HistoricalReplayProductionControl {
  const configuredMode = String(environment[HISTORICAL_REPLAY_APPLY_MODE_ENV] ?? "").trim();
  const configuredReleaseId = String(environment[HISTORICAL_REPLAY_RELEASE_ID_ENV] ?? "").trim();
  const configurationErrors: string[] = [];

  if (configuredMode !== HISTORICAL_REPLAY_APPLY_MODE_VALUE) {
    configurationErrors.push(
      `${HISTORICAL_REPLAY_APPLY_MODE_ENV} must exactly equal ${HISTORICAL_REPLAY_APPLY_MODE_VALUE}`
    );
  }
  if (!RELEASE_ID_PATTERN.test(configuredReleaseId)) {
    configurationErrors.push(
      `${HISTORICAL_REPLAY_RELEASE_ID_ENV} must be an 8-128 character release identifier using letters, numbers, dot, underscore, or dash`
    );
  }

  return {
    enabled: configurationErrors.length === 0,
    releaseId: configurationErrors.length === 0 ? configuredReleaseId : null,
    configurationErrors,
  };
}

export async function inspectHistoricalReplayProductionSchema(
  executor: ReplayQueryExecutor
): Promise<HistoricalReplaySchemaReadiness> {
  const [tablesResult, columnsResult, indexesResult, triggersResult, constraintsResult] =
    await Promise.all([
      executor.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = ANY($1::text[])`,
        [[...REQUIRED_TABLES]]
      ),
      executor.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND (table_name, column_name) IN (
             ('factory_mix_batch_sources', 'inventory_supplier_id'),
             ('factory_raw_material_adjustments', 'valuation_basis'),
             ('factory_recalc_undo_log', 'snapshot'),
             ('factory_recalc_undo_log', 'operation_type'),
             ('factory_recalc_undo_log', 'algorithm_version'),
             ('factory_recalc_undo_log', 'scope_fingerprint'),
             ('factory_recalc_undo_log', 'applied_at'),
             ('factory_recalc_undo_log', 'undone_at'),
             ('factory_recalc_undo_log', 'undone_by_user_id'),
             ('factory_replay_consumed_tokens', 'token_hash'),
             ('factory_replay_consumed_tokens', 'company_id'),
             ('factory_replay_consumed_tokens', 'user_id'),
             ('factory_replay_consumed_tokens', 'replay_algorithm_version'),
             ('factory_replay_consumed_tokens', 'scope_fingerprint'),
             ('factory_replay_consumed_tokens', 'consumed_at')
           )`
      ),
      executor.query<{ indexname: string }>(
        `SELECT indexname
         FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname = ANY($1::text[])`,
        [[...REQUIRED_INDEXES]]
      ),
      executor.query<{ tgname: string }>(
        `SELECT trigger_row.tgname
         FROM pg_trigger trigger_row
         JOIN pg_class relation_row ON relation_row.oid = trigger_row.tgrelid
         JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
         WHERE namespace_row.nspname = current_schema()
           AND trigger_row.tgisinternal = FALSE
           AND trigger_row.tgenabled <> 'D'
           AND trigger_row.tgname = ANY($1::text[])`,
        [[...REQUIRED_TRIGGERS]]
      ),
      executor.query<{ conname: string }>(
        `SELECT conname
         FROM pg_constraint
         WHERE connamespace = current_schema()::regnamespace
           AND conname = ANY($1::text[])`,
        [[...REQUIRED_CONSTRAINTS]]
      ),
    ]);

  const presentTables = new Set(tablesResult.rows.map((row) => row.table_name));
  const presentColumns = new Set(
    columnsResult.rows.map((row) => `${row.table_name}.${row.column_name}`)
  );
  const presentIndexes = new Set(indexesResult.rows.map((row) => row.indexname));
  const presentTriggers = new Set(triggersResult.rows.map((row) => row.tgname));
  const presentConstraints = new Set(constraintsResult.rows.map((row) => row.conname));

  const objects: HistoricalReplaySchemaObjectStatus[] = [
    ...REQUIRED_TABLES.map((name) => ({
      kind: "table" as const,
      name,
      present: presentTables.has(name),
    })),
    ...REQUIRED_COLUMNS.map(([tableName, columnName]) => {
      const name = `${tableName}.${columnName}`;
      return { kind: "column" as const, name, present: presentColumns.has(name) };
    }),
    ...REQUIRED_INDEXES.map((name) => ({
      kind: "index" as const,
      name,
      present: presentIndexes.has(name),
    })),
    ...REQUIRED_TRIGGERS.map((name) => ({
      kind: "trigger" as const,
      name,
      present: presentTriggers.has(name),
    })),
    ...REQUIRED_CONSTRAINTS.map((name) => ({
      kind: "constraint" as const,
      name,
      present: presentConstraints.has(name),
    })),
  ];
  const missingObjects = uniqueSorted(
    objects.filter((entry) => !entry.present).map((entry) => `${entry.kind}:${entry.name}`)
  );

  return {
    ready: missingObjects.length === 0,
    objects,
    missingObjects,
  };
}

function summaryBlockers(summary: ReplaySummary): Array<{ gate: string; count: number }> {
  const values: Array<{ gate: string; count: number }> = [
    { gate: "unresolvedInventorySupplierSources", count: summary.unresolvedInventorySupplierSources ?? 0 },
    { gate: "unclassifiedValuedAdjustments", count: summary.unclassifiedValuedAdjustments ?? 0 },
    { gate: "unresolvedFx", count: summary.unresolvedFx },
    { gate: "missingDates", count: summary.missingDates },
    { gate: "quantityTimelineMismatches", count: summary.quantityTimelineMismatches },
    { gate: "ambiguousEventOrdering", count: summary.ambiguousEventOrdering },
    { gate: "incompleteMixedBatchSupplierScopes", count: summary.incompleteMixedBatchSupplierScopes ?? 0 },
    { gate: "missingSupplierTimelines", count: summary.missingSupplierTimelines ?? 0 },
    { gate: "blockedBatches", count: summary.blockedBatches ?? 0 },
    { gate: "scanCoverageError", count: summary.scanCoverageError ? 1 : 0 },
  ];
  return values.filter((entry) => entry.count > 0);
}

export function evaluateHistoricalReplaySafetyReadiness(
  preview: HistoricalReplayPreviewResult
): HistoricalReplaySafetyReadiness {
  const blockers = summaryBlockers(preview.summary);
  const applicableSupplierCount = preview.supplierRows.filter((supplier) => supplier.safeToRepair).length;
  const supplierRateChanges = preview.supplierRows.filter(
    (supplier) => supplier.safeToRepair
      && Math.abs(supplier.endingExpectedRate - supplier.currentStoredRate) > 0.000000001
  ).length;
  const applicableChangeCount =
    preview.summary.canonicalContainerMismatches
    + preview.summary.sourceMismatches
    + preview.summary.batchesToUpdate
    + preview.summary.balesToUpdate
    + supplierRateChanges;

  return {
    allSafetyGatesPassed: blockers.length === 0,
    applicableSupplierCount,
    applicableChangeCount,
    blockers,
  };
}

export function historicalReplayAuthorizationReady(params: {
  control: HistoricalReplayProductionControl;
  schema: HistoricalReplaySchemaReadiness;
  safety?: HistoricalReplaySafetyReadiness;
}): boolean {
  return params.control.enabled
    && params.control.releaseId != null
    && params.schema.ready
    && (params.safety == null || params.safety.allSafetyGatesPassed);
}

export function historicalReplayReadinessVersion(): string {
  return `V8:${REPLAY_ALGORITHM_VERSION}`;
}
