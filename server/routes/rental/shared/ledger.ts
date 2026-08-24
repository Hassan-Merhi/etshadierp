import type { DbTransaction } from "../../../db";
import type { Request } from "express";
import { ledgerAccounts } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

export type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

export function getCompanyId(req: Request): number | null {
  return req.session.currentCompanyId ?? null;
}

export async function findOrCreateLedgerAccount(
  tx: DbTransaction,
  companyId: number,
  name: string,
  accountType: "Income" | "Liability" | "Indirect Expense" | "Indirect Income" | "Intercompany" | "Asset",
  codePrefix: string,
  subType?: string
): Promise<number> {
  // Race-safe: INSERT ... ON CONFLICT DO NOTHING, then SELECT.
  // The unique index uq_ledger_accounts_company_name_active prevents duplicates
  // even when multiple transactions run in parallel (e.g. page-load batch accruals).
  const code = `${codePrefix}-${Date.now()}`;
  await tx.execute(sql`
    INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, active)
    VALUES (${companyId}, ${code}, ${name}, ${accountType}, ${subType ?? null}, true)
    ON CONFLICT (company_id, name) WHERE deleted_at IS NULL DO NOTHING
  `);
  const [account] = await tx
    .select()
    .from(ledgerAccounts)
    .where(
      and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name), isNull(ledgerAccounts.deletedAt))
    );
  // Patch type/subType if the existing row has stale values
  const needsPatch = account.accountType !== accountType || (subType !== undefined && account.subType !== subType);
  if (needsPatch) {
    await tx
      .update(ledgerAccounts)
      .set({ accountType, ...(subType !== undefined ? { subType } : {}) })
      .where(eq(ledgerAccounts.id, account.id));
  }
  return account.id;
}

// ── Auto-transfer helper ──────────────────────────────────────────────────────
// Called after a payment is committed. Looks up the auto-transfer config for
// this company/module and, if enabled, posts two vouchers (one per company)
// using the same TRANSFER-CLEARING pattern as /api/simple-company-transfer.
