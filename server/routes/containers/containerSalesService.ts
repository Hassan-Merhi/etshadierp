import { eq } from "drizzle-orm";
import {
  containers,
  containerSales,
  insertContainerSaleSchema,
  voucherEntries,
  vouchers,
} from "@shared/schema";

import { db } from "../../db";
import { storage } from "../../storage";

export class ContainerSaleRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ContainerSaleRouteError";
  }
}

async function resolveCommissionAccountId(companyId: number, requestedAccountId?: number | null): Promise<number> {
  if (requestedAccountId) {
    const commissionAccount = await storage.getLedgerAccountById(requestedAccountId);
    if (!commissionAccount) {
      throw new ContainerSaleRouteError(404, "Commission account not found");
    }
    if (commissionAccount.companyId !== companyId) {
      throw new ContainerSaleRouteError(403, "Commission account belongs to a different company");
    }
    return commissionAccount.id;
  }

  const accounts = await storage.getAllLedgerAccounts(companyId);
  let commissionAccount = accounts.find((account: any) => account.code === "COMMISSION_REVENUE");
  if (!commissionAccount) {
    commissionAccount = await storage.createLedgerAccount({
      companyId,
      code: "COMMISSION_REVENUE",
      name: "Commission Revenue",
      accountType: "Income",
      openingBalance: "0",
      active: true,
    });
  }
  return commissionAccount.id;
}

export const containerSalesService = {
  list(companyId: number) {
    return storage.getContainerSales(companyId);
  },

  listByCustomer(customerId: number, companyId: number) {
    return storage.getContainerSalesByCustomer(customerId, companyId);
  },

  async create(companyId: number, input: unknown) {
    const parsed = insertContainerSaleSchema.parse({
      ...(input && typeof input === "object" ? input : {}),
      companyId,
    });

    const [customer, container, existingSale] = await Promise.all([
      storage.getCustomerById(parsed.customerId),
      storage.getContainerById(parsed.containerId),
      storage.getContainerSaleByContainerId(parsed.containerId, companyId),
    ]);

    if (!customer) throw new ContainerSaleRouteError(404, "Customer not found");
    if (customer.companyId !== companyId) {
      throw new ContainerSaleRouteError(403, "Customer belongs to a different company");
    }
    if (!container) throw new ContainerSaleRouteError(404, "Container not found");
    if (container.companyId !== companyId) {
      throw new ContainerSaleRouteError(403, "Container belongs to a different company");
    }
    if (existingSale) throw new ContainerSaleRouteError(400, "Container has already been sold");
    if (!customer.ledgerAccountId) {
      throw new ContainerSaleRouteError(400, "Customer does not have a ledger account");
    }

    const commissionAccountId = await resolveCommissionAccountId(companyId, parsed.commissionAccountId);
    return db.transaction(async (tx) => {
      const voucherNumber = `CS-${Date.now()}`;
      const [voucher] = await tx
        .insert(vouchers)
        .values({
          companyId,
          voucherNumber,
          voucherType: "Sales",
          voucherDate: parsed.saleDate,
          description: parsed.notes || `Container sale - ${container.containerNumber} to ${customer.legalName}`,
          totalAmount: parsed.totalAmount,
        })
        .returning();

      await tx.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: customer.ledgerAccountId,
        debitAmount: parsed.totalAmount,
        creditAmount: "0",
        narration: `Container sale - ${voucherNumber}`,
      });
      await tx.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: commissionAccountId,
        debitAmount: "0",
        creditAmount: parsed.totalAmount,
        narration: `Container sale commission - ${voucherNumber}`,
      });

      const [createdSale] = await tx
        .insert(containerSales)
        .values({
          ...parsed,
          commissionAccountId,
          voucherId: voucher.id,
        })
        .returning();

      await tx.update(containers).set({ status: "SOLD" }).where(eq(containers.id, parsed.containerId));
      return createdSale;
    });
  },
};
