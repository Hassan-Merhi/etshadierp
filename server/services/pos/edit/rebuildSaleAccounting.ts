/**
 * server/services/pos/edit/rebuildSaleAccounting.ts
 *
 * PHASE 20 structural split — moved (unchanged) from
 * server/routes/pos/posEditSaleRoutes.ts:
 *   - voucher_entries recreation (debit payment entry + credit entry/entries)
 *   - normal-ERP single revenue credit
 *   - supplier-partner split accounting (payable / deduction clearing) for edits
 *
 * Every message, status code, and query is byte-identical to the original —
 * only the code location changed.
 */
import { voucherEntries } from "@shared/schema";

/**
 * Recreates voucher entries with the new total. Throws "Original voucher
 * entries not found" (matching the original) if the old debit/credit entries
 * cannot be located.
 */
export async function rebuildSaleAccountingEntries(
  tx: any,
  params: {
    voucherId: number;
    oldEntries: any[];
    grandTotal: number;
    paymentAccountType: any;
    paymentAccountId: any;
    isSpCompanyEdit: boolean;
    editSpPayableAccountId: number | null;
    editSpDeductionClrAccountId: number | null;
    totalQtySoldEdit: number;
    editSpDeductionPerQty: number;
  }
): Promise<void> {
  const {
    voucherId,
    oldEntries,
    grandTotal,
    paymentAccountType,
    paymentAccountId,
    isSpCompanyEdit,
    editSpPayableAccountId,
    editSpDeductionClrAccountId,
    totalQtySoldEdit,
    editSpDeductionPerQty,
  } = params;

  // Get original entries for reference
  const paymentEntry = oldEntries.find((e) => parseFloat(e.debitAmount || "0") > 0);
  const revenueEntry = oldEntries.find((e) => parseFloat(e.creditAmount || "0") > 0);

  if (!paymentEntry || !revenueEntry) {
    throw new Error("Original voucher entries not found");
  }

  // Determine payment account - use new values if provided, otherwise preserve original
  const newDebitEntry: any = {
    voucherId,
    debitAmount: grandTotal.toString(),
    creditAmount: "0",
    narration: paymentEntry.narration || "",
  };

  if (paymentAccountType && paymentAccountId) {
    // User changed payment account - use new values
    if (paymentAccountType === "cash" || paymentAccountType === "credit") {
      newDebitEntry.ledgerAccountId = parseInt(paymentAccountId);
      newDebitEntry.bankAccountId = null;
    } else if (paymentAccountType === "bank") {
      newDebitEntry.bankAccountId = parseInt(paymentAccountId);
      newDebitEntry.ledgerAccountId = null;
    }
    newDebitEntry.supplierId = null;
    newDebitEntry.employeeId = null;
    newDebitEntry.fixedAssetId = null;
  } else {
    // Preserve original payment account
    newDebitEntry.ledgerAccountId = paymentEntry.ledgerAccountId;
    newDebitEntry.bankAccountId = paymentEntry.bankAccountId;
    newDebitEntry.supplierId = paymentEntry.supplierId;
    newDebitEntry.employeeId = paymentEntry.employeeId;
    newDebitEntry.fixedAssetId = paymentEntry.fixedAssetId;
  }

  // Create new debit entry (payment account)
  await tx.insert(voucherEntries).values(newDebitEntry);

  if (!isSpCompanyEdit) {
    // Normal ERP: single credit to Sales Revenue account
    await tx.insert(voucherEntries).values({
      voucherId,
      ledgerAccountId: revenueEntry.ledgerAccountId,
      bankAccountId: revenueEntry.bankAccountId,
      supplierId: revenueEntry.supplierId,
      employeeId: revenueEntry.employeeId,
      fixedAssetId: revenueEntry.fixedAssetId,
      debitAmount: "0",
      creditAmount: grandTotal.toString(),
      narration: revenueEntry.narration || "",
    });
  } else {
    // Supplier Partner edit accounting (mirrors new-sale logic):
    //   Dr Cash / Receivable              = grandTotal  (debit entry already written above)
    //   Cr Supplier Cash Payable          = grandTotal − deductionAmount
    //   Cr Deduction Clearing (hidden)    = deductionAmount          (if deduction > 0)
    const grandTotalRounded = Number(grandTotal.toFixed(2));
    const editDeductionAmount = Number((totalQtySoldEdit * editSpDeductionPerQty).toFixed(2));
    if (editDeductionAmount > Math.abs(grandTotalRounded)) {
      throw new Error(
        `Supplier payable deduction (${editDeductionAmount}) exceeds the sale total (${grandTotalRounded}). ` +
          `Adjust the deduction per qty setting on this location.`
      );
    }
    const editSpPayableAmount = Number((grandTotalRounded - editDeductionAmount).toFixed(2));

    if (grandTotalRounded > 0) {
      if (editSpPayableAmount > 0) {
        await tx.insert(voucherEntries).values({
          voucherId,
          ledgerAccountId: editSpPayableAccountId!,
          debitAmount: "0",
          creditAmount: editSpPayableAmount.toFixed(2),
          narration: `Supplier Cash Payable`,
        });
      }
      if (editDeductionAmount > 0 && editSpDeductionClrAccountId) {
        await tx.insert(voucherEntries).values({
          voucherId,
          ledgerAccountId: editSpDeductionClrAccountId,
          debitAmount: "0",
          creditAmount: editDeductionAmount.toFixed(2),
          narration: `Supplier Payable Deduction (${totalQtySoldEdit} qty × ${editSpDeductionPerQty})`,
        });
      }
    } else if (grandTotalRounded < 0) {
      if (editSpPayableAmount < 0) {
        await tx.insert(voucherEntries).values({
          voucherId,
          ledgerAccountId: editSpPayableAccountId!,
          debitAmount: Math.abs(editSpPayableAmount).toFixed(2),
          creditAmount: "0",
          narration: `Supplier Cash Payable reversal`,
        });
      }
      if (editDeductionAmount > 0 && editSpDeductionClrAccountId) {
        await tx.insert(voucherEntries).values({
          voucherId,
          ledgerAccountId: editSpDeductionClrAccountId,
          debitAmount: editDeductionAmount.toFixed(2),
          creditAmount: "0",
          narration: `Supplier Payable Deduction reversal`,
        });
      }
    }
  }
}
