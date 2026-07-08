/**
 * server/services/pos/updateCustomerBalance.ts
 *
 * PHASE 19 structural split — moved (unchanged) from server/routes/pos/posSalesRoutes.ts.
 * Credit-sale customer receivable linkage: stamps the customerId on the
 * receivable voucher entry so customer ledgers/statements can attribute it.
 */
import { customers } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * For credit sales, also stamp the customerId on the receivable
 * entry whenever the receivable ledger is linked to a customer.
 * Without this, the customer ledger / statement views can't
 * attribute the entry to the customer.
 */
export async function findLinkedCustomerId(tx: any, companyId: number, accountId: number): Promise<number | undefined> {
  try {
    const [linkedCust] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.ledgerAccountId, accountId), eq(customers.companyId, companyId)))
      .limit(1);
    return linkedCust?.id;
  } catch (e) {
    console.error("[POS Sale] customer lookup for credit-sale entry failed:", e);
    return undefined;
  }
}
