import { and, eq } from "drizzle-orm";
import { factoryDaybookEntries } from "@shared/schema";
import type { db } from "../../db";

/**
 * The transaction handle this removal runs inside: the caller's own, so the
 * mirror disappears in the same commit as the cancellation.
 */
export type FactoryDaybookMirrorDeleteTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Remove the Factory Daybook mirror of a voucher that is being cancelled.
 *
 * The mirror is written inside the voucher's posting transaction so the two
 * views cannot diverge after a partial commit; cancellation has to be
 * symmetric or the divergence simply moves to the other end of the lifecycle.
 * A cancelled Payment whose mirror survives leaves the Daybook — a cash view —
 * reporting money that moved for a document nobody can open.
 *
 * This is not a repair of accounting history: the voucher and its ledger
 * entries are kept, and only the derived mirror of a document that no longer
 * stands is removed, in the same transaction as the cancellation.
 *
 * Pass the company id whenever the voucher is one of the caller's own, so the
 * delete stays inside the tenant boundary. It is omitted only for the
 * intercompany counterpart voucher, which by definition lives in the other
 * company and is being hard-deleted by the same transaction — leaving its
 * mirror behind would strand a row no company could ever explain.
 */
export async function removeFactoryDaybookMirrorTx(input: {
  tx: FactoryDaybookMirrorDeleteTransaction;
  voucherId: number;
  companyId?: number;
}): Promise<void> {
  const scope = [
    eq(factoryDaybookEntries.referenceTable, "vouchers"),
    eq(factoryDaybookEntries.referenceId, input.voucherId),
  ];
  if (input.companyId != null) {
    scope.push(eq(factoryDaybookEntries.companyId, input.companyId));
  }
  await input.tx.delete(factoryDaybookEntries).where(and(...scope));
}
