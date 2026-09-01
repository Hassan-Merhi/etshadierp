import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";
import type { CentralPostingRequest, PostingActor } from "./centralPostingEngine";
import { buildGenericVoucherPostingRequest } from "./genericVoucherPosting";
import { GOLDEN_COAST_CUTOVER_DATE } from "./goldenCoastPhase4CutoverFifo";

/**
 * Golden Coast Phase 10 settles the receivable-like debit carried in GC Sales
 * Cash directly into a Golden Coast Cash/Bank account. It deliberately does
 * not collect through HADI (Phase 7), withdraw Hassan Savings (Phase 9), or
 * touch sales/FIFO/inventory accounting.
 */
export const GOLDEN_COAST_PHASE10_SOURCE_TYPE = "golden-coast-phase10-sales-cash-settlement";
export const GOLDEN_COAST_PHASE10_MAX_REQUEST_ID_LENGTH = 64;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_SCALE = 2;

export type GoldenCoastPhase10ErrorCode =
  | "GC_PHASE10_INPUT_INVALID"
  | "GC_PHASE10_PRE_CUTOVER_DATE"
  | "GC_PHASE10_SETTLEMENT_EXCEEDS_BALANCE"
  | "GC_PHASE10_BALANCE_INVALID";

export class GoldenCoastPhase10SettlementError extends Error {
  readonly code: GoldenCoastPhase10ErrorCode;

  constructor(message: string, code: GoldenCoastPhase10ErrorCode = "GC_PHASE10_INPUT_INVALID") {
    super(releaseDebtEnglish(message));
    this.name = "GoldenCoastPhase10SettlementError";
    this.code = code;
  }
}

export interface GoldenCoastPhase10CashAccount {
  kind: "ledger" | "bank";
  id: number;
}

export interface GoldenCoastPhase10SettlementInput {
  companyId: number;
  settlementDate: string;
  amountUsd: string;
  clientRequestId: string;
  receiptAccount: GoldenCoastPhase10CashAccount;
  reference: string | null;
}

export interface GoldenCoastPhase10SettlementPlan extends GoldenCoastPhase10SettlementInput {
  gcSalesCashDebitBalanceBeforeUsd: string;
  gcSalesCashDebitBalanceAfterUsd: string;
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new GoldenCoastPhase10SettlementError(`${field} must be a positive integer`);
  }
  return id;
}

function decimal(value: unknown, field: string): Decimal {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new GoldenCoastPhase10SettlementError(`${field} must be a number or numeric string`);
  }
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error("not finite");
    return parsed;
  } catch {
    throw new GoldenCoastPhase10SettlementError(`${field} must be a finite number`);
  }
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

function positiveMoney(value: unknown, field: string): Decimal {
  const parsed = decimal(value, field);
  if (!parsed.greaterThan(0)) {
    throw new GoldenCoastPhase10SettlementError(`${field} must be greater than zero`);
  }
  if (parsed.decimalPlaces() > MONEY_SCALE) {
    throw new GoldenCoastPhase10SettlementError(`${field} supports at most ${MONEY_SCALE} decimal places`);
  }
  return parsed;
}

function balanceMoney(value: unknown, field: string): Decimal {
  const parsed = decimal(value, field);
  if (parsed.decimalPlaces() > 6) {
    throw new GoldenCoastPhase10SettlementError(`${field} has unsupported precision`, "GC_PHASE10_BALANCE_INVALID");
  }
  return parsed;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new GoldenCoastPhase10SettlementError(`${field} is required`);
  if (text.length > maxLength) {
    throw new GoldenCoastPhase10SettlementError(`${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new GoldenCoastPhase10SettlementError(`${field} must be a string`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new GoldenCoastPhase10SettlementError(`${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function settlementDate(value: unknown): string {
  const text = requiredText(value, "settlementDate", 10);
  if (!ISO_DATE_PATTERN.test(text)) {
    throw new GoldenCoastPhase10SettlementError("settlementDate must be an ISO calendar date (YYYY-MM-DD)");
  }
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new GoldenCoastPhase10SettlementError("settlementDate must be an ISO calendar date (YYYY-MM-DD)");
  }
  if (text < GOLDEN_COAST_CUTOVER_DATE) {
    throw new GoldenCoastPhase10SettlementError(
      `settlementDate cannot be earlier than the Golden Coast cutover date ${GOLDEN_COAST_CUTOVER_DATE}`,
      "GC_PHASE10_PRE_CUTOVER_DATE"
    );
  }
  return text;
}

function clientRequestId(value: unknown): string {
  const text = requiredText(value, "clientRequestId", GOLDEN_COAST_PHASE10_MAX_REQUEST_ID_LENGTH);
  if (!REQUEST_ID_PATTERN.test(text)) {
    throw new GoldenCoastPhase10SettlementError("clientRequestId contains unsupported characters");
  }
  return text;
}

function cashAccount(value: unknown): GoldenCoastPhase10CashAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoldenCoastPhase10SettlementError("receiptAccount is required");
  }
  const input = value as Record<string, unknown>;
  if (input.kind !== "ledger" && input.kind !== "bank") {
    throw new GoldenCoastPhase10SettlementError('receiptAccount.kind must be "ledger" or "bank"');
  }
  return { kind: input.kind, id: positiveId(input.id, "receiptAccount.id") };
}

/** Parse immutable request data before any mutable balance check. */
export function parseGoldenCoastPhase10SettlementInput(input: {
  companyId: number;
  body: unknown;
}): GoldenCoastPhase10SettlementInput {
  const companyId = positiveId(input.companyId, "companyId");
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
    throw new GoldenCoastPhase10SettlementError("A Phase 10 sales cash settlement request body is required");
  }
  const raw = input.body as Record<string, unknown>;
  return {
    companyId,
    settlementDate: settlementDate(raw.settlementDate),
    amountUsd: money(positiveMoney(raw.amountUsd, "amountUsd")),
    clientRequestId: clientRequestId(raw.clientRequestId),
    receiptAccount: cashAccount(raw.receiptAccount),
    reference: optionalText(raw.reference, "reference", 200),
  };
}

/**
 * A direct settlement may be partial, but it can never clear more than the
 * positive Dr-minus-Cr balance currently carried by GC Sales Cash.
 */
export function planGoldenCoastPhase10Settlement(input: {
  settlement: GoldenCoastPhase10SettlementInput;
  gcSalesCashDebitBalanceUsd: string | number;
}): GoldenCoastPhase10SettlementPlan {
  const amount = positiveMoney(input.settlement.amountUsd, "amountUsd");
  const balance = balanceMoney(input.gcSalesCashDebitBalanceUsd, "gcSalesCashDebitBalanceUsd");
  const collectible = Decimal.max(balance, 0);
  if (amount.greaterThan(collectible)) {
    throw new GoldenCoastPhase10SettlementError(
      `Settlement ${money(amount)} exceeds the current collectible GC Sales Cash balance ${money(collectible)}`,
      "GC_PHASE10_SETTLEMENT_EXCEEDS_BALANCE"
    );
  }
  return {
    ...input.settlement,
    gcSalesCashDebitBalanceBeforeUsd: money(balance),
    gcSalesCashDebitBalanceAfterUsd: money(balance.minus(amount)),
  };
}

export function goldenCoastPhase10SettlementDigest(input: {
  settlement: GoldenCoastPhase10SettlementInput;
  gcSalesCashAccountId: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        companyId: input.settlement.companyId,
        settlementDate: input.settlement.settlementDate,
        amountUsd: money(positiveMoney(input.settlement.amountUsd, "amountUsd")),
        clientRequestId: input.settlement.clientRequestId,
        receiptAccount: input.settlement.receiptAccount,
        reference: input.settlement.reference,
        gcSalesCashAccountId: positiveId(input.gcSalesCashAccountId, "gcSalesCashAccountId"),
      })
    )
    .digest("hex")
    .slice(0, 32);
}

export function goldenCoastPhase10IdempotencyKey(companyId: number, requestId: string): string {
  return `${GOLDEN_COAST_PHASE10_SOURCE_TYPE}:${positiveId(companyId, "companyId")}:${clientRequestId(requestId)}`;
}

export function goldenCoastPhase10SourceId(settlementDigest: string): string {
  const digest = requiredText(settlementDigest, "settlementDigest", 64);
  return `settlement:${digest}`;
}

function cashTarget(account: GoldenCoastPhase10CashAccount): Record<string, number> {
  return account.kind === "bank" ? { bankAccountId: account.id } : { ledgerAccountId: account.id };
}

/** Dr selected Golden Coast Cash/Bank / Cr canonical GC Sales Cash. */
export function buildGoldenCoastPhase10SettlementPosting(input: {
  plan: GoldenCoastPhase10SettlementPlan;
  gcSalesCashAccountId: number;
  settlementDigest: string;
  exchangeRate?: string | null;
  actor?: PostingActor;
}): CentralPostingRequest {
  const gcSalesCashAccountId = positiveId(input.gcSalesCashAccountId, "gcSalesCashAccountId");
  const description = releaseDebtEnglish(
    `GC Sales Cash settlement${input.plan.reference ? ` — ${input.plan.reference}` : ""}`
  );
  const posting = buildGenericVoucherPostingRequest({
    companyId: input.plan.companyId,
    clientRequestId: input.plan.clientRequestId,
    voucher: {
      voucherNumber: `GC-SCS-C${input.plan.companyId}-${input.plan.clientRequestId}`,
      voucherType: "Receipt",
      voucherDate: input.plan.settlementDate,
      description,
      currency: "USD",
    },
    entries: [
      {
        ...cashTarget(input.plan.receiptAccount),
        debitAmount: input.plan.amountUsd,
        creditAmount: "0",
        narration: description,
      },
      {
        ledgerAccountId: gcSalesCashAccountId,
        debitAmount: "0",
        creditAmount: input.plan.amountUsd,
        narration: description,
      },
    ],
    exchangeRate: input.exchangeRate ?? null,
    actor: input.actor,
  });

  return {
    ...posting.request,
    source: {
      sourceType: GOLDEN_COAST_PHASE10_SOURCE_TYPE,
      sourceId: goldenCoastPhase10SourceId(input.settlementDigest),
      idempotencyKey: goldenCoastPhase10IdempotencyKey(input.plan.companyId, input.plan.clientRequestId),
    },
  };
}
