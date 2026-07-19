import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { ledgerAccounts } from "@shared/schema";

export type LedgerAccountOption = {
  id: number;
  name: string;
  code: string;
  accountType: string;
  subType: string | null;
  parentId: number | null;
};

/**
 * Returns only accounts that can act as parent groups.
 *
 * A valid group is either explicitly tagged with subType="Group" or is already
 * referenced as a parent by another live account. This keeps legacy groups
 * visible without sending the complete ledger-account table to the client.
 */
export async function getLedgerParentGroupOptions(
  companyId: number,
  includeHidden = false,
): Promise<LedgerAccountOption[]> {
  const childParentRows = await db
    .selectDistinct({ parentId: ledgerAccounts.parentId })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        isNull(ledgerAccounts.deletedAt),
        sql`${ledgerAccounts.parentId} IS NOT NULL`,
      ),
    );

  const legacyParentIds = childParentRows
    .map((row) => row.parentId)
    .filter((id): id is number => typeof id === "number");

  const groupCondition =
    legacyParentIds.length > 0
      ? or(eq(ledgerAccounts.subType, "Group"), inArray(ledgerAccounts.id, legacyParentIds))
      : eq(ledgerAccounts.subType, "Group");

  const conditions = [
    eq(ledgerAccounts.companyId, companyId),
    isNull(ledgerAccounts.deletedAt),
    groupCondition,
  ];
  if (!includeHidden) conditions.push(eq(ledgerAccounts.isHidden, false));

  return db
    .select({
      id: ledgerAccounts.id,
      name: ledgerAccounts.name,
      code: ledgerAccounts.code,
      accountType: ledgerAccounts.accountType,
      subType: ledgerAccounts.subType,
      parentId: ledgerAccounts.parentId,
    })
    .from(ledgerAccounts)
    .where(and(...conditions))
    .orderBy(asc(ledgerAccounts.code));
}
