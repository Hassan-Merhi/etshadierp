import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";

export async function findOrCreateImportChargeAccounts(tx: any, companyId: number) {
  let [parent] = await tx
    .select()
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.companyId, companyId),
        eq(schema.ledgerAccounts.code, "IMPORT_CHARGES"),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    )
    .limit(1);

  if (!parent) {
    [parent] = await tx
      .insert(schema.ledgerAccounts)
      .values({
        companyId,
        code: "IMPORT_CHARGES",
        name: "Import Charges",
        accountType: "Direct Expense",
        subType: "Direct Expense",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();
  }

  const expense = async (code: string, name: string): Promise<number> => {
    let [row] = await tx
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, companyId),
          eq(schema.ledgerAccounts.code, code),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!row) {
      [row] = await tx
        .insert(schema.ledgerAccounts)
        .values({
          companyId,
          code,
          name,
          accountType: "Direct Expense",
          subType: "Direct Expense",
          parentId: parent.id,
          openingBalance: "0",
          openingBalanceSide: "Dr",
        })
        .returning();
    }
    return row.id;
  };

  const payable = async (code: string, name: string): Promise<number> => {
    let [row] = await tx
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, companyId),
          eq(schema.ledgerAccounts.code, code),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!row) {
      [row] = await tx
        .insert(schema.ledgerAccounts)
        .values({
          companyId,
          code,
          name,
          accountType: "Liability",
          subType: "Current Liability",
          openingBalance: "0",
          openingBalanceSide: "Cr",
        })
        .returning();
    }
    return row.id;
  };

  return { expense, payable };
}
