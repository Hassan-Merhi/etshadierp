import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";
import type { CentralPostingRequest, PostingActor } from "./centralPostingEngine";
import { buildGenericVoucherPostingRequest } from "./genericVoucherPosting";
import { GOLDEN_COAST_CUTOVER_DATE } from "./goldenCoastPhase4CutoverFifo";

/**
 * Golden Coast Phase 7 owns physical cash routing through the configured HADI
 * parent company. The GC Sales Cash role is a payable to Fresh Start, while the
 * Golden Coast HADI intercompany role is the asset representing money HADI is
 * holding/using for Golden Coast.
 */
export const GOLDEN_COAST_PHASE7_SOURCE_TYPE = "golden-coast-phase7-hadi-transfer";
export const GOLDEN_COAST_PHASE7_MAX_REQUEST_ID_LENGTH = 64;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_SCALE = 2;

export type GoldenCoastPhase7Operation =
  | "collect_via_hadi"
  | "remit_from_hadi"
  | "pay_fresh_start_from_hadi";
export type GoldenCoastPhase7PostingRole = "golden_coast" | "hadi";

export type GoldenCoastPhase7ErrorCode =
  | "GC_PHASE7_INPUT_INVALID"
  | "GC_PHASE7_PRE_CUTOVER_DATE"
  | "GC_PHASE7_COLLECTION_EXCEEDS_BALANCE"
  | "GC_PHASE7_REMITTANCE_EXCEEDS_COLLECTIONS"
  | "GC_PHASE7_PAYMENT_EXCEEDS_PAYABLE"
  | "GC_PHASE7_SCOPE_INVALID";

export class GoldenCoastPhase7TransferError extends Error {
  readonly code: GoldenCoastPhase7ErrorCode;

  constructor(message: string, code: GoldenCoastPhase7ErrorCode = "GC_PHASE7_INPUT_INVALID") {
    super(releaseDebtEnglish(message));
    this.name = "GoldenCoastPhase7TransferError";
    this.code = code;
  }
}

export interface GoldenCoastPhase7CashAccount {
  kind: "ledger" | "bank";
  id: number;
}

export interface GoldenCoastPhase7TransferInput {
  companyId: number;
  parentCompanyId: number;
  operation: GoldenCoastPhase7Operation;
  transferDate: string;
  amountUsd: string;
  clientRequestId: string;
  reference: string | null;
  /** Physical HADI cash/bank account receiving or sending the money. */
  hadiCashAccount: GoldenCoastPhase7CashAccount;
  /** Required only when HADI remits physical cash back to Golden Coast. */
  goldenCoastCashAccount: GoldenCoastPhase7CashAccount | null;
}

export interface GoldenCoastPhase7Balances {
  /** Signed Dr-minus-Cr balance on canonical GC Sales Cash. Negative means payable. */
  gcSalesCashDebitBalanceUsd: string | number;
  /** Phase-7 HADI collections not yet returned to GC or used to pay Fresh Start. */
  outstandingHadiCollectionsUsd: string | number;
}

export interface GoldenCoastPhase7TransferPlan extends GoldenCoastPhase7TransferInput {
  gcSalesCashDebitBalanceBeforeUsd: string;
  gcSalesCashDebitBalanceAfterUsd: string;
  outstandingHadiCollectionsBeforeUsd: string;
  outstandingHadiCollectionsAfterUsd: string;
}

export interface GoldenCoastPhase7RoleAccounts {
  gcSalesCashAccountId: number;
  goldenCoastHadiIntercompanyAccountId: number;
  hadiGoldenCoastIntercompanyAccountId: number;
}

export interface GoldenCoastPhase7Posting {
  role: GoldenCoastPhase7PostingRole;
  request: CentralPostingRequest;
}

export interface GoldenCoastPhase7PostingBatch {
  clientRequestId: string;
  transferDigest: string;
  postings: GoldenCoastPhase7Posting[];
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new GoldenCoastPhase7TransferError(`${field} must be a positive integer`);
  }
  return id;
}

function decimal(value: unknown, field: string): Decimal {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new GoldenCoastPhase7TransferError(`${field} must be a number or numeric string`);
  }
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error("not finite");
    return parsed;
  } catch {
    throw new GoldenCoastPhase7TransferError(`${field} must be a finite number`);
  }
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

function positiveMoney(value: unknown, field: string): Decimal {
  const parsed = decimal(value, field);
  if (!parsed.greaterThan(0)) {
    throw new GoldenCoastPhase7TransferError(`${field} must be greater than zero`);
  }
  if (parsed.decimalPlaces() > MONEY_SCALE) {
    throw new GoldenCoastPhase7TransferError(`${field} supports at most ${MONEY_SCALE} decimal places`);
  }
  return parsed;
}

function balanceMoney(value: unknown, field: string): Decimal {
  const parsed = decimal(value, field);
  if (parsed.decimalPlaces() > 6) {
    throw new GoldenCoastPhase7TransferError(`${field} has unsupported precision`);
  }
  return parsed;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new GoldenCoastPhase7TransferError(`${field} is required`);
  if (text.length > maxLength) {
    throw new GoldenCoastPhase7TransferError(`${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new GoldenCoastPhase7TransferError(`${field} must be a string`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new GoldenCoastPhase7TransferError(`${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function transferDate(value: unknown): string {
  const text = requiredText(value, "transferDate", 10);
  const match = ISO_DATE_PATTERN.exec(text);
  if (!match) {
    throw new GoldenCoastPhase7TransferError("transferDate must be an ISO calendar date (YYYY-MM-DD)");
  }

  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new GoldenCoastPhase7TransferError("transferDate must be an ISO calendar date (YYYY-MM-DD)");
  }

  if (text < GOLDEN_COAST_CUTOVER_DATE) {
    throw new GoldenCoastPhase7TransferError(
      `transferDate cannot be earlier than the Golden Coast cutover date ${GOLDEN_COAST_CUTOVER_DATE}`,
      "GC_PHASE7_PRE_CUTOVER_DATE"
    );
  }
  return text;
}

function clientRequestId(value: unknown): string {
  const text = requiredText(value, "clientRequestId", GOLDEN_COAST_PHASE7_MAX_REQUEST_ID_LENGTH);
  if (!REQUEST_ID_PATTERN.test(text)) {
    throw new GoldenCoastPhase7TransferError("clientRequestId contains unsupported characters");
  }
  return text;
}

function cashAccount(value: unknown, field: string): GoldenCoastPhase7CashAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoldenCoastPhase7TransferError(`${field} is required`);
  }
  const input = value as Record<string, unknown>;
  if (input.kind !== "ledger" && input.kind !== "bank") {
    throw new GoldenCoastPhase7TransferError(`${field}.kind must be "ledger" or "bank"`);
  }
  return { kind: input.kind, id: positiveId(input.id, `${field}.id`) };
}

/**
 * Parse the transport payload without consulting mutable balances. Replay
 * detection must happen before balance checks, otherwise a valid replay could
 * be rejected simply because its original posting already changed the balance.
 */
export function parseGoldenCoastPhase7TransferInput(input: {
  companyId: number;
  parentCompanyId: number;
  body: unknown;
}): GoldenCoastPhase7TransferInput {
  const companyId = positiveId(input.companyId, "companyId");
  const parentCompanyId = positiveId(input.parentCompanyId, "parentCompanyId");
  if (companyId === parentCompanyId) {
    throw new GoldenCoastPhase7TransferError(
      "Golden Coast and HADI must be different companies",
      "GC_PHASE7_SCOPE_INVALID"
    );
  }
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
    throw new GoldenCoastPhase7TransferError("A Phase 7 transfer request body is required");
  }
  const raw = input.body as Record<string, unknown>;
  if (
    raw.operation !== "collect_via_hadi" &&
    raw.operation !== "remit_from_hadi" &&
    raw.operation !== "pay_fresh_start_from_hadi"
  ) {
    throw new GoldenCoastPhase7TransferError(
      'operation must be "collect_via_hadi", "remit_from_hadi", or "pay_fresh_start_from_hadi"'
    );
  }

  const operation = raw.operation;
  const goldenCoastCashAccount =
    operation === "remit_from_hadi" ? cashAccount(raw.goldenCoastCashAccount, "goldenCoastCashAccount") : null;
  if (operation !== "remit_from_hadi" && raw.goldenCoastCashAccount != null) {
    throw new GoldenCoastPhase7TransferError(
      "goldenCoastCashAccount is only allowed when HADI remits cash back to Golden Coast"
    );
  }

  return {
    companyId,
    parentCompanyId,
    operation,
    transferDate: transferDate(raw.transferDate),
    amountUsd: money(positiveMoney(raw.amountUsd, "amountUsd")),
    clientRequestId: clientRequestId(raw.clientRequestId),
    reference: optionalText(raw.reference, "reference", 200),
    hadiCashAccount: cashAccount(raw.hadiCashAccount, "hadiCashAccount"),
    goldenCoastCashAccount,
  };
}

/**
 * Apply balance rules for a new (non-replay) transfer.
 *
 * `collect_via_hadi` records additional sale cash now held by HADI and increases
 * the GC Sales Cash payable. It is intentionally not capped by an existing
 * debit balance: the current Golden Coast model treats GC Sales Cash as a
 * liability, not as a receivable that HADI collection clears.
 *
 * `pay_fresh_start_from_hadi` is the settlement operation the business needs:
 * HADI pays Fresh Start on GC's behalf, so both the GC payable and HADI-held
 * intercompany asset fall by the same amount.
 */
export function planGoldenCoastPhase7Transfer(input: {
  transfer: GoldenCoastPhase7TransferInput;
  balances: GoldenCoastPhase7Balances;
}): GoldenCoastPhase7TransferPlan {
  const amount = positiveMoney(input.transfer.amountUsd, "amountUsd");
  const gcSalesCashBalance = balanceMoney(input.balances.gcSalesCashDebitBalanceUsd, "gcSalesCashDebitBalanceUsd");
  const outstanding = balanceMoney(input.balances.outstandingHadiCollectionsUsd, "outstandingHadiCollectionsUsd");
  if (outstanding.lessThan(0)) {
    throw new GoldenCoastPhase7TransferError(
      "Phase 7 HADI collection history is inconsistent: uses exceed collections",
      "GC_PHASE7_SCOPE_INVALID"
    );
  }

  if (input.transfer.operation === "collect_via_hadi") {
    return {
      ...input.transfer,
      gcSalesCashDebitBalanceBeforeUsd: money(gcSalesCashBalance),
      gcSalesCashDebitBalanceAfterUsd: money(gcSalesCashBalance.minus(amount)),
      outstandingHadiCollectionsBeforeUsd: money(outstanding),
      outstandingHadiCollectionsAfterUsd: money(outstanding.plus(amount)),
    };
  }

  if (amount.greaterThan(outstanding)) {
    throw new GoldenCoastPhase7TransferError(
      `${input.transfer.operation === "pay_fresh_start_from_hadi" ? "Fresh Start payment" : "Remittance"} ${money(
        amount
      )} exceeds HADI-held Golden Coast sales cash ${money(outstanding)}`,
      "GC_PHASE7_REMITTANCE_EXCEEDS_COLLECTIONS"
    );
  }

  if (input.transfer.operation === "pay_fresh_start_from_hadi") {
    const payable = Decimal.max(gcSalesCashBalance.negated(), 0);
    if (amount.greaterThan(payable)) {
      throw new GoldenCoastPhase7TransferError(
        `Fresh Start payment ${money(amount)} exceeds the current GC Sales Cash payable ${money(payable)}`,
        "GC_PHASE7_PAYMENT_EXCEEDS_PAYABLE"
      );
    }
    return {
      ...input.transfer,
      gcSalesCashDebitBalanceBeforeUsd: money(gcSalesCashBalance),
      gcSalesCashDebitBalanceAfterUsd: money(gcSalesCashBalance.plus(amount)),
      outstandingHadiCollectionsBeforeUsd: money(outstanding),
      outstandingHadiCollectionsAfterUsd: money(outstanding.minus(amount)),
    };
  }

  return {
    ...input.transfer,
    gcSalesCashDebitBalanceBeforeUsd: money(gcSalesCashBalance),
    gcSalesCashDebitBalanceAfterUsd: money(gcSalesCashBalance),
    outstandingHadiCollectionsBeforeUsd: money(outstanding),
    outstandingHadiCollectionsAfterUsd: money(outstanding.minus(amount)),
  };
}

export function goldenCoastPhase7TransferDigest(input: {
  transfer: GoldenCoastPhase7TransferInput;
  accounts: GoldenCoastPhase7RoleAccounts;
}): string {
  const { transfer, accounts } = input;
  const canonicalAccounts: GoldenCoastPhase7RoleAccounts = {
    gcSalesCashAccountId: positiveId(accounts.gcSalesCashAccountId, "gcSalesCashAccountId"),
    goldenCoastHadiIntercompanyAccountId: positiveId(
      accounts.goldenCoastHadiIntercompanyAccountId,
      "goldenCoastHadiIntercompanyAccountId"
    ),
    hadiGoldenCoastIntercompanyAccountId: positiveId(
      accounts.hadiGoldenCoastIntercompanyAccountId,
      "hadiGoldenCoastIntercompanyAccountId"
    ),
  };

  return createHash("sha256")
    .update(
      JSON.stringify({
        companyId: transfer.companyId,
        parentCompanyId: transfer.parentCompanyId,
        operation: transfer.operation,
        transferDate: transfer.transferDate,
        amountUsd: new Decimal(transfer.amountUsd).toFixed(MONEY_SCALE),
        reference: transfer.reference,
        hadiCashAccount: transfer.hadiCashAccount,
        goldenCoastCashAccount: transfer.goldenCoastCashAccount,
        accounts: canonicalAccounts,
      })
    )
    .digest("hex")
    .slice(0, 32);
}

export function goldenCoastPhase7SourceId(
  operation: GoldenCoastPhase7Operation,
  transferDigest: string,
  role: GoldenCoastPhase7PostingRole
): string {
  const digest = requiredText(transferDigest, "transferDigest", 64);
  // Outstanding-HADI history historically subtracts `remit_from_hadi` source
  // rows. A Fresh Start payment is also a use of HADI-held GC cash, so keep the
  // same history prefix while the voucher narration retains the exact purpose.
  const historyOperation = operation === "pay_fresh_start_from_hadi" ? "remit_from_hadi" : operation;
  return `${historyOperation}:${digest}:${role}`;
}

export function goldenCoastPhase7IdempotencyKey(
  companyId: number,
  requestId: string,
  role: GoldenCoastPhase7PostingRole
): string {
  return `${GOLDEN_COAST_PHASE7_SOURCE_TYPE}:${positiveId(companyId, "companyId")}:${clientRequestId(requestId)}:${role}`;
}

function cashTarget(account: GoldenCoastPhase7CashAccount): Record<string, number> {
  return account.kind === "bank" ? { bankAccountId: account.id } : { ledgerAccountId: account.id };
}

function taggedRequest(input: {
  request: CentralPostingRequest;
  transfer: GoldenCoastPhase7TransferInput;
  transferDigest: string;
  role: GoldenCoastPhase7PostingRole;
}): CentralPostingRequest {
  return {
    ...input.request,
    source: {
      sourceType: GOLDEN_COAST_PHASE7_SOURCE_TYPE,
      sourceId: goldenCoastPhase7SourceId(input.transfer.operation, input.transferDigest, input.role),
      idempotencyKey: goldenCoastPhase7IdempotencyKey(
        input.transfer.companyId,
        input.transfer.clientRequestId,
        input.role
      ),
    },
  };
}

/**
 * Build the two-company accounting pair. Both vouchers must be persisted in the
 * caller's single database transaction.
 *
 * collect_via_hadi:
 *   Golden Coast  Dr HADI Intercompany / Cr GC Sales Cash
 *   HADI          Dr Cash/Bank         / Cr Golden Coast Intercompany
 *
 * remit_from_hadi:
 *   Golden Coast  Dr Cash/Bank         / Cr HADI Intercompany
 *   HADI          Dr Golden Coast IC   / Cr Cash/Bank
 *
 * pay_fresh_start_from_hadi:
 *   Golden Coast  Dr GC Sales Cash     / Cr HADI Intercompany
 *   HADI          Dr Golden Coast IC   / Cr Cash/Bank
 */
export function buildGoldenCoastPhase7TransferPostings(input: {
  plan: GoldenCoastPhase7TransferPlan;
  accounts: GoldenCoastPhase7RoleAccounts;
  transferDigest: string;
  goldenCoastExchangeRate: string | null;
  hadiExchangeRate: string | null;
  actor?: PostingActor;
}): GoldenCoastPhase7PostingBatch {
  const { plan, accounts } = input;
  positiveId(accounts.gcSalesCashAccountId, "gcSalesCashAccountId");
  positiveId(accounts.goldenCoastHadiIntercompanyAccountId, "goldenCoastHadiIntercompanyAccountId");
  positiveId(accounts.hadiGoldenCoastIntercompanyAccountId, "hadiGoldenCoastIntercompanyAccountId");
  if (accounts.gcSalesCashAccountId === accounts.goldenCoastHadiIntercompanyAccountId) {
    throw new GoldenCoastPhase7TransferError(
      "GC Sales Cash and the Golden Coast HADI intercompany role must resolve to distinct accounts",
      "GC_PHASE7_SCOPE_INVALID"
    );
  }

  const amountUsd = money(positiveMoney(plan.amountUsd, "amountUsd"));
  const suffix =
    plan.operation === "collect_via_hadi"
      ? "COLLECT"
      : plan.operation === "pay_fresh_start_from_hadi"
        ? "PAY-FRESH"
        : "REMIT";
  const gcVoucherNumber = `GC-P7-C${plan.companyId}-${plan.clientRequestId}-${suffix}`;
  const hadiVoucherNumber = `GC-P7-C${plan.companyId}-${plan.clientRequestId}-${suffix}-HADI`;
  const referenceSuffix = plan.reference ? ` — ${plan.reference}` : "";
  const gcDescription = releaseDebtEnglish(
    plan.operation === "collect_via_hadi"
      ? `Golden Coast sales cash placed with HADI${referenceSuffix}`
      : plan.operation === "pay_fresh_start_from_hadi"
        ? `Fresh Start paid by HADI for Golden Coast${referenceSuffix}`
        : `HADI cash remittance to Golden Coast${referenceSuffix}`
  );
  const hadiDescription = releaseDebtEnglish(
    plan.operation === "collect_via_hadi"
      ? `Cash held for Golden Coast${referenceSuffix}`
      : plan.operation === "pay_fresh_start_from_hadi"
        ? `Fresh Start payment for Golden Coast${referenceSuffix}`
        : `Cash remitted to Golden Coast${referenceSuffix}`
  );

  let goldenCoastEntries: Array<Record<string, unknown>>;
  if (plan.operation === "collect_via_hadi") {
    goldenCoastEntries = [
      {
        ledgerAccountId: accounts.goldenCoastHadiIntercompanyAccountId,
        debitAmount: amountUsd,
        creditAmount: "0",
        narration: gcDescription,
      },
      {
        ledgerAccountId: accounts.gcSalesCashAccountId,
        debitAmount: "0",
        creditAmount: amountUsd,
        narration: gcDescription,
      },
    ];
  } else if (plan.operation === "pay_fresh_start_from_hadi") {
    goldenCoastEntries = [
      {
        ledgerAccountId: accounts.gcSalesCashAccountId,
        debitAmount: amountUsd,
        creditAmount: "0",
        narration: gcDescription,
      },
      {
        ledgerAccountId: accounts.goldenCoastHadiIntercompanyAccountId,
        debitAmount: "0",
        creditAmount: amountUsd,
        narration: gcDescription,
      },
    ];
  } else {
    goldenCoastEntries = [
      {
        ...cashTarget(plan.goldenCoastCashAccount as GoldenCoastPhase7CashAccount),
        debitAmount: amountUsd,
        creditAmount: "0",
        narration: gcDescription,
      },
      {
        ledgerAccountId: accounts.goldenCoastHadiIntercompanyAccountId,
        debitAmount: "0",
        creditAmount: amountUsd,
        narration: gcDescription,
      },
    ];
  }

  const hadiEntries =
    plan.operation === "collect_via_hadi"
      ? [
          {
            ...cashTarget(plan.hadiCashAccount),
            debitAmount: amountUsd,
            creditAmount: "0",
            narration: hadiDescription,
          },
          {
            ledgerAccountId: accounts.hadiGoldenCoastIntercompanyAccountId,
            debitAmount: "0",
            creditAmount: amountUsd,
            narration: hadiDescription,
          },
        ]
      : [
          {
            ledgerAccountId: accounts.hadiGoldenCoastIntercompanyAccountId,
            debitAmount: amountUsd,
            creditAmount: "0",
            narration: hadiDescription,
          },
          {
            ...cashTarget(plan.hadiCashAccount),
            debitAmount: "0",
            creditAmount: amountUsd,
            narration: hadiDescription,
          },
        ];

  const goldenCoastPosting = buildGenericVoucherPostingRequest({
    companyId: plan.companyId,
    clientRequestId: plan.clientRequestId,
    voucher: {
      voucherNumber: gcVoucherNumber,
      voucherType: "Journal",
      voucherDate: plan.transferDate,
      description: gcDescription,
      currency: "USD",
    },
    entries: goldenCoastEntries,
    exchangeRate: input.goldenCoastExchangeRate,
    actor: input.actor,
  });

  const hadiPosting = buildGenericVoucherPostingRequest({
    companyId: plan.parentCompanyId,
    clientRequestId: plan.clientRequestId,
    voucher: {
      voucherNumber: hadiVoucherNumber,
      voucherType: "Journal",
      voucherDate: plan.transferDate,
      description: hadiDescription,
      currency: "USD",
    },
    entries: hadiEntries,
    exchangeRate: input.hadiExchangeRate,
    actor: input.actor,
  });

  return {
    clientRequestId: plan.clientRequestId,
    transferDigest: input.transferDigest,
    postings: [
      {
        role: "golden_coast",
        request: taggedRequest({
          request: goldenCoastPosting.request,
          transfer: plan,
          transferDigest: input.transferDigest,
          role: "golden_coast",
        }),
      },
      {
        role: "hadi",
        request: taggedRequest({
          request: hadiPosting.request,
          transfer: plan,
          transferDigest: input.transferDigest,
          role: "hadi",
        }),
      },
    ],
  };
}
