import { TransferRouteError } from "./transferErrors";
import { transferRepository } from "./transferRepository";
import { parseInterCompanyTransferInput } from "./transferValidation";

async function getOrCreateInterCompanyAccount(params: {
  companyId: number;
  code: string;
  name: string;
  accountType: "Asset" | "Liability";
  accounts: any[];
}) {
  const existing = params.accounts.find((account: any) => account.code === params.code);
  if (existing) return existing;
  return transferRepository.createLedgerAccount({
    companyId: params.companyId,
    code: params.code,
    name: params.name,
    accountType: params.accountType,
    openingBalance: "0",
    active: true,
  });
}

export const interCompanyTransferService = {
  list(companyId: number) {
    return transferRepository.listInterCompanyTransfers(companyId);
  },

  async create(input: unknown) {
    const parsed = parseInterCompanyTransferInput(input);
    const [fromCompany, toCompany, fromAccount, toAccount, fromAccounts, toAccounts] = await Promise.all([
      transferRepository.getCompany(parsed.fromCompanyId),
      transferRepository.getCompany(parsed.toCompanyId),
      transferRepository.getLedgerAccount(parsed.fromLedgerAccountId),
      transferRepository.getLedgerAccount(parsed.toLedgerAccountId),
      transferRepository.listLedgerAccounts(parsed.fromCompanyId),
      transferRepository.listLedgerAccounts(parsed.toCompanyId),
    ]);

    if (!fromCompany) throw new TransferRouteError(404, "From company not found");
    if (!toCompany) throw new TransferRouteError(404, "To company not found");
    if (!fromAccount || fromAccount.companyId !== parsed.fromCompanyId) {
      throw new TransferRouteError(404, "From ledger account not found or doesn't belong to from company");
    }
    if (!toAccount || toAccount.companyId !== parsed.toCompanyId) {
      throw new TransferRouteError(404, "To ledger account not found or doesn't belong to to company");
    }

    const fromInterCompanyAccount = await getOrCreateInterCompanyAccount({
      companyId: parsed.fromCompanyId,
      code: `IC-TO-${toCompany.code}`,
      name: `Inter-Company - ${toCompany.name}`,
      accountType: "Asset",
      accounts: fromAccounts,
    });
    const toInterCompanyAccount = await getOrCreateInterCompanyAccount({
      companyId: parsed.toCompanyId,
      code: `IC-FROM-${fromCompany.code}`,
      name: `Inter-Company - ${fromCompany.name}`,
      accountType: "Liability",
      accounts: toAccounts,
    });

    const fromVoucherNumber = `ICT-FROM-${Date.now()}`;
    const fromVoucher = await transferRepository.createVoucher({
      companyId: parsed.fromCompanyId,
      voucherNumber: fromVoucherNumber,
      voucherType: "Payment",
      voucherDate: parsed.transferDate,
      description: parsed.description || `Inter-company transfer to ${toCompany.name}`,
      totalAmount: parsed.amount,
    });
    await transferRepository.insertVoucherEntry({
      voucherId: fromVoucher.id,
      ledgerAccountId: fromInterCompanyAccount.id,
      debitAmount: parsed.amount,
      creditAmount: "0",
      narration: `Transfer to ${toCompany.name} - ${fromVoucherNumber}`,
    });
    await transferRepository.insertVoucherEntry({
      voucherId: fromVoucher.id,
      ledgerAccountId: parsed.fromLedgerAccountId,
      debitAmount: "0",
      creditAmount: parsed.amount,
      narration: `Transfer to ${toCompany.name} - ${fromVoucherNumber}`,
    });

    const toVoucherNumber = `ICT-TO-${Date.now()}`;
    const toVoucher = await transferRepository.createVoucher({
      companyId: parsed.toCompanyId,
      voucherNumber: toVoucherNumber,
      voucherType: "Receipt",
      voucherDate: parsed.transferDate,
      description: parsed.description || `Inter-company transfer from ${fromCompany.name}`,
      totalAmount: parsed.amount,
    });
    await transferRepository.insertVoucherEntry({
      voucherId: toVoucher.id,
      ledgerAccountId: parsed.toLedgerAccountId,
      debitAmount: parsed.amount,
      creditAmount: "0",
      narration: `Transfer from ${fromCompany.name} - ${toVoucherNumber}`,
    });
    await transferRepository.insertVoucherEntry({
      voucherId: toVoucher.id,
      ledgerAccountId: toInterCompanyAccount.id,
      debitAmount: "0",
      creditAmount: parsed.amount,
      narration: `Transfer from ${fromCompany.name} - ${toVoucherNumber}`,
    });

    return transferRepository.createInterCompanyTransfer({
      ...parsed,
      fromVoucherId: fromVoucher.id,
      toVoucherId: toVoucher.id,
    });
  },
};
