import Decimal from "decimal.js";
import { and, eq, isNull } from "drizzle-orm";
import { ledgerAccounts } from "@shared/schema";
import type { DbTransaction } from "../../db";
import { getGoldenCoastAccountDefinition } from "./goldenCoastPhase2Accounts";
import { postBalancedVoucherTx } from "./centralPostingEngine";
import { createDatabasePostingDependencies } from "./databasePostingDependencies";
import { buildGenericVoucherPostingRequest } from "./genericVoucherPosting";

export type FreshStartSettlementSource = "HADI" | "GC_CASH";
const postingDependencies = createDatabasePostingDependencies();

function money(value: number | string) {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

async function resolveAccount(tx: DbTransaction, companyId: number, subType: string) {
  const [account] = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.subType, subType),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    )
    .limit(1);
  if (!account) throw new Error(`Missing Golden Coast account ${subType}`);
  return Number(account.id);
}

/** Phase 17: settle Fresh Start payable without touching revenue, COGS, or equity. */
export async function settleGoldenCoastFreshStartPayableTx(input: {
  tx: DbTransaction;
  companyId: number;
  amountUsd: number;
  source: FreshStartSettlementSource;
  cashAccountId?: number;
  gcIntercompanyAccountId?: number;
  voucherDate: string;
  voucherNumber: string;
}) {
  const amount = money(input.amountUsd);
  if (new Decimal(amount).lte(0)) throw new Error("Settlement amount must be positive");

  const payable = await resolveAccount(
    input.tx,
    input.companyId,
    getGoldenCoastAccountDefinition("gc_sales_cash").subType
  );
  const creditAccount =
    input.source === "GC_CASH"
      ? input.cashAccountId
      : (input.gcIntercompanyAccountId ?? (await resolveAccount(input.tx, input.companyId, "sp_hadi_intercompany")));

  if (!creditAccount) throw new Error("Missing settlement credit account");

  const request = buildGenericVoucherPostingRequest({
    companyId: input.companyId,
    clientRequestId: `phase17:${input.voucherNumber}`,
    voucher: {
      voucherType: "Journal",
      voucherDate: input.voucherDate,
      voucherNumber: input.voucherNumber,
      description: `Fresh Start settlement ${input.source}`,
      currency: "USD",
      locationId: null,
    },
    entries: [
      { ledgerAccountId: payable, debitAmount: amount, creditAmount: "0" },
      { ledgerAccountId: creditAccount, debitAmount: "0", creditAmount: amount },
    ],
    exchangeRate: null,
  }).request;

  return postBalancedVoucherTx(input.tx, request, postingDependencies);
}
