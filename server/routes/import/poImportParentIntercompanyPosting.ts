import { infrastructurePostingIdentity } from "../../services/accounting/infrastructureVoucherIdentity";
import { runWithVerifiedParentCompanyScope } from "../../services/security/parentCompanyPostingScope";
import { storage } from "../../storage";

export interface ParentIntercompanyPostingInput {
  parentCompanyId: number;
  subsidiaryName: string;
  supplierId: number;
  supplier?: { legalName?: string | null } | null;
  poNumber: string;
  containerNumber: string;
  importDate: string;
  poIntercoTotal: number;
  poGrandTotal: number;
  poFreight: number;
  freightPaidBy: string;
  freightParentAccountId: number | null;
}

/**
 * Mirrors a linked Supplier Partner purchase into its parent company.
 *
 * The subsidiary keeps its own OTW voucher untouched; this posts only the parent-side journal so
 * the parent's supplier balance carries the payable without double-counting the local purchase:
 *
 *   DR "<Subsidiary> Credit" receivable (goods, plus freight when the parent pays it)
 *   CR supplier (goods only)
 *   CR parent freight account (freight, when parent-paid)
 *
 * Every write here lands in a company the request is not pinned to, so the whole block runs inside
 * the verified parent scope, which re-checks the parent link and the caller's membership in it.
 */
export async function postParentIntercompanyJournal(input: ParentIntercompanyPostingInput): Promise<void> {
  const {
    parentCompanyId,
    subsidiaryName,
    supplierId,
    supplier,
    poNumber,
    containerNumber,
    importDate,
    poIntercoTotal,
    poGrandTotal,
    poFreight,
    freightPaidBy,
    freightParentAccountId,
  } = input;

  await runWithVerifiedParentCompanyScope(parentCompanyId, async () => {
    const subsidiaryAccountName = `${subsidiaryName} Credit`;
    let subsidiaryReceivableAccount = await storage.getLedgerAccountByName(subsidiaryAccountName, parentCompanyId);

    if (!subsidiaryReceivableAccount) {
      let code = subsidiaryName.substring(0, 3).toUpperCase() + "CRD";
      let suffix = 1;
      while (await storage.getLedgerAccountByCode(code, parentCompanyId)) {
        code = subsidiaryName.substring(0, 3).toUpperCase() + "CRD" + suffix;
        suffix++;
      }
      subsidiaryReceivableAccount = await storage.createLedgerAccount({
        companyId: parentCompanyId,
        name: subsidiaryAccountName,
        code,
        accountType: "Asset",
        subType: "Current Asset",
      });
    }

    const parentPaysFreight = freightPaidBy === "parent" && poFreight > 0;
    const intercoParentTotal = parentPaysFreight ? poGrandTotal : poIntercoTotal;
    const narration = `${subsidiaryName} PO ${poNumber} - Container ${containerNumber}`;

    const parentVoucher = await storage.createVoucher({
      companyId: parentCompanyId,
      postingSource: infrastructurePostingIdentity(
        "po-import",
        `${parentCompanyId}:${poNumber}`,
        "parent-intercompany"
      ),
      currency: "USD",
      voucherNumber: `IC-${poNumber}-${Date.now()}`,
      voucherType: "Journal",
      voucherDate: importDate,
      description: `${containerNumber} ${supplier?.legalName || "Unknown"}`,
      totalAmount: intercoParentTotal.toString(),
      optional: false,
      sourceModule: "ERP",
    });

    await storage.createVoucherEntry({
      voucherId: parentVoucher.id,
      ledgerAccountId: subsidiaryReceivableAccount.id,
      debitAmount: intercoParentTotal.toFixed(2),
      creditAmount: "0",
      narration,
    });

    await storage.createVoucherEntry({
      voucherId: parentVoucher.id,
      supplierId,
      debitAmount: "0",
      creditAmount: poIntercoTotal.toFixed(2),
      narration,
    });

    if (parentPaysFreight && freightParentAccountId) {
      await storage.createVoucherEntry({
        voucherId: parentVoucher.id,
        ledgerAccountId: freightParentAccountId,
        debitAmount: "0",
        creditAmount: poFreight.toFixed(2),
        narration: `Freight - ${narration}`,
      });
    }
  });
}
