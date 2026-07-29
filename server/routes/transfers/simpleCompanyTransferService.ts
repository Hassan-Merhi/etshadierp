import { requireCompanyAccess } from "./transferRequestContext";
import { TransferRouteError } from "./transferErrors";
import { transferRepository } from "./transferRepository";
import { parseSimpleTransferInput } from "./transferValidation";

async function getOrCreateClearingAccount(companyId: number) {
  const accounts = await transferRepository.listLedgerAccounts(companyId);
  const existing = accounts.find((account: any) => account.code === "TRANSFER-CLEARING");
  if (existing) return existing;
  return transferRepository.createLedgerAccount({
    companyId,
    code: "TRANSFER-CLEARING",
    name: "Transfer Clearing",
    accountType: "Equity",
    openingBalance: "0",
    active: true,
  });
}

export const simpleCompanyTransferService = {
  list(companyId: number) {
    return transferRepository.listSimpleTransfers(companyId);
  },

  listCompanyAccounts(companyId: number) {
    return transferRepository.listLedgerAccounts(companyId, true);
  },

  async create(userId: string, input: unknown) {
    const parsed = parseSimpleTransferInput(input);
    await requireCompanyAccess(userId, [parsed.fromCompanyId, parsed.toCompanyId]);

    const [fromCompany, toCompany] = await Promise.all([
      transferRepository.getCompany(parsed.fromCompanyId),
      transferRepository.getCompany(parsed.toCompanyId),
    ]);
    if (!fromCompany || !toCompany) throw new TransferRouteError(404, "Company not found");

    const description = parsed.description || `Transfer to ${toCompany.name}`;
    const [fromClearing, toClearing] = await Promise.all([
      getOrCreateClearingAccount(parsed.fromCompanyId),
      getOrCreateClearingAccount(parsed.toCompanyId),
    ]);

    const fromVoucher = await transferRepository.createVoucher({
      companyId: parsed.fromCompanyId,
      voucherNumber: `TR-OUT-${Date.now()}`,
      voucherType: "Payment",
      voucherDate: parsed.transferDate,
      description: `${description} → ${toCompany.name}`,
      totalAmount: parsed.amount,
      optional: false,
    });
    await transferRepository.insertVoucherEntries([
      {
        voucherId: fromVoucher.id,
        ledgerAccountId: fromClearing.id,
        debitAmount: parsed.amount,
        creditAmount: "0",
        narration: `Transfer out to ${toCompany.name}`,
      },
      {
        voucherId: fromVoucher.id,
        ledgerAccountId: parsed.fromLedgerAccountId,
        debitAmount: "0",
        creditAmount: parsed.amount,
        narration: `Transfer out to ${toCompany.name}`,
      },
    ]);

    const toVoucher = await transferRepository.createVoucher({
      companyId: parsed.toCompanyId,
      voucherNumber: `TR-IN-${Date.now()}`,
      voucherType: "Receipt",
      voucherDate: parsed.transferDate,
      description: `Transfer from ${fromCompany.name}`,
      totalAmount: parsed.amount,
      optional: false,
    });
    await transferRepository.insertVoucherEntries([
      {
        voucherId: toVoucher.id,
        ledgerAccountId: parsed.toLedgerAccountId,
        debitAmount: parsed.amount,
        creditAmount: "0",
        narration: `Transfer in from ${fromCompany.name}`,
      },
      {
        voucherId: toVoucher.id,
        ledgerAccountId: toClearing.id,
        debitAmount: "0",
        creditAmount: parsed.amount,
        narration: `Transfer in from ${fromCompany.name}`,
      },
    ]);

    return transferRepository.createSimpleTransfer({
      transferType: "Cash",
      fromCompanyId: parsed.fromCompanyId,
      toCompanyId: parsed.toCompanyId,
      transferDate: parsed.transferDate,
      amount: parsed.amount,
      fromLedgerAccountId: parsed.fromLedgerAccountId,
      toLedgerAccountId: parsed.toLedgerAccountId,
      fromVoucherId: fromVoucher.id,
      toVoucherId: toVoucher.id,
      description,
    });
  },

  async delete(userId: string, transferId: number) {
    const transfer = await transferRepository.getSimpleTransfer(transferId);
    if (!transfer) throw new TransferRouteError(404, "Transfer not found");
    await requireCompanyAccess(userId, [transfer.fromCompanyId, transfer.toCompanyId]);

    if (transfer.fromVoucherId) await transferRepository.deleteTransferVoucher(transfer.fromVoucherId);
    if (transfer.toVoucherId) await transferRepository.deleteTransferVoucher(transfer.toVoucherId);
    await transferRepository.deleteSimpleTransfer(transferId);
    return { success: true };
  },
};
