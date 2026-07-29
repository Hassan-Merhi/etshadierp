import {
  buildCompanyTransferPostingRequest,
  createDatabasePostingDependencies,
  postBalancedVoucherTx,
  type PostingActor,
} from "../../services/accounting";
import { requireCompanyAccess } from "./transferRequestContext";
import { TransferRouteError } from "./transferErrors";
import { transferRepository } from "./transferRepository";
import { parseSimpleTransferInput } from "./transferValidation";

const postingDependencies = createDatabasePostingDependencies();

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

  async create(userId: string, input: unknown, actor?: PostingActor) {
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
    const voucherTimestamp = Date.now();

    return transferRepository.transaction(async (tx) => {
      const fromNarration = `Transfer out to ${toCompany.name}`;
      const fromBuilt = buildCompanyTransferPostingRequest({
        companyId: parsed.fromCompanyId,
        voucherNumber: `TR-OUT-${voucherTimestamp}`,
        voucherType: "Payment",
        voucherDate: parsed.transferDate,
        description: `${description} → ${toCompany.name}`,
        debitNarration: fromNarration,
        creditNarration: fromNarration,
        amount: parsed.amount,
        debitLedgerAccountId: fromClearing.id,
        creditLedgerAccountId: parsed.fromLedgerAccountId,
        clientRequestId: parsed.clientRequestId,
        sourceType: "simple-company-transfer",
        sourceSide: "from",
        actor: actor ?? { userId, reason: "Simple company transfer source posting" },
      });
      const fromPosted = await postBalancedVoucherTx(tx, fromBuilt.request, postingDependencies);

      const toNarration = `Transfer in from ${fromCompany.name}`;
      const toBuilt = buildCompanyTransferPostingRequest({
        companyId: parsed.toCompanyId,
        voucherNumber: `TR-IN-${voucherTimestamp}`,
        voucherType: "Receipt",
        voucherDate: parsed.transferDate,
        description: `Transfer from ${fromCompany.name}`,
        debitNarration: toNarration,
        creditNarration: toNarration,
        amount: parsed.amount,
        debitLedgerAccountId: parsed.toLedgerAccountId,
        creditLedgerAccountId: toClearing.id,
        clientRequestId: fromBuilt.clientRequestId,
        sourceType: "simple-company-transfer",
        sourceSide: "to",
        actor: actor ?? { userId, reason: "Simple company transfer destination posting" },
      });
      const toPosted = await postBalancedVoucherTx(tx, toBuilt.request, postingDependencies);

      const existingTransfer = await transferRepository.findTransferByVoucherIdsTx(
        tx,
        Number((fromPosted.voucher as any).id),
        Number((toPosted.voucher as any).id),
      );
      if (existingTransfer) return existingTransfer;

      return transferRepository.createTransferTx(tx, {
        transferType: "Cash",
        fromCompanyId: parsed.fromCompanyId,
        toCompanyId: parsed.toCompanyId,
        transferDate: parsed.transferDate,
        amount: fromBuilt.amount,
        fromLedgerAccountId: parsed.fromLedgerAccountId,
        toLedgerAccountId: parsed.toLedgerAccountId,
        fromVoucherId: (fromPosted.voucher as any).id,
        toVoucherId: (toPosted.voucher as any).id,
        description,
      });
    });
  },

  async delete(userId: string, transferId: number) {
    const transfer = await transferRepository.getSimpleTransfer(transferId);
    if (!transfer) throw new TransferRouteError(404, "Transfer not found");
    await requireCompanyAccess(userId, [transfer.fromCompanyId, transfer.toCompanyId]);

    return transferRepository.transaction(async (tx) => {
      const lockedTransfer = await transferRepository.getSimpleTransferForUpdateTx(tx, transferId);
      if (!lockedTransfer) return { success: true, replayed: true };

      const voucherIds = [lockedTransfer.fromVoucherId, lockedTransfer.toVoucherId]
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      await transferRepository.deleteSimpleTransferTx(tx, transferId);
      await transferRepository.deleteTransferVouchersTx(tx, voucherIds);
      return { success: true, replayed: false };
    });
  },
};
