import Decimal from "decimal.js";
import { pool } from "../../db";
import { getCashBankRevaluation } from "./cashBankRevaluationService";
import {
  getHistoricalCurrencyReadiness,
  type HistoricalCurrencyReadiness,
} from "./historicalCurrencyReadiness";

const BALANCE_TOLERANCE = new Decimal("0.000001");

export interface HistoricalCurrencyReconciliation {
  generatedAt: string;
  companyId: number;
  readiness: HistoricalCurrencyReadiness;
  trialBalance: {
    debit: string;
    credit: string;
    difference: string;
    balanced: boolean;
  };
  voucherIntegrity: {
    resolvedVoucherCount: number;
    unbalancedVoucherCount: number;
    sampleUnbalancedVoucherIds: number[];
    partialMetadataEntryCount: number;
  };
  entryIntegrity: {
    globalOrphanVoucherEntryCount: number;
    deletedVoucherEntryCount: number;
    deletedVoucherEntriesExcludedFromLiveTotals: true;
  };
  cashBank: {
    accountCount: number;
    unresolvedAccountCount: number;
    currentCfaPerUsd: string | null;
  };
  readyForHistoricalReports: boolean;
  readyForLiveNetPosition: boolean;
  issues: string[];
  informationalWarnings: string[];
}

function asCount(value: string | null | undefined): number {
  return Number.parseInt(value || "0", 10) || 0;
}

function amount(value: string | null | undefined): Decimal {
  try {
    const parsed = new Decimal(value || 0);
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function schemaBlockedReconciliation(
  companyId: number,
  readiness: HistoricalCurrencyReadiness,
): HistoricalCurrencyReconciliation {
  return {
    generatedAt: new Date().toISOString(),
    companyId,
    readiness,
    trialBalance: { debit: "0.000000", credit: "0.000000", difference: "0.000000", balanced: false },
    voucherIntegrity: {
      resolvedVoucherCount: 0,
      unbalancedVoucherCount: 0,
      sampleUnbalancedVoucherIds: [],
      partialMetadataEntryCount: 0,
    },
    entryIntegrity: {
      globalOrphanVoucherEntryCount: 0,
      deletedVoucherEntryCount: 0,
      deletedVoucherEntriesExcludedFromLiveTotals: true,
    },
    cashBank: { accountCount: 0, unresolvedAccountCount: 0, currentCfaPerUsd: null },
    readyForHistoricalReports: false,
    readyForLiveNetPosition: false,
    issues: ["The structural multi-currency schema is not fully installed."],
    informationalWarnings: [],
  };
}

export async function getHistoricalCurrencyReconciliation(
  companyId: number,
): Promise<HistoricalCurrencyReconciliation> {
  const readiness = await getHistoricalCurrencyReadiness(companyId);
  if (!readiness.schemaReady) return schemaBlockedReconciliation(companyId, readiness);

  const [cashBank, trialResult, voucherResult, integrityResult] = await Promise.all([
    getCashBankRevaluation(companyId),
    pool.query<{ debit_total: string; credit_total: string }>(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN ve.base_debit_amount IS NOT NULL THEN ve.base_debit_amount::numeric
             WHEN COALESCE(UPPER(v.currency), 'USD') = 'USD' THEN COALESCE(ve.debit_amount, 0)::numeric
             ELSE 0::numeric
           END
         ), 0)::text AS debit_total,
         COALESCE(SUM(
           CASE
             WHEN ve.base_credit_amount IS NOT NULL THEN ve.base_credit_amount::numeric
             WHEN COALESCE(UPPER(v.currency), 'USD') = 'USD' THEN COALESCE(ve.credit_amount, 0)::numeric
             ELSE 0::numeric
           END
         ), 0)::text AS credit_total
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
      WHERE v.company_id = $1
        AND v.optional = false
        AND v.deleted_at IS NULL`,
      [companyId],
    ),
    pool.query<{
      resolved_voucher_count: string;
      unbalanced_voucher_count: string;
      sample_unbalanced_voucher_ids: number[] | null;
      partial_metadata_entry_count: string;
    }>(
      `WITH entry_state AS (
         SELECT
           v.id AS voucher_id,
           ve.id AS entry_id,
           COALESCE(ve.base_debit_amount, CASE WHEN COALESCE(UPPER(v.currency), 'USD') = 'USD' THEN ve.debit_amount END, 0)::numeric AS base_debit,
           COALESCE(ve.base_credit_amount, CASE WHEN COALESCE(UPPER(v.currency), 'USD') = 'USD' THEN ve.credit_amount END, 0)::numeric AS base_credit,
           CASE
             WHEN COALESCE(UPPER(v.currency), 'USD') = 'USD' THEN 0
             WHEN ve.transaction_currency IS NULL OR ve.transaction_debit_amount IS NULL OR ve.transaction_credit_amount IS NULL
               OR ve.base_debit_amount IS NULL OR ve.base_credit_amount IS NULL
               OR ve.historical_exchange_rate IS NULL OR ve.rate_convention IS NULL
               THEN 1 ELSE 0
           END AS incomplete,
           CASE
             WHEN COALESCE(UPPER(v.currency), 'USD') <> 'USD'
               AND (
                 ve.transaction_currency IS NOT NULL OR ve.transaction_debit_amount IS NOT NULL OR ve.transaction_credit_amount IS NOT NULL
                 OR ve.base_debit_amount IS NOT NULL OR ve.base_credit_amount IS NOT NULL
                 OR ve.historical_exchange_rate IS NOT NULL OR ve.rate_convention IS NOT NULL
               )
               AND (
                 ve.transaction_currency IS NULL OR ve.transaction_debit_amount IS NULL OR ve.transaction_credit_amount IS NULL
                 OR ve.base_debit_amount IS NULL OR ve.base_credit_amount IS NULL
                 OR ve.historical_exchange_rate IS NULL OR ve.rate_convention IS NULL
               )
               THEN 1 ELSE 0
           END AS partial_metadata
         FROM voucher_entries ve
         JOIN vouchers v ON v.id = ve.voucher_id
         WHERE v.company_id = $1 AND v.optional = false AND v.deleted_at IS NULL
       ), voucher_state AS (
         SELECT voucher_id,
                SUM(base_debit) AS debit_total,
                SUM(base_credit) AS credit_total,
                SUM(incomplete) AS incomplete_count
           FROM entry_state
          GROUP BY voucher_id
       ), unbalanced AS (
         SELECT voucher_id
           FROM voucher_state
          WHERE incomplete_count = 0
            AND ABS(debit_total - credit_total) > 0.000001
       )
       SELECT
         (SELECT COUNT(*) FROM voucher_state WHERE incomplete_count = 0)::text AS resolved_voucher_count,
         (SELECT COUNT(*) FROM unbalanced)::text AS unbalanced_voucher_count,
         COALESCE(
           (SELECT ARRAY_AGG(voucher_id ORDER BY voucher_id)
              FROM (SELECT voucher_id FROM unbalanced ORDER BY voucher_id LIMIT 25) sample),
           ARRAY[]::integer[]
         ) AS sample_unbalanced_voucher_ids,
         (SELECT COALESCE(SUM(partial_metadata), 0) FROM entry_state)::text AS partial_metadata_entry_count`,
      [companyId],
    ),
    pool.query<{
      orphan_entry_count: string;
      deleted_voucher_entry_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM voucher_entries ve LEFT JOIN vouchers v ON v.id = ve.voucher_id WHERE v.id IS NULL)::text AS orphan_entry_count,
         (SELECT COUNT(*)
            FROM voucher_entries ve
            JOIN vouchers v ON v.id = ve.voucher_id
           WHERE v.company_id = $1 AND v.deleted_at IS NOT NULL)::text AS deleted_voucher_entry_count`,
      [companyId],
    ),
  ]);

  const debit = amount(trialResult.rows[0]?.debit_total);
  const credit = amount(trialResult.rows[0]?.credit_total);
  const difference = debit.minus(credit);
  const trialBalanced = difference.abs().lte(BALANCE_TOLERANCE);
  const resolvedVoucherCount = asCount(voucherResult.rows[0]?.resolved_voucher_count);
  const unbalancedVoucherCount = asCount(voucherResult.rows[0]?.unbalanced_voucher_count);
  const partialMetadataEntryCount = asCount(voucherResult.rows[0]?.partial_metadata_entry_count);
  const globalOrphanVoucherEntryCount = asCount(integrityResult.rows[0]?.orphan_entry_count);
  const deletedVoucherEntryCount = asCount(integrityResult.rows[0]?.deleted_voucher_entry_count);

  const readyForHistoricalReports =
    readiness.ready &&
    trialBalanced &&
    unbalancedVoucherCount === 0 &&
    partialMetadataEntryCount === 0;
  const readyForLiveNetPosition = readyForHistoricalReports && cashBank.unresolvedAccountCount === 0;

  const issues: string[] = [];
  if (!readiness.ready) issues.push(`${readiness.totalUnresolvedCount} historical currency row(s) remain unresolved.`);
  if (!trialBalanced) issues.push(`Live historical-base trial balance differs by ${difference.abs().toFixed(6)}.`);
  if (unbalancedVoucherCount > 0) issues.push(`${unbalancedVoucherCount} fully resolved voucher(s) are unbalanced in historical base currency.`);
  if (partialMetadataEntryCount > 0) issues.push(`${partialMetadataEntryCount} voucher entr${partialMetadataEntryCount === 1 ? "y has" : "ies have"} partial dual-currency metadata.`);
  if (cashBank.unresolvedAccountCount > 0) issues.push(`${cashBank.unresolvedAccountCount} cash/bank account(s) cannot be translated to a current base value.`);

  const informationalWarnings: string[] = [];
  if (globalOrphanVoucherEntryCount > 0) {
    informationalWarnings.push(
      `${globalOrphanVoucherEntryCount} orphan voucher entr${globalOrphanVoucherEntryCount === 1 ? "y exists" : "ies exist"} repository-wide; orphan rows cannot be attributed safely to one company.`,
    );
  }
  if (deletedVoucherEntryCount > 0) {
    informationalWarnings.push(
      `${deletedVoucherEntryCount} entr${deletedVoucherEntryCount === 1 ? "y belongs" : "ies belong"} to deleted vouchers and are excluded from live totals.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    readiness,
    trialBalance: {
      debit: debit.toDecimalPlaces(6).toFixed(6),
      credit: credit.toDecimalPlaces(6).toFixed(6),
      difference: difference.toDecimalPlaces(6).toFixed(6),
      balanced: trialBalanced,
    },
    voucherIntegrity: {
      resolvedVoucherCount,
      unbalancedVoucherCount,
      sampleUnbalancedVoucherIds: voucherResult.rows[0]?.sample_unbalanced_voucher_ids || [],
      partialMetadataEntryCount,
    },
    entryIntegrity: {
      globalOrphanVoucherEntryCount,
      deletedVoucherEntryCount,
      deletedVoucherEntriesExcludedFromLiveTotals: true,
    },
    cashBank: {
      accountCount: cashBank.accounts.length,
      unresolvedAccountCount: cashBank.unresolvedAccountCount,
      currentCfaPerUsd: cashBank.currentCfaPerUsd,
    },
    readyForHistoricalReports,
    readyForLiveNetPosition,
    issues,
    informationalWarnings,
  };
}
