import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import {
  accountingPostingRequests,
  bankAccounts,
  companies,
  ledgerAccounts,
  locations,
  salesItems,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import type { DbTransaction } from "../../db";
import { assertTransactionCompanyScope } from "../security/transactionCompanyScope";
import { getGoldenCoastAccountDefinition } from "../accounting/goldenCoastPhase2Accounts";
import { buildGenericVoucherPostingRequest } from "../accounting/genericVoucherPosting";
import {
  postBalancedVoucherTx,
  type CentralPostingResult,
  type PostingActor,
  type CentralPostingRequest,
} from "../accounting/centralPostingEngine";
import { createDatabasePostingDependencies } from "../accounting/databasePostingDependencies";

/**
 * The standard POS sale remains the source document. These postings bridge the
 * itemized POS document into Golden Coast's partner-capital, P&L and HADI cash
 * model without changing the source voucher itself.
 *
 * Economic model:
 *   - the full customer sale becomes a distribution out of Fresh Start equity;
 *   - Sales/COGS carry the current-period result until the 50/50 monthly close;
 *   - GC Sales Cash remains the payable created by the normal SP POS voucher;
 *   - physical cash is moved to HADI and becomes a Golden Coast intercompany asset.
 *
 * They intentionally use a separate source type so legacy Phase 5/6 vouchers
 * are never mistaken for the new itemized POS flow.
 */
export const GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE = "golden-coast-pos-settlement";

type PersistedPostingResult = CentralPostingResult<typeof vouchers.$inferSelect, typeof voucherEntries.$inferSelect>;
type CashTarget = { kind: "ledger" | "bank"; id: number; name: string };
type SettlementRole =
  | "capital_revenue"
  | "sale_cogs"
  | "payable_reclass"
  | "gc_cash_transfer"
  | "hadi_cash_receipt";

const postingDependencies = createDatabasePostingDependencies();

function money(value: number | string): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function digest(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

function sourceId(clientSaleId: string, saleDigest: string, revision: string, role: SettlementRole): string {
  return `${clientSaleId}:${saleDigest}:${revision}:${role}`;
}

function idempotencyKey(companyId: number, clientSaleId: string, revision: string, role: SettlementRole): string {
  return `${GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE}:${companyId}:${clientSaleId}:${revision}:${role}`;
}

function target(account: CashTarget): Record<string, number> {
  return account.kind === "bank" ? { bankAccountId: account.id } : { ledgerAccountId: account.id };
}

async function activeSingleAccount(
  tx: DbTransaction,
  companyId: number,
  subType: string,
  label: string,
  accountTypes?: readonly string[]
): Promise<{ id: number; name: string }> {
  const rows = await tx
    .select({ id: ledgerAccounts.id, name: ledgerAccounts.name, accountType: ledgerAccounts.accountType })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.subType, subType),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    )
    .orderBy(asc(ledgerAccounts.id))
    .limit(2);
  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? `${label} is not configured for company ${companyId}`
        : `${label} is ambiguous; repair duplicate active ${subType} accounts first`
    );
  }
  if (accountTypes && !accountTypes.includes(rows[0].accountType)) {
    throw new Error(`${label} must have account type ${accountTypes.join(" or ")}`);
  }
  return { id: Number(rows[0].id), name: String(rows[0].name) };
}

async function resolveCashTarget(
  tx: DbTransaction,
  companyId: number,
  kind: "cash" | "bank",
  accountId: number
): Promise<CashTarget> {
  if (kind === "bank") {
    const [row] = await tx
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, accountId),
          eq(bankAccounts.companyId, companyId),
          eq(bankAccounts.active, true),
          isNull(bankAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!row) throw new Error(`Payment bank account ${accountId} is not active in company ${companyId}`);
    return { kind, id: Number(row.id), name: String(row.name) };
  }

  const [row] = await tx
    .select({ id: ledgerAccounts.id, name: ledgerAccounts.name, accountType: ledgerAccounts.accountType })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.id, accountId),
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt),
        inArray(ledgerAccounts.accountType, ["Cash", "Bank"])
      )
    )
    .limit(1);
  if (!row) throw new Error(`Payment cash account ${accountId} is not active in company ${companyId}`);
  return { kind: "ledger", id: Number(row.id), name: String(row.name) };
}

async function findMatchingHadiCashTarget(tx: DbTransaction, companyId: number, name: string): Promise<CashTarget> {
  const [ledger] = await tx
    .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        ilike(ledgerAccounts.name, name),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt),
        inArray(ledgerAccounts.accountType, ["Cash", "Bank"])
      )
    )
    .orderBy(asc(ledgerAccounts.id))
    .limit(1);
  if (ledger) return { kind: "ledger", id: Number(ledger.id), name: String(ledger.name) };

  const [bank] = await tx
    .select({ id: bankAccounts.id, name: bankAccounts.name })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.companyId, companyId),
        ilike(bankAccounts.name, name),
        eq(bankAccounts.active, true),
        isNull(bankAccounts.deletedAt)
      )
    )
    .orderBy(asc(bankAccounts.id))
    .limit(1);
  if (bank) return { kind: "bank", id: Number(bank.id), name: String(bank.name) };
  throw new Error(`HADI has no active Cash/Bank account named "${name}" to receive Golden Coast POS cash`);
}

async function findHadiPostingLocation(tx: DbTransaction, companyId: number): Promise<number> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
    .orderBy(asc(locations.id))
    .limit(1);
  if (!location) throw new Error("HADI has no active location for the Golden Coast POS cash receipt");
  return Number(location.id);
}

async function resolvePair(tx: DbTransaction, companyId: number): Promise<{ parentCompanyId: number }> {
  const [company] = await tx
    .select({ parentCompanyId: companies.parentCompanyId, active: companies.active })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const parentCompanyId = Number(company?.parentCompanyId ?? 0);
  if (!company?.active || !Number.isInteger(parentCompanyId) || parentCompanyId <= 0 || parentCompanyId === companyId) {
    throw new Error("Golden Coast must have an active, distinct parent HADI company");
  }
  const [parent] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, parentCompanyId), eq(companies.active, true)))
    .limit(1);
  if (!parent) throw new Error("Golden Coast parent HADI company is missing or inactive");
  return { parentCompanyId };
}

async function itemizedSaleCostUsd(tx: DbTransaction, companyId: number, clientSaleId: string): Promise<string> {
  const [row] = await tx
    .select({
      totalCost: sql<string>`COALESCE(SUM(CAST(${salesItems.totalCost} AS numeric)), 0)::text`,
    })
    .from(salesItems)
    .innerJoin(vouchers, eq(vouchers.id, salesItems.voucherId))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(vouchers.clientSaleId, clientSaleId),
        eq(vouchers.voucherType, "Sales"),
        isNull(vouchers.deletedAt)
      )
    );
  return money(String(row?.totalCost ?? "0"));
}

async function buildPosting(input: {
  companyId: number;
  locationId: number | null;
  voucherDate: string;
  voucherNumber: string;
  description: string;
  amount: string;
  clientRequestId: string;
  sourceId: string;
  idempotencyKey: string;
  entries: Array<Record<string, unknown>>;
  actor?: PostingActor;
}): Promise<CentralPostingRequest> {
  const built = buildGenericVoucherPostingRequest({
    companyId: input.companyId,
    clientRequestId: input.clientRequestId,
    voucher: {
      locationId: input.locationId,
      voucherNumber: input.voucherNumber,
      voucherType: "Journal",
      voucherDate: input.voucherDate,
      description: input.description,
      currency: "USD",
    },
    entries: input.entries,
    exchangeRate: null,
    actor: input.actor,
  });
  return {
    ...built.request,
    voucher: { ...built.request.voucher, totalAmount: input.amount },
    source: {
      sourceType: GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
    },
  };
}

/**
 * Returns true only for a fully provisioned Golden Coast company. This is
 * deliberately local to the POS service so the POS route does not import a
 * route module just to classify a company.
 */
export async function isGoldenCoastPosCompany(tx: DbTransaction, companyId: number): Promise<boolean> {
  const rows = await tx
    .select({ subType: ledgerAccounts.subType })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        inArray(ledgerAccounts.subType, ["gc_partner_capital", "gc_owner_capital"]),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    );
  const roles = new Set(rows.map((row) => row.subType));
  return roles.has("gc_partner_capital") && roles.has("gc_owner_capital");
}

export async function postGoldenCoastPosAccountingTx(input: {
  tx: DbTransaction;
  companyId: number;
  locationId: number;
  clientSaleId: string;
  revision: string;
  saleDate: string;
  amountUsd: number;
  paymentAccountType: "cash" | "bank";
  paymentAccountId: number;
  supplierPayableAccountId: number;
  payableAmountUsd: number;
  actor?: PostingActor;
}): Promise<void> {
  if (!input.clientSaleId?.trim()) throw new Error("Golden Coast POS requires clientSaleId for settlement idempotency");
  if (input.amountUsd <= 0) return;

  const { tx, companyId } = input;
  const { parentCompanyId } = await resolvePair(tx, companyId);
  await assertTransactionCompanyScope(tx, companyId);
  const sourceCash = await resolveCashTarget(tx, companyId, input.paymentAccountType, input.paymentAccountId);
  const gcSalesCash = await activeSingleAccount(
    tx,
    companyId,
    getGoldenCoastAccountDefinition("gc_sales_cash").subType,
    "GC Sales Cash",
    getGoldenCoastAccountDefinition("gc_sales_cash").acceptedAccountTypes
  );
  const freshStartEquity = await activeSingleAccount(
    tx,
    companyId,
    getGoldenCoastAccountDefinition("fresh_start_equity").subType,
    "Fresh Start FZ Equity",
    getGoldenCoastAccountDefinition("fresh_start_equity").acceptedAccountTypes
  );
  const salesRevenue = await activeSingleAccount(
    tx,
    companyId,
    "sp_sales",
    "Golden Coast Sales",
    ["Income", "Direct Income"]
  );
  const cogsAccount = await activeSingleAccount(
    tx,
    companyId,
    "sp_cogs",
    "Golden Coast Cost of Goods Sold",
    ["Direct Expense", "Expense"]
  );
  const stockInHand = await activeSingleAccount(
    tx,
    companyId,
    getGoldenCoastAccountDefinition("stock_in_hand").subType,
    "Golden Coast Stock in Hand",
    getGoldenCoastAccountDefinition("stock_in_hand").acceptedAccountTypes
  );
  const gcIntercompany = await activeSingleAccount(
    tx,
    companyId,
    "sp_hadi_intercompany",
    "Golden Coast HADI intercompany account",
    ["Intercompany"]
  );
  const cogs = await itemizedSaleCostUsd(tx, companyId, input.clientSaleId);

  await assertTransactionCompanyScope(tx, parentCompanyId);
  const hadiCash = await findMatchingHadiCashTarget(tx, parentCompanyId, sourceCash.name);
  const hadiLocationId = await findHadiPostingLocation(tx, parentCompanyId);
  const hadiIntercompany = await activeSingleAccount(
    tx,
    parentCompanyId,
    "hadi_sp_intercompany",
    "HADI Golden Coast intercompany account",
    ["Intercompany"]
  );
  await assertTransactionCompanyScope(tx, companyId);

  const amount = money(input.amountUsd);
  const payable = money(input.payableAmountUsd);
  const settlementDigest = digest({
    companyId,
    parentCompanyId,
    locationId: input.locationId,
    saleDate: input.saleDate,
    amount,
    payable,
    cogs,
    sourceCash,
    hadiCash,
    gcSalesCash: gcSalesCash.id,
    freshStartEquity: freshStartEquity.id,
    salesRevenue: salesRevenue.id,
    cogsAccount: cogsAccount.id,
    stockInHand: stockInHand.id,
    supplierPayable: input.supplierPayableAccountId,
  });
  const label = input.revision;
  const actor = input.actor;
  const postings: Array<{ companyId: number; request: Promise<CentralPostingRequest> }> = [];

  // The normal Supplier Partner POS voucher already credits the GC Sales Cash
  // payable (plus any configured deduction). This companion voucher converts
  // the same gross sale out of Fresh Start's capital and into current-period
  // Sales. The monthly close later debits Sales and distributes only net profit
  // 50/50, so the gross distribution is never counted twice.
  postings.push({
    companyId,
    request: buildPosting({
      companyId,
      locationId: input.locationId,
      voucherDate: input.saleDate,
      voucherNumber: `GC-POS-${input.clientSaleId}-${label}-CAPITAL`,
      description: "Golden Coast POS Fresh Start capital converted to sales payable",
      amount,
      clientRequestId: `${input.clientSaleId}:${label}:capital`,
      sourceId: sourceId(input.clientSaleId, settlementDigest, label, "capital_revenue"),
      idempotencyKey: idempotencyKey(companyId, input.clientSaleId, label, "capital_revenue"),
      entries: [
        { ledgerAccountId: freshStartEquity.id, debitAmount: amount, creditAmount: "0" },
        { ledgerAccountId: salesRevenue.id, debitAmount: "0", creditAmount: amount },
      ],
      actor,
    }),
  });

  // The inventory table is the authoritative quantity/value source for Net
  // Position, while the hidden Stock in Hand ledger is the double-entry bridge
  // used by the monthly close. Posting COGS here lets the close zero Sales/COGS
  // cleanly instead of creating a one-sided historical balance.
  if (new Decimal(cogs).greaterThan(0)) {
    postings.push({
      companyId,
      request: buildPosting({
        companyId,
        locationId: input.locationId,
        voucherDate: input.saleDate,
        voucherNumber: `GC-POS-${input.clientSaleId}-${label}-COGS`,
        description: "Golden Coast POS COGS recognition",
        amount: cogs,
        clientRequestId: `${input.clientSaleId}:${label}:cogs`,
        sourceId: sourceId(input.clientSaleId, settlementDigest, label, "sale_cogs"),
        idempotencyKey: idempotencyKey(companyId, input.clientSaleId, label, "sale_cogs"),
        entries: [
          { ledgerAccountId: cogsAccount.id, debitAmount: cogs, creditAmount: "0" },
          { ledgerAccountId: stockInHand.id, debitAmount: "0", creditAmount: cogs },
        ],
        actor,
      }),
    });
  }

  if (new Decimal(payable).greaterThan(0) && input.supplierPayableAccountId !== gcSalesCash.id) {
    postings.push({
      companyId,
      request: buildPosting({
        companyId,
        locationId: input.locationId,
        voucherDate: input.saleDate,
        voucherNumber: `GC-POS-${input.clientSaleId}-${label}-PAYABLE`,
        description: "Golden Coast POS payable reclassification",
        amount: payable,
        clientRequestId: `${input.clientSaleId}:${label}:payable`,
        sourceId: sourceId(input.clientSaleId, settlementDigest, label, "payable_reclass"),
        idempotencyKey: idempotencyKey(companyId, input.clientSaleId, label, "payable_reclass"),
        entries: [
          { ledgerAccountId: input.supplierPayableAccountId, debitAmount: payable, creditAmount: "0" },
          { ledgerAccountId: gcSalesCash.id, debitAmount: "0", creditAmount: payable },
        ],
        actor,
      }),
    });
  }

  postings.push(
    {
      companyId,
      request: buildPosting({
        companyId,
        locationId: input.locationId,
        voucherDate: input.saleDate,
        voucherNumber: `GC-POS-${input.clientSaleId}-${label}-CASH`,
        description: "Golden Coast POS cash transferred to HADI",
        amount,
        clientRequestId: `${input.clientSaleId}:${label}:gc-cash`,
        sourceId: sourceId(input.clientSaleId, settlementDigest, label, "gc_cash_transfer"),
        idempotencyKey: idempotencyKey(companyId, input.clientSaleId, label, "gc_cash_transfer"),
        entries: [
          { ledgerAccountId: gcIntercompany.id, debitAmount: amount, creditAmount: "0" },
          { ...target(sourceCash), debitAmount: "0", creditAmount: amount },
        ],
        actor,
      }),
    },
    {
      companyId: parentCompanyId,
      request: buildPosting({
        companyId: parentCompanyId,
        locationId: hadiLocationId,
        voucherDate: input.saleDate,
        voucherNumber: `GC-POS-${input.clientSaleId}-${label}-CASH-HADI`,
        description: "Golden Coast POS cash received by HADI",
        amount,
        clientRequestId: `${input.clientSaleId}:${label}:hadi-cash`,
        sourceId: sourceId(input.clientSaleId, settlementDigest, label, "hadi_cash_receipt"),
        idempotencyKey: idempotencyKey(parentCompanyId, input.clientSaleId, label, "hadi_cash_receipt"),
        entries: [
          { ...target(hadiCash), debitAmount: amount, creditAmount: "0" },
          { ledgerAccountId: hadiIntercompany.id, debitAmount: "0", creditAmount: amount },
        ],
        actor,
      }),
    }
  );

  for (const item of postings) {
    await assertTransactionCompanyScope(tx, item.companyId);
    const request = await item.request;
    const posted = (await postBalancedVoucherTx(tx, request, postingDependencies)) as PersistedPostingResult;
    if (posted.replayed) {
      // Replays are valid after a transport retry. The source sale itself is
      // locked by clientSaleId, so no non-transactional side effect is needed.
      continue;
    }
  }
  await assertTransactionCompanyScope(tx, companyId);
}

function sourceLabel(
  sourceIdValue: string,
  clientSaleId: string
): { digest: string; revision: string; role: SettlementRole } | null {
  const prefix = `${clientSaleId}:`;
  if (!sourceIdValue.startsWith(prefix)) return null;
  const parts = sourceIdValue.slice(prefix.length).split(":");
  if (parts.length !== 3 || parts[1] === "reversal") return null;
  if (!/^(?:create|edit\d+)$/.test(parts[1])) return null;
  if (!["capital_revenue", "sale_cogs", "payable_reclass", "gc_cash_transfer", "hadi_cash_receipt"].includes(parts[2]))
    return null;
  return { digest: parts[0], revision: parts[1], role: parts[2] as SettlementRole };
}

function revisionRank(value: string): number {
  return value === "create" ? 0 : Number(value.slice(4)) || 0;
}

/**
 * Reverses only the latest settlement postings belonging to the itemized sale.
 * Legacy Phase 5/6 postings have another source type and are intentionally
 * untouched.
 */
export async function reverseGoldenCoastPosAccountingTx(input: {
  tx: DbTransaction;
  companyId: number;
  clientSaleId: string;
  revision: number;
  actor?: PostingActor;
}): Promise<void> {
  const { tx, companyId, clientSaleId } = input;
  const { parentCompanyId } = await resolvePair(tx, companyId);
  const companyIds = [companyId, parentCompanyId];
  const markers: Array<{
    markerCompanyId: number;
    voucher: typeof vouchers.$inferSelect;
    entries: (typeof voucherEntries.$inferSelect)[];
    source: { digest: string; revision: string; role: SettlementRole };
  }> = [];

  for (const markerCompanyId of companyIds) {
    await assertTransactionCompanyScope(tx, markerCompanyId);
    const rows = await tx
      .select({
        voucherId: accountingPostingRequests.voucherId,
        sourceId: accountingPostingRequests.sourceId,
      })
      .from(accountingPostingRequests)
      .where(
        and(
          eq(accountingPostingRequests.companyId, markerCompanyId),
          eq(accountingPostingRequests.sourceType, GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE),
          ilike(accountingPostingRequests.sourceId, `${clientSaleId}:%`)
        )
      );
    const latest = new Map<
      SettlementRole,
      { voucherId: number; source: { digest: string; revision: string; role: SettlementRole } }
    >();
    for (const row of rows) {
      const parsed = sourceLabel(String(row.sourceId), clientSaleId);
      if (!parsed) continue;
      const current = latest.get(parsed.role);
      if (!current || revisionRank(parsed.revision) > revisionRank(current.source.revision)) {
        latest.set(parsed.role, { voucherId: Number(row.voucherId), source: parsed });
      }
    }
    for (const item of latest.values()) {
      const [voucher] = await tx
        .select()
        .from(vouchers)
        .where(
          and(eq(vouchers.id, item.voucherId), eq(vouchers.companyId, markerCompanyId), isNull(vouchers.deletedAt))
        )
        .limit(1);
      if (!voucher) throw new Error(`Golden Coast POS settlement voucher ${item.voucherId} is missing`);
      const entries = await tx.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
      markers.push({ markerCompanyId, voucher, entries, source: item.source });
    }
  }

  for (const marker of markers) {
    await assertTransactionCompanyScope(tx, marker.markerCompanyId);
    const reversalEntries = marker.entries.map((entry) => ({
      ledgerAccountId: entry.ledgerAccountId ?? undefined,
      bankAccountId: entry.bankAccountId ?? undefined,
      supplierId: entry.supplierId ?? undefined,
      customerId: entry.customerId ?? undefined,
      employeeId: entry.employeeId ?? undefined,
      fixedAssetId: entry.fixedAssetId ?? undefined,
      factorySupplierId: entry.factorySupplierId ?? undefined,
      debitAmount: entry.creditAmount || "0",
      creditAmount: entry.debitAmount || "0",
      narration: `Reversal of ${marker.voucher.voucherNumber}`,
    }));
    const reversalDigest = digest({ original: marker.source, voucherId: marker.voucher.id, revision: input.revision });
    const request = await buildPosting({
      companyId: marker.markerCompanyId,
      locationId: marker.voucher.locationId ?? null,
      voucherDate: marker.voucher.voucherDate,
      voucherNumber: `${marker.voucher.voucherNumber}-REV-${input.revision}`,
      description: `Golden Coast POS settlement reversal ${marker.voucher.voucherNumber}`,
      amount: money(marker.voucher.totalAmount),
      clientRequestId: `${clientSaleId}:reversal:${input.revision}:${marker.source.role}`,
      sourceId: `${clientSaleId}:${reversalDigest}:reversal:${input.revision}:${marker.source.role}`,
      idempotencyKey: `${GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE}:${marker.markerCompanyId}:${clientSaleId}:reversal${input.revision}:${marker.source.role}`,
      entries: reversalEntries,
      actor: input.actor,
    });
    await postBalancedVoucherTx(tx, request, postingDependencies);
  }
  await assertTransactionCompanyScope(tx, companyId);
}
