/**
 * server/services/pos/postSaleAccounting.ts
 *
 * PHASE 19 structural split — moved (unchanged) from server/routes/pos/posSalesRoutes.ts:
 *   - Sales revenue account resolution
 *   - Supplier-partner accounting context precompute
 *   - Debit/credit voucher entries (normal ERP and supplier-partner split accounting)
 */
import { db } from "../../db";
import { storage } from "../../storage";
import { ledgerAccounts, voucherEntries } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { HandlerErrorResult, SupplierPartnerAccountingContext, ValidatedInventoryItem } from "./posSaleTypes";
import { findLinkedCustomerId } from "./updateCustomerBalance";

/**
 * Get or create SALES revenue account (outside transaction for simplicity).
 * Use getOrCreateLedgerAccount so soft-deleted duplicates don't cause a
 * unique-constraint crash — it handles the 23505 error and falls back to
 * fetching the existing (possibly soft-deleted) row.
 */
export async function getOrCreateSalesRevenueAccount(
  companyId: number
): Promise<{ salesAccount: any } | { error: HandlerErrorResult }> {
  const salesAccount = await storage.getOrCreateLedgerAccount({
    companyId,
    code: "SALES",
    name: "Sales Revenue",
    accountType: "Income",
    openingBalance: "0",
    active: true,
  });

  if (salesAccount.accountType !== "Income") {
    // Validate that Sales account is of type Income for proper import cycle balance
    console.warn(
      `[POS Sale] WARNING: SALES account has type "${salesAccount.accountType}" instead of "Income". This will cause import cycle imbalance!`
    );
    return {
      error: {
        status: 400,
        body: {
          message: `The SALES account is configured with type "${salesAccount.accountType}" but must be type "Income" for POS sales to work correctly. Please update the SALES account type in Accounts page.`,
        },
      },
    };
  }

  return { salesAccount };
}

/** ── SP company: fetch configured POS accounts & pre-compute supplier cost ── */
export async function fetchSupplierPartnerAccountingContext(
  isSpCompany: boolean,
  companyId: number,
  location: any,
  inventoryValidation: ValidatedInventoryItem[]
): Promise<SupplierPartnerAccountingContext | { error: HandlerErrorResult }> {
  // Per-qty deduction that silently reduces Supplier Cash Payable (not income/expense)
  const spPosDeductionPerQty = isSpCompany
    ? parseFloat(String((location as any).supplierPartnerPayableDeductionPerQty ?? "0")) || 0
    : 0;
  const spPosTotalQtySold = isSpCompany ? inventoryValidation.reduce((sum, v) => sum + v.saleQty, 0) : 0;

  if (!isSpCompany) {
    return {
      isSpCompany,
      spPosPayableAccountId: null,
      spPosProfitAccountId: null,
      spPosCostClrAccountId: null,
      spPosDeductionClrAccountId: null,
      totalSupplierCost: 0,
      spPosDeductionPerQty,
      spPosTotalQtySold,
    };
  }

  const spSettings = await storage.getCompanySettings(companyId);
  const spPosPayableAccountId = spSettings?.spPosPayableAccountId ?? null;
  const spPosProfitAccountId = spSettings?.spPosProfitAccountId ?? null;
  if (!spPosPayableAccountId || !spPosProfitAccountId) {
    return {
      error: {
        status: 400,
        body: { message: "Supplier POS payable/profit accounts are not configured. Go to SP Setup to set them up." },
      },
    };
  }

  // Look up Stock Cost Payable Clearing account (sp_cost_clearing subType)
  const [clrAcct] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.subType, "sp_cost_clearing"), isNull(ledgerAccounts.deletedAt)))
    .limit(1);
  const spPosCostClrAccountId = clrAcct?.id ?? null;

  // Look up Supplier Payable Deduction Clearing account (sp_pay_deduction_clearing subType)
  const [ddcAcct] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.subType, "sp_pay_deduction_clearing"), isNull(ledgerAccounts.deletedAt))
    )
    .limit(1);
  const spPosDeductionClrAccountId = ddcAcct?.id ?? null;

  // Pre-compute total supplier cost from inventory averageRate (includes landed/offloading cost)
  const totalSupplierCost = inventoryValidation.reduce((sum, v) => sum + v.saleQty * v.currentRate, 0);

  return {
    isSpCompany,
    spPosPayableAccountId,
    spPosProfitAccountId,
    spPosCostClrAccountId,
    spPosDeductionClrAccountId,
    totalSupplierCost,
    spPosDeductionPerQty,
    spPosTotalQtySold,
  };
}

/** Insert the Dr (payment) + Cr (Sales revenue, or SP-split) voucher entries for a POS sale. */
export async function insertSaleAccountingEntries(
  tx: any,
  params: {
    txVoucherId: number;
    voucherNumber: string;
    grandTotal: number;
    isCreditSale: any;
    accountType: "cash" | "bank" | "credit";
    accountId: number;
    location: any;
    customerAccount: any;
    companyId: number;
    isSpCompany: boolean;
    salesAccount: any;
    spCtx: SupplierPartnerAccountingContext;
  }
): Promise<void> {
  const {
    txVoucherId,
    voucherNumber,
    grandTotal,
    isCreditSale,
    accountType,
    accountId,
    location,
    customerAccount,
    companyId,
    isSpCompany,
    salesAccount,
    spCtx,
  } = params;

  const creditSaleNarration = isCreditSale
    ? `Credit Invoice Sale at ${location.name} - ${(customerAccount as any).name}`
    : `POS Sale - ${voucherNumber}`;

  const debitEntry: any = {
    voucherId: txVoucherId,
    debitAmount: grandTotal.toFixed(2),
    creditAmount: "0",
    narration: creditSaleNarration,
  };

  if (isCreditSale || accountType === "cash" || accountType === "credit") {
    debitEntry.ledgerAccountId = accountId;
    // For credit sales, also stamp the customerId on the receivable
    // entry whenever the receivable ledger is linked to a customer.
    // Without this, the customer ledger / statement views can't
    // attribute the entry to the customer.
    if (isCreditSale && accountType === "credit") {
      const linkedCustId = await findLinkedCustomerId(tx, companyId, accountId);
      if (linkedCustId !== undefined) {
        debitEntry.customerId = linkedCustId;
      }
    }
    console.log("[POS Sale] Using ledgerAccountId for cash/credit:", accountId);
  } else {
    debitEntry.bankAccountId = accountId;
    console.log("[POS Sale] Using bankAccountId for bank:", accountId);
  }

  console.log("[POS Sale] Debit entry:", debitEntry);
  await tx.insert(voucherEntries).values(debitEntry);

  if (!isSpCompany) {
    // Normal ERP: credit the full sale amount to the Sales Revenue account
    await tx.insert(voucherEntries).values({
      voucherId: txVoucherId,
      ledgerAccountId: salesAccount.id,
      debitAmount: "0",
      creditAmount: grandTotal.toFixed(2),
      narration: creditSaleNarration,
    });
    return;
  }

  // Supplier Partner accounting:
  //   Dr Cash                           = grandTotal  (debit entry already written above)
  //   Cr Supplier Cash Payable          = grandTotal − deductionAmount
  //   Cr Deduction Clearing (hidden)    = deductionAmount          (if deduction > 0)
  //
  // The deduction is a silent per-qty reduction to what is owed to the supplier
  // (e.g. a warehouse loss charge). It is NOT income, profit, or an expense —
  // it flows into a hidden clearing liability that is excluded from all reports.
  const grandTotalRounded = Number(grandTotal.toFixed(2));
  const spDeductionAmount = Number((spCtx.spPosTotalQtySold * spCtx.spPosDeductionPerQty).toFixed(2));
  // Guard: deduction cannot exceed the sale total
  if (spDeductionAmount > Math.abs(grandTotalRounded)) {
    throw new Error(
      `Supplier payable deduction (${spDeductionAmount}) exceeds the sale total (${grandTotalRounded}). ` +
        `Adjust the deduction per qty setting on this location.`
    );
  }
  const spPayableAmount = Number((grandTotalRounded - spDeductionAmount).toFixed(2));

  if (grandTotalRounded > 0) {
    // Cr Supplier Cash Payable = reduced payable
    if (spPayableAmount > 0) {
      await tx.insert(voucherEntries).values({
        voucherId: txVoucherId,
        ledgerAccountId: spCtx.spPosPayableAccountId!,
        debitAmount: "0",
        creditAmount: spPayableAmount.toFixed(2),
        narration: `Supplier Cash Payable — ${voucherNumber}`,
      });
    }
    // Cr Deduction Clearing = deduction (keeps voucher balanced)
    if (spDeductionAmount > 0 && spCtx.spPosDeductionClrAccountId) {
      await tx.insert(voucherEntries).values({
        voucherId: txVoucherId,
        ledgerAccountId: spCtx.spPosDeductionClrAccountId,
        debitAmount: "0",
        creditAmount: spDeductionAmount.toFixed(2),
        narration: `Supplier Payable Deduction (${spCtx.spPosTotalQtySold} qty × ${spCtx.spPosDeductionPerQty}) — ${voucherNumber}`,
      });
    }
  } else if (grandTotalRounded < 0) {
    // Reversal: Dr Supplier Cash Payable
    if (spPayableAmount < 0) {
      await tx.insert(voucherEntries).values({
        voucherId: txVoucherId,
        ledgerAccountId: spCtx.spPosPayableAccountId!,
        debitAmount: Math.abs(spPayableAmount).toFixed(2),
        creditAmount: "0",
        narration: `Supplier Cash Payable reversal — ${voucherNumber}`,
      });
    }
    if (spDeductionAmount > 0 && spCtx.spPosDeductionClrAccountId) {
      await tx.insert(voucherEntries).values({
        voucherId: txVoucherId,
        ledgerAccountId: spCtx.spPosDeductionClrAccountId,
        debitAmount: spDeductionAmount.toFixed(2),
        creditAmount: "0",
        narration: `Supplier Payable Deduction reversal — ${voucherNumber}`,
      });
    }
  }
}
