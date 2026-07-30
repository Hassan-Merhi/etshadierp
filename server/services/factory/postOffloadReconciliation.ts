import Decimal from "decimal.js";
import { pool } from "../../db";
import { normalizeFactoryVoucherEntryAmounts } from "./factoryVoucherEntryAmounts";
import type { PostOffloadHistoricalReplayResult } from "./postOffloadHistoricalReplay";

export const POST_OFFLOAD_REPORT_QUERY_KEYS = [
  "/api/factory/containers",
  "/api/factory/raw-stock",
  "/api/factory/raw-stock/by-container",
  "/api/factory/mix-batches",
  "/api/factory/bales",
  "/api/factory/bale-ledger",
  "/api/factory/suppliers",
  "/api/factory/suppliers/with-balances",
  "/api/factory/production-value-report",
  "/api/factory/daybook",
  "/api/accounts/all",
  "/api/vouchers",
] as const;

export type PostOffloadReconciliationStatus = "reconciled" | "repair_required" | "failed";

export interface PostOffloadReconciliationResult {
  status: PostOffloadReconciliationStatus;
  companyId: number;
  containerId: number;
  chargeId: number | null;
  accounting: {
    chargesChecked: number;
    activeVouchersChecked: number;
    voucherEntriesNormalized: number;
    daybookEntriesChecked: number;
    reversalsChecked: number;
    issues: string[];
  };
  inventory: {
    rawStockRowsChecked: number;
    containerCostPerKgUsd: string | null;
    issues: string[];
  };
  reports: {
    serverReadCacheInvalidated: boolean;
    derivedFromLiveCostTables: boolean;
    queryKeys: readonly string[];
  };
  undo: {
    required: boolean;
    available: boolean;
    undoLogId: number | null;
    fingerprint: string | null;
    alreadyUndone: boolean;
    issues: string[];
  };
  issues: string[];
}

interface ChargeRow {
  id: number;
  amount: string;
  currency_code: string | null;
  fx_rate_to_usd: string | null;
  ledger_account_id: number | null;
  supplier_id: number | null;
  voucher_id: number | null;
  daybook_entry_id: number | null;
  reversal_daybook_entry_id: number | null;
  deleted_at: Date | null;
}

interface VoucherRow {
  id: number;
  company_id: number;
  total_amount: string;
  currency: string;
  exchange_rate: string | null;
  source_module: string | null;
  deleted_at: Date | null;
}

interface VoucherEntryRow {
  id: number;
  ledger_account_id: number | null;
  factory_supplier_id: number | null;
  debit_amount: string | null;
  credit_amount: string | null;
  transaction_debit_amount: string | null;
  transaction_credit_amount: string | null;
}

interface DaybookRow {
  id: number;
  company_id: number;
  tx_type: string;
  reference_id: number | null;
  amount_currency: string | null;
  fx_rate_to_usd: string | null;
  amount_usd: string | null;
  meta_json: unknown;
}

interface ReconciliationQueryClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDecimal(value: string | number | null | undefined, fallback = "0"): Decimal {
  try {
    const parsed = new Decimal(value ?? fallback);
    return parsed.isFinite() ? parsed : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

function closeEnough(left: Decimal, right: Decimal, tolerance = "0.000001"): boolean {
  return left.minus(right).abs().lte(new Decimal(tolerance));
}

function metadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function uniqueIssues(values: string[]): string[] {
  return [...new Set(values)];
}

async function loadDaybook(client: ReconciliationQueryClient, id: number | null): Promise<DaybookRow | null> {
  if (!id) return null;
  const result = await client.query<DaybookRow>(
    `SELECT id, company_id, tx_type, reference_id, amount_currency,
            fx_rate_to_usd, amount_usd, meta_json
     FROM factory_daybook_entries
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );
  return result.rows[0] ?? null;
}

function verifyOriginalDaybook(params: {
  row: DaybookRow | null;
  companyId: number;
  containerId: number;
  charge: ChargeRow;
  issues: string[];
}): void {
  const { row, companyId, containerId, charge, issues } = params;
  if (!row) {
    issues.push(`charge ${charge.id}: original daybook entry is missing`);
    return;
  }

  const amount = parseDecimal(charge.amount);
  const fxRate = parseDecimal(charge.fx_rate_to_usd);
  const expectedUsd = amount.times(fxRate);
  const meta = metadata(row.meta_json);

  if (row.company_id !== companyId || row.reference_id !== containerId || row.tx_type !== "OTHER_CHARGE") {
    issues.push(`charge ${charge.id}: original daybook scope or type does not match the charge`);
  }
  if (meta.sourceType !== "POST_OFFLOAD_ADDITIONAL" || Number(meta.chargeId) !== charge.id) {
    issues.push(`charge ${charge.id}: original daybook metadata does not identify the charge`);
  }
  if (!closeEnough(parseDecimal(row.amount_currency), amount, "0.01")) {
    issues.push(`charge ${charge.id}: original daybook transaction amount does not reconcile`);
  }
  if (!closeEnough(parseDecimal(row.fx_rate_to_usd), fxRate, "0.000001")) {
    issues.push(`charge ${charge.id}: original daybook FX rate does not reconcile`);
  }
  if (!closeEnough(parseDecimal(row.amount_usd), expectedUsd, "0.01")) {
    issues.push(`charge ${charge.id}: original daybook USD amount does not reconcile`);
  }
}

async function reconcileActiveVoucher(params: {
  client: ReconciliationQueryClient;
  charge: ChargeRow;
  accountingIssues: string[];
}): Promise<{ voucherChecked: boolean; entriesNormalized: number }> {
  const { client, charge, accountingIssues } = params;
  const hasAccountingTarget = Boolean(charge.ledger_account_id || charge.supplier_id);

  if (!charge.voucher_id) {
    if (hasAccountingTarget) {
      accountingIssues.push(`charge ${charge.id}: active accounting target has no linked voucher`);
    }
    return { voucherChecked: false, entriesNormalized: 0 };
  }

  const voucherResult = await client.query<VoucherRow>(
    `SELECT id, company_id, total_amount, currency, exchange_rate, source_module, deleted_at
     FROM vouchers
     WHERE id = $1
     FOR UPDATE`,
    [charge.voucher_id]
  );
  const voucher = voucherResult.rows[0];
  if (!voucher) {
    accountingIssues.push(`charge ${charge.id}: linked voucher ${charge.voucher_id} is missing`);
    return { voucherChecked: false, entriesNormalized: 0 };
  }
  if (!hasAccountingTarget) {
    if (!voucher.deleted_at) {
      accountingIssues.push(`charge ${charge.id}: voucher remains active without an accounting target`);
    }
    return { voucherChecked: true, entriesNormalized: 0 };
  }
  if (voucher.deleted_at) {
    accountingIssues.push(`charge ${charge.id}: linked voucher is deleted while the charge is active`);
    return { voucherChecked: true, entriesNormalized: 0 };
  }

  const amount = parseDecimal(charge.amount);
  const currency = String(charge.currency_code || "USD").toUpperCase();
  const fxRate = parseDecimal(charge.fx_rate_to_usd);
  if (amount.lte(0) || fxRate.lte(0)) {
    accountingIssues.push(`charge ${charge.id}: amount or FX rate is invalid`);
    return { voucherChecked: true, entriesNormalized: 0 };
  }
  if (voucher.source_module !== "FACTORY") {
    accountingIssues.push(`charge ${charge.id}: linked voucher is not owned by the factory module`);
  }
  if (String(voucher.currency || "").toUpperCase() !== currency) {
    accountingIssues.push(`charge ${charge.id}: voucher currency does not match the charge`);
  }
  if (!closeEnough(parseDecimal(voucher.total_amount), amount, "0.01")) {
    accountingIssues.push(`charge ${charge.id}: voucher total does not match the charge`);
  }
  if (!closeEnough(parseDecimal(voucher.exchange_rate), fxRate, "0.000001")) {
    accountingIssues.push(`charge ${charge.id}: voucher FX rate does not match the charge`);
  }

  const entriesResult = await client.query<VoucherEntryRow>(
    `SELECT id, ledger_account_id, factory_supplier_id, debit_amount, credit_amount,
            transaction_debit_amount, transaction_credit_amount
     FROM voucher_entries
     WHERE voucher_id = $1
     ORDER BY id
     FOR UPDATE`,
    [voucher.id]
  );
  if (entriesResult.rows.length !== 2) {
    accountingIssues.push(`charge ${charge.id}: voucher must contain exactly two entries`);
    return { voucherChecked: true, entriesNormalized: 0 };
  }

  let debitCount = 0;
  let creditCount = 0;
  let baseDebitTotal = new Decimal(0);
  let baseCreditTotal = new Decimal(0);
  let entriesNormalized = 0;

  for (const entry of entriesResult.rows) {
    const storedDebit = parseDecimal(entry.transaction_debit_amount ?? entry.debit_amount);
    const storedCredit = parseDecimal(entry.transaction_credit_amount ?? entry.credit_amount);
    const debitSide = storedDebit.gt(0) && !storedCredit.gt(0);
    const creditSide = storedCredit.gt(0) && !storedDebit.gt(0);
    if (!debitSide && !creditSide) {
      accountingIssues.push(`charge ${charge.id}: voucher entry ${entry.id} has an invalid debit/credit side`);
      continue;
    }

    if (debitSide) {
      debitCount += 1;
      if (!entry.ledger_account_id) {
        accountingIssues.push(`charge ${charge.id}: payable debit entry has no ledger account`);
      }
    } else {
      creditCount += 1;
      if (charge.ledger_account_id && entry.ledger_account_id !== charge.ledger_account_id) {
        accountingIssues.push(`charge ${charge.id}: credit ledger account does not match the charge`);
      }
      if (charge.supplier_id && !charge.ledger_account_id && entry.factory_supplier_id !== charge.supplier_id) {
        accountingIssues.push(`charge ${charge.id}: credit supplier does not match the charge`);
      }
    }

    const normalized = normalizeFactoryVoucherEntryAmounts({
      transactionCurrency: currency,
      transactionDebitAmount: debitSide ? amount.toFixed() : "0",
      transactionCreditAmount: creditSide ? amount.toFixed() : "0",
      fxRateToUsd: fxRate.toFixed(),
    });

    const updateResult = await client.query(
      `UPDATE voucher_entries
       SET debit_amount = $1,
           credit_amount = $2,
           transaction_currency = $3,
           transaction_debit_amount = $4,
           transaction_credit_amount = $5,
           base_debit_amount = $6,
           base_credit_amount = $7,
           historical_exchange_rate = $8,
           rate_convention = $9
       WHERE id = $10 AND voucher_id = $11`,
      [
        normalized.debitAmount,
        normalized.creditAmount,
        normalized.transactionCurrency,
        normalized.transactionDebitAmount,
        normalized.transactionCreditAmount,
        normalized.baseDebitAmount,
        normalized.baseCreditAmount,
        normalized.historicalExchangeRate,
        normalized.rateConvention,
        entry.id,
        voucher.id,
      ]
    );
    if (updateResult.rowCount !== 1) {
      accountingIssues.push(`charge ${charge.id}: voucher entry ${entry.id} was not normalized exactly once`);
      continue;
    }

    entriesNormalized += 1;
    baseDebitTotal = baseDebitTotal.plus(normalized.baseDebitAmount);
    baseCreditTotal = baseCreditTotal.plus(normalized.baseCreditAmount);
  }

  if (debitCount !== 1 || creditCount !== 1) {
    accountingIssues.push(`charge ${charge.id}: voucher does not have one debit and one credit entry`);
  }
  if (!closeEnough(baseDebitTotal, baseCreditTotal, "0.000001")) {
    accountingIssues.push(`charge ${charge.id}: normalized voucher base amounts do not balance`);
  }

  return { voucherChecked: true, entriesNormalized };
}

async function verifyDeletedCharge(params: {
  client: ReconciliationQueryClient;
  companyId: number;
  containerId: number;
  charge: ChargeRow;
  accountingIssues: string[];
}): Promise<{ voucherChecked: boolean; reversalChecked: boolean; daybookChecked: boolean }> {
  const { client, companyId, containerId, charge, accountingIssues } = params;
  let voucherChecked = false;

  if (charge.voucher_id) {
    const voucherResult = await client.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM vouchers WHERE id = $1 FOR UPDATE`,
      [charge.voucher_id]
    );
    voucherChecked = true;
    if (!voucherResult.rows[0]) {
      accountingIssues.push(`charge ${charge.id}: deleted charge voucher is missing`);
    } else if (!voucherResult.rows[0].deleted_at) {
      accountingIssues.push(`charge ${charge.id}: deleted charge still has an active voucher`);
    }
  }

  const original = await loadDaybook(client, charge.daybook_entry_id);
  verifyOriginalDaybook({ row: original, companyId, containerId, charge, issues: accountingIssues });
  const reversal = await loadDaybook(client, charge.reversal_daybook_entry_id);
  if (!reversal) {
    accountingIssues.push(`charge ${charge.id}: deleted charge has no reversing daybook entry`);
    return { voucherChecked, reversalChecked: false, daybookChecked: Boolean(original) };
  }
  if (!original) {
    return { voucherChecked, reversalChecked: true, daybookChecked: false };
  }

  const reversalMeta = metadata(reversal.meta_json);
  if (
    reversal.company_id !== companyId ||
    reversal.reference_id !== containerId ||
    reversal.tx_type !== "OTHER_CHARGE" ||
    reversalMeta.sourceType !== "POST_OFFLOAD_ADDITIONAL_REVERSAL" ||
    Number(reversalMeta.chargeId) !== charge.id ||
    Number(reversalMeta.reversesDaybookEntryId) !== original.id
  ) {
    accountingIssues.push(`charge ${charge.id}: reversing daybook scope or metadata is invalid`);
  }
  if (!closeEnough(parseDecimal(reversal.amount_currency), parseDecimal(original.amount_currency).negated(), "0.01")) {
    accountingIssues.push(`charge ${charge.id}: reversing transaction amount does not negate the original`);
  }
  if (!closeEnough(parseDecimal(reversal.amount_usd), parseDecimal(original.amount_usd).negated(), "0.01")) {
    accountingIssues.push(`charge ${charge.id}: reversing USD amount does not negate the original`);
  }

  return { voucherChecked, reversalChecked: true, daybookChecked: true };
}

export async function reconcilePostOffloadMutation(params: {
  companyId: number;
  containerId: number;
  chargeId?: number | null;
  mutationAction: "CREATE" | "EDIT" | "UNDO" | "LEGACY_REBUILD";
  userId: string;
  username?: string | null;
  historicalReplay?: PostOffloadHistoricalReplayResult | null;
}): Promise<PostOffloadReconciliationResult> {
  const {
    companyId,
    containerId,
    chargeId = null,
    mutationAction,
    userId,
    username = null,
    historicalReplay = null,
  } = params;
  const client = (await pool.connect()) as unknown as ReconciliationQueryClient & { release(): void };
  let transactionStarted = false;

  const accountingIssues: string[] = [];
  const inventoryIssues: string[] = [];
  const undoIssues: string[] = [];
  let chargesChecked = 0;
  let activeVouchersChecked = 0;
  let voucherEntriesNormalized = 0;
  let daybookEntriesChecked = 0;
  let reversalsChecked = 0;
  let rawStockRowsChecked = 0;
  let containerCostPerKgUsd: string | null = null;
  let undoLogId: number | null = null;
  let undoFingerprint: string | null = null;
  let undoAlreadyUndone = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(9004, $1)", [companyId]);

    const containerResult = await client.query<{
      id: number;
      rate_per_kg_usd: string | null;
    }>(
      `SELECT id, rate_per_kg_usd
       FROM factory_containers
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [containerId, companyId]
    );
    const container = containerResult.rows[0];
    if (!container) throw new Error("Post-offload reconciliation container was not found in the selected company.");
    containerCostPerKgUsd = container.rate_per_kg_usd;

    const chargeResult = await client.query<ChargeRow>(
      `SELECT id, amount, currency_code, fx_rate_to_usd, ledger_account_id,
              supplier_id, voucher_id, daybook_entry_id,
              reversal_daybook_entry_id, deleted_at
       FROM factory_offload_additional_charges
       WHERE company_id = $1 AND container_id = $2
       ORDER BY id
       FOR UPDATE`,
      [companyId, containerId]
    );
    chargesChecked = chargeResult.rows.length;
    if (chargesChecked === 0) {
      accountingIssues.push("container has no post-offload charge rows to reconcile");
    }

    for (const charge of chargeResult.rows) {
      if (charge.deleted_at) {
        const checked = await verifyDeletedCharge({
          client,
          companyId,
          containerId,
          charge,
          accountingIssues,
        });
        if (checked.voucherChecked) activeVouchersChecked += 1;
        if (checked.daybookChecked) daybookEntriesChecked += 1;
        if (checked.reversalChecked) reversalsChecked += 1;
        continue;
      }

      const originalDaybook = await loadDaybook(client, charge.daybook_entry_id);
      verifyOriginalDaybook({
        row: originalDaybook,
        companyId,
        containerId,
        charge,
        issues: accountingIssues,
      });
      if (originalDaybook) daybookEntriesChecked += 1;

      const voucher = await reconcileActiveVoucher({ client, charge, accountingIssues });
      if (voucher.voucherChecked) activeVouchersChecked += 1;
      voucherEntriesNormalized += voucher.entriesNormalized;
    }

    const rawStockResult = await client.query<{
      id: number;
      cost_per_kg_usd: string | null;
    }>(
      `SELECT id, cost_per_kg_usd
       FROM factory_raw_stock
       WHERE company_id = $1 AND container_id = $2
       ORDER BY id
       FOR UPDATE`,
      [companyId, containerId]
    );
    rawStockRowsChecked = rawStockResult.rows.length;
    if (rawStockRowsChecked === 0) {
      inventoryIssues.push("container has no linked raw-stock row");
    }

    const expectedContainerRate = parseDecimal(container.rate_per_kg_usd);
    for (const row of rawStockResult.rows) {
      if (!closeEnough(parseDecimal(row.cost_per_kg_usd), expectedContainerRate, "0.000001")) {
        inventoryIssues.push(`raw-stock ${row.id}: cost per kg does not match the container canonical USD rate`);
      }
    }
    if (!historicalReplay) {
      inventoryIssues.push("historical replay result is missing from the post-offload response");
    } else if (historicalReplay.status === "blocked" || historicalReplay.status === "failed") {
      inventoryIssues.push(
        `historical supplier-cost replay ${historicalReplay.status}: ${historicalReplay.reason || "repair required"}`
      );
    }

    const undoRequired = historicalReplay?.status === "applied";
    if (undoRequired) {
      const replayRecordId = chargeId ?? containerId;
      const auditResult = await client.query<{
        fingerprint: string | null;
      }>(
        `SELECT changes::jsonb ->> 'fingerprint' AS fingerprint
         FROM audit_log
         WHERE company_id = $1
           AND action = 'post_offload_historical_replay_applied'
           AND table_name = 'factory_offload_additional_charges'
           AND record_id = $2
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [companyId, replayRecordId]
      );
      undoFingerprint = auditResult.rows[0]?.fingerprint ?? null;
      if (!undoFingerprint) {
        undoIssues.push("historical replay audit fingerprint is missing");
      } else {
        const undoResult = await client.query<{
          id: number;
          undone_at: Date | null;
        }>(
          `SELECT id, undone_at
           FROM factory_recalc_undo_log
           WHERE company_id = $1
             AND operation_type = 'HISTORICAL_REPLAY_EXACT'
             AND scope_fingerprint = $2
           ORDER BY applied_at DESC NULLS LAST, id DESC
           LIMIT 1`,
          [companyId, undoFingerprint]
        );
        undoLogId = undoResult.rows[0]?.id ?? null;
        undoAlreadyUndone = Boolean(undoResult.rows[0]?.undone_at);
        if (!undoLogId) undoIssues.push("exact historical replay undo snapshot is missing");
        if (undoAlreadyUndone) undoIssues.push("exact historical replay undo snapshot has already been used");
      }
    }

    const allIssues = uniqueIssues([...accountingIssues, ...inventoryIssues, ...undoIssues]);
    const status: PostOffloadReconciliationStatus = allIssues.length === 0 ? "reconciled" : "repair_required";
    const result: PostOffloadReconciliationResult = {
      status,
      companyId,
      containerId,
      chargeId,
      accounting: {
        chargesChecked,
        activeVouchersChecked,
        voucherEntriesNormalized,
        daybookEntriesChecked,
        reversalsChecked,
        issues: uniqueIssues(accountingIssues),
      },
      inventory: {
        rawStockRowsChecked,
        containerCostPerKgUsd,
        issues: uniqueIssues(inventoryIssues),
      },
      reports: {
        serverReadCacheInvalidated: true,
        derivedFromLiveCostTables: true,
        queryKeys: POST_OFFLOAD_REPORT_QUERY_KEYS,
      },
      undo: {
        required: undoRequired,
        available: Boolean(undoLogId) && !undoAlreadyUndone,
        undoLogId,
        fingerprint: undoFingerprint,
        alreadyUndone: undoAlreadyUndone,
        issues: uniqueIssues(undoIssues),
      },
      issues: allIssues,
    };

    await client.query(
      `INSERT INTO audit_log
         (user_id, username, company_id, action, table_name, record_id,
          record_identifier, changes, created_at)
       VALUES ($1, $2, $3, 'post_offload_reconciliation_completed',
               'factory_offload_additional_charges', $4, $5, $6::jsonb, NOW())`,
      [
        userId || null,
        username,
        companyId,
        chargeId ?? containerId,
        `post-offload ${mutationAction.toLowerCase()} reconciliation — container ${containerId}`,
        JSON.stringify({
          mutationAction,
          historicalReplayStatus: historicalReplay?.status ?? null,
          status,
          accounting: result.accounting,
          inventory: result.inventory,
          reports: result.reports,
          undo: result.undo,
        }),
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    const issue = errorMessage(error);
    return {
      status: "failed",
      companyId,
      containerId,
      chargeId,
      accounting: {
        chargesChecked,
        activeVouchersChecked,
        voucherEntriesNormalized,
        daybookEntriesChecked,
        reversalsChecked,
        issues: uniqueIssues([...accountingIssues, issue]),
      },
      inventory: {
        rawStockRowsChecked,
        containerCostPerKgUsd,
        issues: uniqueIssues(inventoryIssues),
      },
      reports: {
        serverReadCacheInvalidated: true,
        derivedFromLiveCostTables: true,
        queryKeys: POST_OFFLOAD_REPORT_QUERY_KEYS,
      },
      undo: {
        required: historicalReplay?.status === "applied",
        available: false,
        undoLogId,
        fingerprint: undoFingerprint,
        alreadyUndone: undoAlreadyUndone,
        issues: uniqueIssues(undoIssues),
      },
      issues: uniqueIssues([...accountingIssues, ...inventoryIssues, ...undoIssues, issue]),
    };
  } finally {
    client.release();
  }
}
