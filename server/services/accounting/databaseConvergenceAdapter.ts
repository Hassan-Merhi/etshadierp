import { and, eq, sql } from "drizzle-orm";
import { factoryDaybookEntries, voucherEntries, vouchers } from "@shared/schema";
import {
  ConvergenceReconciliationError,
  type AccountingConvergenceSnapshot,
  type ConvergenceReconciliationAdapter,
  type StockConvergenceSnapshot,
} from "./convergenceReconciliation";

interface AccountingReadTx {
  select(fields: Record<string, unknown>): any;
}

export type AuthoritativeStockSnapshotLoader = (input: {
  tx: any;
  companyId: number;
}) => Promise<StockConvergenceSnapshot[]>;

function asInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConvergenceReconciliationError("CONVERGENCE_DATABASE_ROW_INVALID", `${field} must be a positive integer`);
  }
  return parsed;
}

function asDecimalString(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new ConvergenceReconciliationError("CONVERGENCE_DATABASE_ROW_INVALID", `${field} is required`);
  }
  return normalized;
}

/**
 * Loads the authoritative accounting reconciliation surface directly from the
 * persisted Voucher/VoucherEntry/Factory Daybook rows. This adapter is read-only:
 * discrepancies are returned to the reconciler and are never repaired here.
 *
 * The voucher total is the source-document expectation. VoucherEntry rows are the
 * canonical ledger posting evidence. Payment/Receipt vouchers must have exactly one
 * factory Daybook mirror; duplicate mirrors fail closed rather than being hidden by
 * aggregation.
 */
export async function loadDatabaseAccountingConvergenceSnapshots(input: {
  tx: AccountingReadTx;
  companyId: number;
}): Promise<AccountingConvergenceSnapshot[]> {
  const { tx, companyId } = input;

  const rows = await tx
    .select({
      voucherId: vouchers.id,
      companyId: vouchers.companyId,
      voucherType: vouchers.voucherType,
      voucherTotal: vouchers.totalAmount,
      ledgerBaseDebit: sql<string>`coalesce(sum(coalesce(${voucherEntries.baseDebitAmount}, ${voucherEntries.debitAmount}, 0)), 0)`,
      ledgerBaseCredit: sql<string>`coalesce(sum(coalesce(${voucherEntries.baseCreditAmount}, ${voucherEntries.creditAmount}, 0)), 0)`,
      daybookCount: sql<number>`count(distinct ${factoryDaybookEntries.id})`,
      daybookBaseAmount: sql<string | null>`case
        when count(distinct ${factoryDaybookEntries.id}) = 0 then null
        else max(${factoryDaybookEntries.amountUsd})
      end`,
    })
    .from(vouchers)
    .leftJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
    .leftJoin(
      factoryDaybookEntries,
      and(
        eq(factoryDaybookEntries.companyId, vouchers.companyId),
        eq(factoryDaybookEntries.referenceTable, "vouchers"),
        eq(factoryDaybookEntries.referenceId, vouchers.id)
      )
    )
    .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.deletedAt} is null`))
    .groupBy(vouchers.id, vouchers.companyId, vouchers.voucherType, vouchers.totalAmount);

  return rows.map((row: any) => {
    const voucherId = asInteger(row.voucherId, "voucherId");
    const rowCompanyId = asInteger(row.companyId, "companyId");
    if (rowCompanyId !== companyId) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_COMPANY_MISMATCH",
        `Accounting database row ${voucherId} crossed the requested company boundary`
      );
    }

    const expectsDaybook = row.voucherType === "Payment" || row.voucherType === "Receipt";
    const daybookCount = Number(row.daybookCount ?? 0);
    if (!Number.isInteger(daybookCount) || daybookCount < 0) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_DATABASE_ROW_INVALID",
        `Voucher ${voucherId} returned an invalid Daybook count`
      );
    }
    if (daybookCount > 1) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_DUPLICATE_DAYBOOK",
        `Voucher ${voucherId} has ${daybookCount} Factory Daybook mirrors`
      );
    }

    const voucherTotal = asDecimalString(row.voucherTotal, "voucherTotal");
    return {
      voucherId,
      companyId: rowCompanyId,
      voucherBaseDebit: voucherTotal,
      voucherBaseCredit: voucherTotal,
      ledgerBaseDebit: asDecimalString(row.ledgerBaseDebit, "ledgerBaseDebit"),
      ledgerBaseCredit: asDecimalString(row.ledgerBaseCredit, "ledgerBaseCredit"),
      daybookBaseAmount:
        row.daybookBaseAmount == null ? null : asDecimalString(row.daybookBaseAmount, "daybookBaseAmount"),
      expectsDaybook,
    };
  });
}

/**
 * Creates the production reconciliation adapter while keeping inventory source
 * documents explicit. Different stock domains have different authoritative source
 * tables; callers must provide the company-scoped stock loader rather than falling
 * back to a broad/unscoped inventory query.
 */
export function createDatabaseConvergenceAdapter(
  loadStockSnapshots: AuthoritativeStockSnapshotLoader
): ConvergenceReconciliationAdapter {
  return {
    loadAccountingSnapshots: ({ tx, companyId }) => loadDatabaseAccountingConvergenceSnapshots({ tx, companyId }),
    loadStockSnapshots,
  };
}
