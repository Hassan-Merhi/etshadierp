import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ledgerAccounts } from "@shared/schema";
import {
  postBalancedVoucherTx,
  type PostingActor,
} from "../../services/accounting/centralPostingEngine";
import { createDatabasePostingDependencies } from "../../services/accounting/databasePostingDependencies";
import {
  buildGoldenCoastPhase15SalesPayablePosting,
  goldenCoastPhase15SalesPayableDigest,
} from "../../services/accounting/goldenCoastPhase15SalesPayable";
import { assertTransactionCompanyScope } from "../../services/security/transactionCompanyScope";
import * as core from "./goldenCoastPhase6AutoHadiCore";

export {
  GoldenCoastPhase6AutoHadiError,
  resolveGoldenCoastAutomaticHadiPair,
  selectGoldenCoastAutomaticHadiCashAccount,
} from "./goldenCoastPhase6AutoHadiCore";
export type {
  GoldenCoastAutomaticHadiAccount,
  GoldenCoastAutomaticHadiPair,
  GoldenCoastAutomaticHadiResult,
} from "./goldenCoastPhase6AutoHadiCore";

const postingDependencies = createDatabasePostingDependencies();
type DatabaseTransaction = Parameters<typeof core.postGoldenCoastAutomaticHadiCollectionTx>[0]["tx"];

async function resolveFreshStartEquityAccount(
  tx: DatabaseTransaction,
  companyId: number
): Promise<{ id: number; name: string }> {
  await assertTransactionCompanyScope(tx, companyId);
  const rows = await tx
    .select({ id: ledgerAccounts.id, name: ledgerAccounts.name, accountType: ledgerAccounts.accountType })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.subType, "gc_partner_capital"),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    )
    .orderBy(asc(ledgerAccounts.id))
    .limit(2);

  if (rows.length !== 1 || rows[0].accountType !== "Equity") {
    throw new core.GoldenCoastPhase6AutoHadiError(
      rows.length === 0
        ? "Fresh Start FZ Equity is not configured for Golden Coast; run Golden Coast setup first."
        : rows.length > 1
          ? "Fresh Start FZ Equity is ambiguous; repair duplicate active partner-capital accounts first."
          : `Fresh Start FZ Equity must have account type Equity, not ${rows[0].accountType}.`,
      "GC_PHASE15_SALES_PAYABLE_ACCOUNT_INVALID",
      409
    );
  }

  return { id: Number(rows[0].id), name: String(rows[0].name) };
}

async function postPhase15SalesPayableBridge(input: {
  tx: DatabaseTransaction;
  companyId: number;
  gcSalesCashAccountId: number;
  saleDate: string;
  amountUsd: string;
  clientRequestId: string;
  transfer: core.GoldenCoastAutomaticHadiResult["transfer"];
  actor?: PostingActor;
}): Promise<void> {
  const freshStartEquity = await resolveFreshStartEquityAccount(input.tx, input.companyId);
  const saleDigest = createHash("sha256").update(JSON.stringify(input.transfer)).digest("hex").slice(0, 32);
  const sale = {
    companyId: input.companyId,
    saleDate: input.saleDate,
    amountUsd: input.amountUsd,
    clientRequestId: input.clientRequestId,
    saleDigest,
    freshStartEquityAccountId: freshStartEquity.id,
    gcSalesCashAccountId: input.gcSalesCashAccountId,
  };
  const digest = goldenCoastPhase15SalesPayableDigest(sale);
  const request = buildGoldenCoastPhase15SalesPayablePosting({
    sale,
    digest,
    exchangeRate: null,
    actor: input.actor,
  });

  // An exact replay is valid and is intentionally ignored. This also lets an
  // old Phase 6 sale that already has its HADI pair gain the missing Phase 15
  // bridge on the first exact replay without consuming stock a second time.
  await postBalancedVoucherTx(input.tx, request, postingDependencies);
  await assertTransactionCompanyScope(input.tx, input.companyId);
}

/**
 * Phase 15 wraps the existing atomic HADI collection. The old collection runs
 * first because it still expects the temporary debit balance created by the
 * revenue voucher. Only after cash is safely represented as a HADI asset do we
 * reclassify Fresh Start's gross capital claim into the canonical credit-normal
 * GC Sales Cash payable.
 */
export async function postGoldenCoastAutomaticHadiCollectionTx(
  input: Parameters<typeof core.postGoldenCoastAutomaticHadiCollectionTx>[0]
): Promise<core.GoldenCoastAutomaticHadiResult> {
  const result = await core.postGoldenCoastAutomaticHadiCollectionTx(input);
  await postPhase15SalesPayableBridge({
    tx: input.tx,
    companyId: input.companyId,
    gcSalesCashAccountId: input.gcSalesCashAccountId,
    saleDate: input.saleDate,
    amountUsd: input.amountUsd,
    clientRequestId: input.clientRequestId,
    transfer: result.transfer,
    actor: input.actor,
  });
  return result;
}
