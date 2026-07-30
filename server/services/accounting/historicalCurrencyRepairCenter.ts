import crypto from "node:crypto";
import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { pool } from "../../db";
import { normalizeOpeningBalanceCurrency } from "./openingBalanceCurrency";
import {
  normalizeCurrencyCode,
  normalizeVoucherEntryAmounts,
  validateHistoricalRate,
} from "./currencyAmounts";
import {
  recommendOpeningRepair,
  recommendVoucherRepair,
  type HistoricalRepairClassification,
  type HistoricalRepairRecommendation,
  type StoredAmountMode,
} from "./historicalCurrencyRepairRecommendations";

export type HistoricalRepairKind =
  | "voucherEntry"
  | "ledger"
  | "bank"
  | "customer"
  | "supplier"
  | "employee"
  | "fixedAsset";

export interface HistoricalRepairInput {
  kind: HistoricalRepairKind;
  id: number;
  currency: string;
  historicalRate: string | number;
  storedAmountMode?: StoredAmountMode;
  transactionDebitAmount?: string | number;
  transactionCreditAmount?: string | number;
  nativeAmount?: string | number;
  baseAmount?: string | number;
  side?: "Dr" | "Cr";
  note?: string;
}

export interface HistoricalRepairCase {
  kind: HistoricalRepairKind;
  id: number;
  label: string;
  currency: string | null;
  rawAmount: string | null;
  nativeAmount: string | null;
  currentRate: string | null;
  currentBaseAmount: string | null;
  voucherId?: number;
  voucherNumber?: string | null;
  voucherType?: string | null;
  voucherDate?: string;
  sourceModule?: string | null;
  voucherCurrency?: string | null;
  voucherExchangeRate?: string | null;
  debitAmount?: string | null;
  creditAmount?: string | null;
  transactionDebitAmount?: string | null;
  transactionCreditAmount?: string | null;
  baseDebitAmount?: string | null;
  baseCreditAmount?: string | null;
  side?: string | null;
  classification: HistoricalRepairClassification;
  autoRepairable: boolean;
  reason: string;
  recommendation: HistoricalRepairRecommendation;
  versionTag: string;
}

export interface HistoricalRepairPlanItem {
  input: HistoricalRepairInput;
  before: HistoricalRepairCase;
  after: Record<string, string | null>;
}

export interface HistoricalRepairPlan {
  companyId: number;
  createdAt: string;
  itemCount: number;
  voucherCount: number;
  fingerprint: string;
  items: HistoricalRepairPlanItem[];
}

interface OpeningConfig {
  table: string;
  labelColumn: string;
  amountColumn: string;
  nativeColumn: string;
  currencyColumn: string;
  rateColumn: string;
  baseColumn: string;
  sideColumn?: string;
  companyColumn?: string;
  deletedColumn?: string;
}

const OPENING_CONFIG: Record<Exclude<HistoricalRepairKind, "voucherEntry">, OpeningConfig> = {
  ledger: {
    table: "ledger_accounts",
    labelColumn: "name",
    amountColumn: "opening_balance",
    nativeColumn: "opening_balance_native_amount",
    currencyColumn: "opening_balance_currency",
    rateColumn: "opening_balance_historical_rate",
    baseColumn: "opening_balance_base_amount",
    sideColumn: "opening_balance_side",
    companyColumn: "company_id",
    deletedColumn: "deleted_at",
  },
  bank: {
    table: "bank_accounts",
    labelColumn: "name",
    amountColumn: "opening_balance",
    nativeColumn: "opening_balance_native_amount",
    currencyColumn: "opening_balance_currency",
    rateColumn: "opening_balance_historical_rate",
    baseColumn: "opening_balance_base_amount",
    sideColumn: "opening_balance_side",
    companyColumn: "company_id",
    deletedColumn: "deleted_at",
  },
  customer: {
    table: "customers",
    labelColumn: "legal_name",
    amountColumn: "opening_balance",
    nativeColumn: "opening_balance_native_amount",
    currencyColumn: "opening_balance_currency",
    rateColumn: "opening_balance_historical_rate",
    baseColumn: "opening_balance_base_amount",
    sideColumn: "opening_balance_side",
    companyColumn: "company_id",
    deletedColumn: "deleted_at",
  },
  supplier: {
    table: "suppliers",
    labelColumn: "legal_name",
    amountColumn: "opening_balance",
    nativeColumn: "opening_balance_native_amount",
    currencyColumn: "opening_balance_currency",
    rateColumn: "opening_balance_historical_rate",
    baseColumn: "opening_balance_base_amount",
    sideColumn: "opening_balance_side",
    deletedColumn: "deleted_at",
  },
  employee: {
    table: "employees",
    labelColumn: "CONCAT_WS(' ', first_name, last_name)",
    amountColumn: "opening_balance",
    nativeColumn: "opening_balance_native_amount",
    currencyColumn: "opening_balance_currency",
    rateColumn: "opening_balance_historical_rate",
    baseColumn: "opening_balance_base_amount",
    sideColumn: "opening_balance_side",
    companyColumn: "company_id",
    deletedColumn: "deleted_at",
  },
  fixedAsset: {
    table: "fixed_assets",
    labelColumn: "name",
    amountColumn: "purchase_amount",
    nativeColumn: "purchase_native_amount",
    currencyColumn: "purchase_currency",
    rateColumn: "purchase_historical_rate",
    baseColumn: "purchase_base_amount",
    companyColumn: "company_id",
  },
};

function asPositiveId(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Repair row id must be a positive integer");
  return parsed;
}

function stableFingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function versionTag(row: Record<string, unknown>): string {
  return stableFingerprint(row);
}

function decimalTotal(debit: unknown, credit: unknown): string {
  try {
    return new Decimal(String(debit ?? 0)).plus(String(credit ?? 0)).toDecimalPlaces(6).toFixed(6);
  } catch {
    return "0.000000";
  }
}

async function getBaseCurrency(companyId: number, client = pool): Promise<string> {
  const result = await client.query<{ base_currency: string | null }>(
    "SELECT base_currency FROM companies WHERE id = $1",
    [companyId],
  );
  return String(result.rows[0]?.base_currency || "USD").toUpperCase();
}

function supplierScope(alias: string): string {
  return `EXISTS (
    SELECT 1 FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    WHERE ve.supplier_id = ${alias}.id
      AND v.company_id = $2
      AND v.deleted_at IS NULL
  )`;
}

function openingIncomplete(config: OpeningConfig, alias: string): string {
  return `(
    ${alias}.${config.nativeColumn} IS NULL
    OR ${alias}.${config.currencyColumn} IS NULL
    OR ${alias}.${config.baseColumn} IS NULL
    OR (
      ${alias}.${config.currencyColumn} IS NOT NULL
      AND UPPER(${alias}.${config.currencyColumn}) <> 'USD'
      AND ${alias}.${config.rateColumn} IS NULL
    )
  )`;
}

async function loadVoucherEntryCase(
  companyId: number,
  id: number,
  client = pool,
  knownBaseCurrency?: string,
): Promise<HistoricalRepairCase | null> {
  const result = await client.query(
    `SELECT ve.id, ve.voucher_id, v.voucher_date, v.currency AS voucher_currency,
            v.exchange_rate AS voucher_exchange_rate, v.voucher_number, v.voucher_type, v.source_module,
            ve.transaction_currency, ve.transaction_debit_amount, ve.transaction_credit_amount,
            ve.base_debit_amount, ve.base_credit_amount, ve.historical_exchange_rate,
            ve.debit_amount, ve.credit_amount, COALESCE(ve.narration, v.description, v.voucher_number) AS label
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ve.id = $1 AND v.company_id = $2 AND v.deleted_at IS NULL AND v.optional = false
      LIMIT 1`,
    [id, companyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const baseCurrency = knownBaseCurrency || (await getBaseCurrency(companyId, client));
  const snapshot = {
    id: row.id,
    voucherId: row.voucher_id,
    voucherDate: row.voucher_date,
    voucherCurrency: row.voucher_currency,
    voucherExchangeRate: row.voucher_exchange_rate,
    transactionCurrency: row.transaction_currency,
    transactionDebitAmount: row.transaction_debit_amount,
    transactionCreditAmount: row.transaction_credit_amount,
    baseDebitAmount: row.base_debit_amount,
    baseCreditAmount: row.base_credit_amount,
    historicalRate: row.historical_exchange_rate,
    debitAmount: row.debit_amount,
    creditAmount: row.credit_amount,
  };
  const recommendation = recommendVoucherRepair({
    voucherCurrency: row.transaction_currency || row.voucher_currency,
    voucherExchangeRate: row.voucher_exchange_rate,
    historicalExchangeRate: row.historical_exchange_rate,
    debitAmount: row.debit_amount,
    creditAmount: row.credit_amount,
    transactionDebitAmount: row.transaction_debit_amount,
    transactionCreditAmount: row.transaction_credit_amount,
    baseDebitAmount: row.base_debit_amount,
    baseCreditAmount: row.base_credit_amount,
    baseCurrency,
  });
  return {
    kind: "voucherEntry",
    id: row.id,
    label: row.label || `Voucher entry #${row.id}`,
    currency: row.transaction_currency || row.voucher_currency || null,
    rawAmount: decimalTotal(row.debit_amount, row.credit_amount),
    nativeAmount: decimalTotal(row.transaction_debit_amount, row.transaction_credit_amount),
    currentRate: row.historical_exchange_rate || row.voucher_exchange_rate || null,
    currentBaseAmount: decimalTotal(row.base_debit_amount, row.base_credit_amount),
    voucherId: row.voucher_id,
    voucherNumber: row.voucher_number,
    voucherType: row.voucher_type,
    voucherDate: String(row.voucher_date),
    sourceModule: row.source_module,
    voucherCurrency: row.voucher_currency,
    voucherExchangeRate: row.voucher_exchange_rate,
    debitAmount: row.debit_amount,
    creditAmount: row.credit_amount,
    transactionDebitAmount: row.transaction_debit_amount,
    transactionCreditAmount: row.transaction_credit_amount,
    baseDebitAmount: row.base_debit_amount,
    baseCreditAmount: row.base_credit_amount,
    classification: recommendation.classification,
    autoRepairable: recommendation.autoRepairable,
    reason: recommendation.reason,
    recommendation,
    versionTag: versionTag(snapshot),
  };
}

async function loadOpeningCase(
  companyId: number,
  kind: Exclude<HistoricalRepairKind, "voucherEntry">,
  id: number,
  client = pool,
  knownBaseCurrency?: string,
): Promise<HistoricalRepairCase | null> {
  const config = OPENING_CONFIG[kind];
  const clauses = ["target.id = $1"];
  if (config.companyColumn) clauses.push(`target.${config.companyColumn} = $2`);
  else clauses.push(supplierScope("target"));
  if (config.deletedColumn) clauses.push(`target.${config.deletedColumn} IS NULL`);
  const result = await client.query(
    `SELECT target.id, ${config.labelColumn} AS label,
            target.${config.amountColumn}::text AS raw_amount,
            target.${config.nativeColumn}::text AS native_amount,
            target.${config.currencyColumn} AS currency,
            target.${config.rateColumn}::text AS historical_rate,
            target.${config.baseColumn}::text AS base_amount
            ${config.sideColumn ? `, target.${config.sideColumn} AS side` : ""}
       FROM ${config.table} target
      WHERE ${clauses.join(" AND ")}
      LIMIT 1`,
    [id, companyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const baseCurrency = knownBaseCurrency || (await getBaseCurrency(companyId, client));
  const snapshot = {
    id: row.id,
    rawAmount: row.raw_amount,
    nativeAmount: row.native_amount,
    currency: row.currency,
    historicalRate: row.historical_rate,
    baseAmount: row.base_amount,
    side: row.side || null,
  };
  const recommendation = recommendOpeningRepair({
    currency: row.currency,
    historicalRate: row.historical_rate,
    rawAmount: row.raw_amount,
    nativeAmount: row.native_amount,
    baseAmount: row.base_amount,
    baseCurrency,
  });
  return {
    kind,
    id: row.id,
    label: row.label || `${kind} #${row.id}`,
    currency: row.currency,
    rawAmount: row.raw_amount,
    nativeAmount: row.native_amount,
    currentRate: row.historical_rate,
    currentBaseAmount: row.base_amount,
    side: row.side || null,
    classification: recommendation.classification,
    autoRepairable: recommendation.autoRepairable,
    reason: recommendation.reason,
    recommendation,
    versionTag: versionTag(snapshot),
  };
}

export async function loadHistoricalRepairCase(
  companyId: number,
  kind: HistoricalRepairKind,
  id: number,
  client = pool,
): Promise<HistoricalRepairCase | null> {
  const baseCurrency = await getBaseCurrency(companyId, client);
  return kind === "voucherEntry"
    ? loadVoucherEntryCase(companyId, id, client, baseCurrency)
    : loadOpeningCase(companyId, kind, id, client, baseCurrency);
}

export async function listHistoricalRepairCases(companyId: number): Promise<HistoricalRepairCase[]> {
  const baseCurrency = await getBaseCurrency(companyId);
  const entryResult = await pool.query<{ id: number }>(
    `SELECT ve.id
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
      WHERE v.company_id = $1 AND v.optional = false AND v.deleted_at IS NULL
        AND COALESCE(UPPER(v.currency), 'USD') <> 'USD'
        AND (
          ve.transaction_currency IS NULL OR ve.transaction_debit_amount IS NULL OR ve.transaction_credit_amount IS NULL
          OR ve.base_debit_amount IS NULL OR ve.base_credit_amount IS NULL
          OR ve.historical_exchange_rate IS NULL OR ve.rate_convention IS NULL
        )
      ORDER BY v.voucher_date, v.id, ve.id
      LIMIT 1000`,
    [companyId],
  );
  const openingResult = await pool.query<{ kind: HistoricalRepairKind; id: number }>(
    `SELECT * FROM (
       SELECT 'ledger'::text AS kind, id FROM ledger_accounts target WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(opening_balance, 0)::numeric <> 0 AND ${openingIncomplete(OPENING_CONFIG.ledger, "target")}
       UNION ALL SELECT 'bank', id FROM bank_accounts target WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(opening_balance, 0)::numeric <> 0 AND ${openingIncomplete(OPENING_CONFIG.bank, "target")}
       UNION ALL SELECT 'customer', id FROM customers target WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(opening_balance, 0)::numeric <> 0 AND ${openingIncomplete(OPENING_CONFIG.customer, "target")}
       UNION ALL SELECT 'supplier', target.id FROM suppliers target WHERE target.deleted_at IS NULL AND COALESCE(target.opening_balance, 0)::numeric <> 0 AND ${openingIncomplete(OPENING_CONFIG.supplier, "target")} AND ${supplierScope("target")}
       UNION ALL SELECT 'employee', id FROM employees target WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(opening_balance, 0)::numeric <> 0 AND ${openingIncomplete(OPENING_CONFIG.employee, "target")}
       UNION ALL SELECT 'fixedAsset', id FROM fixed_assets target WHERE company_id = $1 AND COALESCE(purchase_amount, 0)::numeric <> 0 AND ${openingIncomplete(OPENING_CONFIG.fixedAsset, "target")}
     ) unresolved ORDER BY kind, id LIMIT 1000`,
    [companyId, companyId],
  );
  const cases: HistoricalRepairCase[] = [];
  for (const row of entryResult.rows) {
    const found = await loadVoucherEntryCase(companyId, row.id, pool, baseCurrency);
    if (found) cases.push(found);
  }
  for (const row of openingResult.rows) {
    const found = await loadOpeningCase(
      companyId,
      row.kind as Exclude<HistoricalRepairKind, "voucherEntry">,
      row.id,
      pool,
      baseCurrency,
    );
    if (found) cases.push(found);
  }
  return cases;
}

export function automaticRepairInput(repairCase: HistoricalRepairCase): HistoricalRepairInput | null {
  const recommendation = repairCase.recommendation;
  if (!recommendation.autoRepairable || !recommendation.suggestedCurrency || !recommendation.suggestedHistoricalRate) {
    return null;
  }
  if (repairCase.kind === "voucherEntry") {
    if (!recommendation.suggestedTransactionDebitAmount || !recommendation.suggestedTransactionCreditAmount) return null;
    return {
      kind: "voucherEntry",
      id: repairCase.id,
      currency: recommendation.suggestedCurrency,
      historicalRate: recommendation.suggestedHistoricalRate,
      storedAmountMode: recommendation.suggestedStorageMode || "transaction",
      transactionDebitAmount: recommendation.suggestedTransactionDebitAmount,
      transactionCreditAmount: recommendation.suggestedTransactionCreditAmount,
      note: `Safe automatic repair: ${recommendation.reason}`,
    };
  }
  if (!recommendation.suggestedNativeAmount) return null;
  return {
    kind: repairCase.kind,
    id: repairCase.id,
    currency: recommendation.suggestedCurrency,
    historicalRate: recommendation.suggestedHistoricalRate,
    nativeAmount: recommendation.suggestedNativeAmount,
    baseAmount: recommendation.suggestedBaseAmount || undefined,
    side: repairCase.side === "Cr" ? "Cr" : "Dr",
    note: `Safe automatic repair: ${recommendation.reason}`,
  };
}

export async function listAutomaticHistoricalRepairs(companyId: number): Promise<HistoricalRepairInput[]> {
  const cases = await listHistoricalRepairCases(companyId);
  return cases.map(automaticRepairInput).filter((input): input is HistoricalRepairInput => input !== null);
}

function normalizePlanAfter(
  input: HistoricalRepairInput,
  before: HistoricalRepairCase,
  baseCurrency: string,
): Record<string, string | null> {
  const currency = normalizeCurrencyCode(String(input.currency || before.currency || ""));
  if (input.kind === "voucherEntry") {
    let transactionDebitAmount = input.transactionDebitAmount;
    let transactionCreditAmount = input.transactionCreditAmount;
    if (transactionDebitAmount === undefined || transactionCreditAmount === undefined) {
      if (input.storedAmountMode === "base") {
        const rate = currency === normalizeCurrencyCode(baseCurrency)
          ? new Decimal(1)
          : validateHistoricalRate(input.historicalRate, `${input.kind} #${input.id} historical rate`);
        transactionDebitAmount = new Decimal(before.baseDebitAmount ?? before.debitAmount ?? 0).times(rate).toFixed();
        transactionCreditAmount = new Decimal(before.baseCreditAmount ?? before.creditAmount ?? 0).times(rate).toFixed();
      } else {
        transactionDebitAmount = before.transactionDebitAmount ?? before.debitAmount ?? "0";
        transactionCreditAmount = before.transactionCreditAmount ?? before.creditAmount ?? "0";
      }
    }
    const normalized = normalizeVoucherEntryAmounts({
      transactionCurrency: currency,
      baseCurrency,
      transactionDebitAmount,
      transactionCreditAmount,
      historicalRate: input.historicalRate,
    });
    return {
      transactionCurrency: normalized.transactionCurrency,
      transactionDebitAmount: normalized.transactionDebitAmount,
      transactionCreditAmount: normalized.transactionCreditAmount,
      baseDebitAmount: normalized.baseDebitAmount,
      baseCreditAmount: normalized.baseCreditAmount,
      historicalExchangeRate: normalized.historicalExchangeRate,
      rateConvention: normalized.rateConvention,
      debitAmount: normalized.debitAmount,
      creditAmount: normalized.creditAmount,
    };
  }
  const normalized = normalizeOpeningBalanceCurrency({
    openingBalance: input.nativeAmount ?? before.nativeAmount ?? before.rawAmount ?? "0",
    openingBalanceCurrency: currency,
    openingBalanceHistoricalRate: input.historicalRate,
    openingBalanceBaseAmount: input.baseAmount,
    baseCurrency,
  });
  return {
    nativeAmount: normalized.openingBalanceNativeAmount,
    currency: normalized.openingBalanceCurrency,
    historicalRate: normalized.openingBalanceHistoricalRate,
    baseAmount: normalized.openingBalanceBaseAmount,
    side: input.kind === "supplier" || input.kind === "employee" ? "Cr" : input.side ?? before.side ?? "Dr",
  };
}

async function assertCompleteVoucherCoverage(
  companyId: number,
  items: HistoricalRepairPlanItem[],
): Promise<void> {
  const selectedByVoucher = new Map<number, Set<number>>();
  for (const item of items) {
    if (item.input.kind !== "voucherEntry" || !item.before.voucherId) continue;
    const selected = selectedByVoucher.get(item.before.voucherId) || new Set<number>();
    selected.add(item.input.id);
    selectedByVoucher.set(item.before.voucherId, selected);
  }
  if (selectedByVoucher.size === 0) return;
  const voucherIds = [...selectedByVoucher.keys()];
  const result = await pool.query<{ voucher_id: number; entry_ids: number[] }>(
    `SELECT ve.voucher_id, ARRAY_AGG(ve.id ORDER BY ve.id) AS entry_ids
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
      WHERE v.company_id = $1
        AND v.id = ANY($2::int[])
        AND v.deleted_at IS NULL AND v.optional = false
        AND COALESCE(UPPER(v.currency), 'USD') <> 'USD'
        AND (
          ve.transaction_currency IS NULL OR ve.transaction_debit_amount IS NULL OR ve.transaction_credit_amount IS NULL
          OR ve.base_debit_amount IS NULL OR ve.base_credit_amount IS NULL
          OR ve.historical_exchange_rate IS NULL OR ve.rate_convention IS NULL
        )
      GROUP BY ve.voucher_id`,
    [companyId, voucherIds],
  );
  for (const row of result.rows) {
    const selected = selectedByVoucher.get(row.voucher_id) || new Set<number>();
    const missing = (row.entry_ids || []).filter((id) => !selected.has(id));
    if (missing.length > 0) {
      throw new Error(`Voucher #${row.voucher_id} must be repaired as one complete batch; missing entry ids: ${missing.join(", ")}`);
    }
  }
}

export async function planHistoricalCurrencyRepairs(
  companyId: number,
  repairs: HistoricalRepairInput[],
): Promise<HistoricalRepairPlan> {
  if (!Array.isArray(repairs) || repairs.length === 0) throw new Error("At least one approved repair is required");
  if (repairs.length > 500) throw new Error("A repair batch cannot exceed 500 rows");
  const baseCurrency = await getBaseCurrency(companyId);
  const items: HistoricalRepairPlanItem[] = [];
  const seen = new Set<string>();
  for (const raw of repairs) {
    const input = { ...raw, id: asPositiveId(raw.id) };
    const key = `${input.kind}:${input.id}`;
    if (seen.has(key)) throw new Error(`Duplicate repair row: ${key}`);
    seen.add(key);
    const before = await loadHistoricalRepairCase(companyId, input.kind, input.id);
    if (!before) throw new Error(`${input.kind} #${input.id} was not found in the selected company`);
    items.push({ input, before, after: normalizePlanAfter(input, before, baseCurrency) });
  }
  await assertCompleteVoucherCoverage(companyId, items);
  const fingerprint = stableFingerprint(items.map(({ input, before, after }) => ({ input, versionTag: before.versionTag, after })));
  return {
    companyId,
    createdAt: new Date().toISOString(),
    itemCount: items.length,
    voucherCount: new Set(items.flatMap((item) => item.before.voucherId ? [item.before.voucherId] : [])).size,
    fingerprint,
    items,
  };
}

async function insertAudit(
  client: PoolClient,
  actor: { userId: string; username: string },
  companyId: number,
  item: HistoricalRepairPlanItem,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (user_id, username, company_id, action, table_name, record_id, record_identifier, changes)
     VALUES ($1, $2, $3, 'repair', $4, $5, $6, $7::jsonb)`,
    [
      actor.userId,
      actor.username,
      companyId,
      item.input.kind === "voucherEntry" ? "voucher_entries" : OPENING_CONFIG[item.input.kind].table,
      item.input.id,
      `historical-currency:${item.input.kind}:${item.input.id}`,
      JSON.stringify({ before: item.before, after: item.after, note: item.input.note || null }),
    ],
  );
}

async function applyPlanItem(client: PoolClient, companyId: number, item: HistoricalRepairPlanItem): Promise<void> {
  const current = await loadHistoricalRepairCase(companyId, item.input.kind, item.input.id, client);
  if (!current || current.versionTag !== item.before.versionTag) {
    throw new Error(`${item.input.kind} #${item.input.id} changed after preview; run the dry-run again`);
  }
  if (item.input.kind === "voucherEntry") {
    const after = item.after;
    const result = await client.query(
      `UPDATE voucher_entries ve
          SET transaction_currency = $1, transaction_debit_amount = $2, transaction_credit_amount = $3,
              base_debit_amount = $4, base_credit_amount = $5, historical_exchange_rate = $6,
              rate_convention = $7, debit_amount = $8, credit_amount = $9
         FROM vouchers v
        WHERE ve.id = $10 AND v.id = ve.voucher_id AND v.company_id = $11
          AND v.deleted_at IS NULL AND v.optional = false`,
      [after.transactionCurrency, after.transactionDebitAmount, after.transactionCreditAmount,
       after.baseDebitAmount, after.baseCreditAmount, after.historicalExchangeRate,
       after.rateConvention, after.debitAmount, after.creditAmount, item.input.id, companyId],
    );
    if (result.rowCount !== 1) throw new Error(`voucherEntry #${item.input.id} was not updated in the selected company`);
    return;
  }
  const config = OPENING_CONFIG[item.input.kind];
  const assignments = [
    `${config.amountColumn} = $1`, `${config.nativeColumn} = $2`, `${config.currencyColumn} = $3`,
    `${config.rateColumn} = $4`, `${config.baseColumn} = $5`,
  ];
  const values: Array<string | number | null> = [
    item.after.baseAmount, item.after.nativeAmount, item.after.currency, item.after.historicalRate, item.after.baseAmount,
  ];
  if (config.sideColumn) {
    assignments.push(`${config.sideColumn} = $6`);
    values.push(item.after.side);
  }
  const idIndex = values.length + 1;
  values.push(item.input.id);
  const companyIndex = values.length + 1;
  values.push(companyId);
  const scope = config.companyColumn
    ? `${config.companyColumn} = $${companyIndex}`
    : supplierScope("target").replaceAll("$2", `$${companyIndex}`);
  const deleted = config.deletedColumn ? ` AND ${config.deletedColumn} IS NULL` : "";
  const result = await client.query(
    `UPDATE ${config.table} target SET ${assignments.join(", ")} WHERE target.id = $${idIndex} AND ${scope}${deleted}`,
    values,
  );
  if (result.rowCount !== 1) throw new Error(`${item.input.kind} #${item.input.id} was not updated in the selected company`);
}

async function assertTouchedVouchersBalanced(client: PoolClient, companyId: number, items: HistoricalRepairPlanItem[]): Promise<void> {
  const voucherIds = [...new Set(items.flatMap((item) => item.before.voucherId ? [item.before.voucherId] : []))];
  if (voucherIds.length === 0) return;
  const result = await client.query<{
    voucher_id: number;
    debit_total: string;
    credit_total: string;
    incomplete_count: string;
  }>(
    `SELECT v.id AS voucher_id,
            COALESCE(SUM(ve.base_debit_amount::numeric), 0)::text AS debit_total,
            COALESCE(SUM(ve.base_credit_amount::numeric), 0)::text AS credit_total,
            COUNT(*) FILTER (WHERE ve.base_debit_amount IS NULL OR ve.base_credit_amount IS NULL
              OR ve.transaction_currency IS NULL OR ve.transaction_debit_amount IS NULL OR ve.transaction_credit_amount IS NULL
              OR ve.historical_exchange_rate IS NULL OR ve.rate_convention IS NULL)::text AS incomplete_count
       FROM vouchers v
       JOIN voucher_entries ve ON ve.voucher_id = v.id
      WHERE v.company_id = $1 AND v.id = ANY($2::int[]) AND v.deleted_at IS NULL AND v.optional = false
      GROUP BY v.id`,
    [companyId, voucherIds],
  );
  for (const row of result.rows) {
    if ((Number.parseInt(row.incomplete_count || "0", 10) || 0) > 0) {
      throw new Error(`Voucher #${row.voucher_id} still has incomplete currency metadata after repair`);
    }
    const difference = new Decimal(row.debit_total || 0).minus(row.credit_total || 0).abs();
    if (difference.gt("0.000001")) {
      throw new Error(`Voucher #${row.voucher_id} would be unbalanced by ${difference.toFixed(6)} in historical base currency`);
    }
  }
}

export async function applyHistoricalCurrencyRepairPlan(
  plan: HistoricalRepairPlan,
  actor: { userId: string; username: string },
): Promise<{ appliedCount: number; voucherCount: number; fingerprint: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('historical-currency-repair'), $1)", [plan.companyId]);
    for (const item of plan.items) {
      await applyPlanItem(client, plan.companyId, item);
      await insertAudit(client, actor, plan.companyId, item);
    }
    await assertTouchedVouchersBalanced(client, plan.companyId, plan.items);
    await client.query("COMMIT");
    return {
      appliedCount: plan.items.length,
      voucherCount: plan.voucherCount,
      fingerprint: plan.fingerprint,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
