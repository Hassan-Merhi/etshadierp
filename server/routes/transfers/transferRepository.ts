import { desc, eq, inArray, or } from "drizzle-orm";
import { interCompanyTransfers, ledgerAccounts, voucherEntries, vouchers } from "@shared/schema";

import { db } from "../../db";
import { storage } from "../../storage";

export const transferRepository = {
  getCompany(companyId: number) {
    return storage.getCompanyById(companyId);
  },

  getLedgerAccount(accountId: number) {
    return storage.getLedgerAccountById(accountId);
  },

  listLedgerAccounts(companyId: number, includeHidden = false) {
    return storage.getAllLedgerAccounts(companyId, includeHidden);
  },

  createLedgerAccount(values: any) {
    return storage.createLedgerAccount(values);
  },

  listInterCompanyTransfers(companyId: number) {
    return storage.getAllInterCompanyTransfers(companyId);
  },

  createInterCompanyTransfer(values: any) {
    return storage.createInterCompanyTransfer(values);
  },

  async createVoucher(values: any) {
    const [voucher] = await db.insert(vouchers).values(values).returning();
    return voucher;
  },

  insertVoucherEntry(values: any) {
    return db.insert(voucherEntries).values(values);
  },

  insertVoucherEntries(values: any[]) {
    return db.insert(voucherEntries).values(values);
  },

  async createSimpleTransfer(values: any) {
    const [transfer] = await db.insert(interCompanyTransfers).values(values).returning();
    return transfer;
  },

  getSimpleTransfer(transferId: number) {
    return db
      .select()
      .from(interCompanyTransfers)
      .where(eq(interCompanyTransfers.id, transferId))
      .then((rows) => rows[0] ?? null);
  },

  async listSimpleTransfers(companyId: number) {
    const transfers = await db
      .select()
      .from(interCompanyTransfers)
      .where(
        or(
          eq(interCompanyTransfers.fromCompanyId, companyId),
          eq(interCompanyTransfers.toCompanyId, companyId),
        ),
      )
      .orderBy(desc(interCompanyTransfers.createdAt));

    const accountIds = Array.from(
      new Set(
        transfers
          .flatMap((transfer: any) => [transfer.fromLedgerAccountId, transfer.toLedgerAccountId])
          .filter(Boolean),
      ),
    ) as number[];
    const [companies, accounts] = await Promise.all([
      storage.getAllCompanies(),
      accountIds.length > 0
        ? db.select().from(ledgerAccounts).where(inArray(ledgerAccounts.id, accountIds))
        : Promise.resolve([] as any[]),
    ]);
    const companyMap = new Map(companies.map((company: any) => [company.id, company]));
    const accountMap = new Map(accounts.map((account: any) => [account.id, account]));

    return transfers.map((transfer: any) => ({
      ...transfer,
      fromCompanyName: (companyMap.get(transfer.fromCompanyId) as any)?.name ?? "Unknown",
      toCompanyName: (companyMap.get(transfer.toCompanyId) as any)?.name ?? "Unknown",
      fromAccountName: (accountMap.get(transfer.fromLedgerAccountId) as any)?.name ?? "Unknown",
      toAccountName: (accountMap.get(transfer.toLedgerAccountId) as any)?.name ?? "Unknown",
    }));
  },

  async deleteTransferVoucher(voucherId: number): Promise<void> {
    await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
    await db.delete(vouchers).where(eq(vouchers.id, voucherId));
  },

  deleteSimpleTransfer(transferId: number) {
    return db.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transferId));
  },
};
