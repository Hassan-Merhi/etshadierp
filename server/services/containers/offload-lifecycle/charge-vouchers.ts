import type { DbTransaction } from "../../../db";
import {
  infrastructurePostingIdentity,
  insertInfrastructureVoucherTx,
} from "../../accounting/infrastructureVoucherIdentity";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";

import { findOrCreateImportChargeAccounts } from "./charge-accounts";
import { ContainerOffloadLifecycleError, ContainerOffloadLifecycleInput, amount } from "./types";

export async function postChargeVouchers(
  tx: DbTransaction,
  container: typeof schema.containers.$inferSelect,
  companyId: number,
  input: ContainerOffloadLifecycleInput
): Promise<void> {
  const accounts = await findOrCreateImportChargeAccounts(tx, companyId);
  const voucherDate = input.offloadDate;

  if (input.dutiesAccountId && amount(input.duties) > 0) {
    const expenseId = await accounts.expense("DUTIES", "Duties");
    const { voucher: voucher } = await insertInfrastructureVoucherTx(
      tx,
      {
        companyId,
        voucherNumber: `DUTY-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Duties for container ${container.containerNumber}`,
        totalAmount: input.duties,
      },
      infrastructurePostingIdentity("container-offload-charge", `${companyId}:${container.id}`, "duties"),
      { amount: input.duties, accountId: input.dutiesAccountId }
    );
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: voucher.id,
        ledgerAccountId: expenseId,
        debitAmount: input.duties,
        creditAmount: "0",
        narration: `Duties for container ${container.containerNumber}`,
      },
      {
        voucherId: voucher.id,
        ledgerAccountId: input.dutiesAccountId,
        debitAmount: "0",
        creditAmount: input.duties,
        narration: `Duties for container ${container.containerNumber}`,
      },
    ]);
  }

  if (input.officeChargesAccountId && input.officeChargesCashAccountId && amount(input.officeCharges) > 0) {
    const [officeAccount] = await tx
      .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.id, input.officeChargesAccountId),
          eq(schema.ledgerAccounts.companyId, companyId),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);
    const invalidTypes = new Set([
      "Expense",
      "Direct Expense",
      "Indirect Expense",
      "Income",
      "Liability",
      "Current Liability",
      "Profit",
      "Government Taxes",
      "COGS",
    ]);
    if (!officeAccount || invalidTypes.has(officeAccount.accountType)) {
      throw new ContainerOffloadLifecycleError(
        `Office charges account "${officeAccount?.name ?? `ID ${input.officeChargesAccountId}`}" must be an Asset-type account.`,
        400,
        "CONTAINER_OFFLOAD_OFFICE_ACCOUNT_INVALID"
      );
    }
    const { voucher: voucher } = await insertInfrastructureVoucherTx(
      tx,
      {
        companyId,
        voucherNumber: `OFFICE-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Office charges for container ${container.containerNumber}`,
        totalAmount: input.officeCharges,
      },
      infrastructurePostingIdentity("container-offload-charge", `${companyId}:${container.id}`, "office"),
      {
        amount: input.officeCharges,
        accountId: input.officeChargesAccountId,
        cashAccountId: input.officeChargesCashAccountId,
      }
    );
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: voucher.id,
        ledgerAccountId: input.officeChargesAccountId,
        debitAmount: input.officeCharges,
        creditAmount: "0",
        narration: `Office charges for container ${container.containerNumber}`,
      },
      {
        voucherId: voucher.id,
        ledgerAccountId: input.officeChargesCashAccountId,
        debitAmount: "0",
        creditAmount: input.officeCharges,
        narration: `Office charges for container ${container.containerNumber}`,
      },
    ]);
  }

  if (amount(input.transportFees) > 0) {
    const expenseId = await accounts.expense("TRANSPORT", "Transport Charges");
    let creditAccountId = input.transportAccountId ?? null;
    if (creditAccountId) {
      const [selected] = await tx
        .select({ accountType: schema.ledgerAccounts.accountType })
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.id, creditAccountId),
            eq(schema.ledgerAccounts.companyId, companyId),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      if (!selected || ["Expense", "Direct Expense", "Indirect Expense"].includes(selected.accountType)) {
        creditAccountId = await accounts.payable("TRANSPORT_PAYABLE", "Transport Fees Payable");
      }
    } else {
      creditAccountId = await accounts.payable("TRANSPORT_PAYABLE", "Transport Fees Payable");
    }
    const { voucher: voucher } = await insertInfrastructureVoucherTx(
      tx,
      {
        companyId,
        voucherNumber: `TRANS-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Transport fees for container ${container.containerNumber}`,
        totalAmount: input.transportFees,
      },
      infrastructurePostingIdentity("container-offload-charge", `${companyId}:${container.id}`, "transport"),
      { amount: input.transportFees, accountId: creditAccountId }
    );
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: voucher.id,
        ledgerAccountId: expenseId,
        debitAmount: input.transportFees,
        creditAmount: "0",
        narration: `Transport fees for container ${container.containerNumber}`,
      },
      {
        voucherId: voucher.id,
        ledgerAccountId: creditAccountId,
        debitAmount: "0",
        creditAmount: input.transportFees,
        narration: `Transport fees for container ${container.containerNumber}`,
      },
    ]);
  }

  if (amount(input.transferCharges) > 0) {
    const expenseId = await accounts.expense("TRANSFER_CHARGES", "Transfer Charges");
    const payableId = await accounts.payable("TRANSFER_PAYABLE", "Transfer Charges Payable");
    const { voucher: voucher } = await insertInfrastructureVoucherTx(
      tx,
      {
        companyId,
        voucherNumber: `XFER-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Transfer charges for container ${container.containerNumber}`,
        totalAmount: input.transferCharges,
      },
      infrastructurePostingIdentity("container-offload-charge", `${companyId}:${container.id}`, "transfer"),
      { amount: input.transferCharges, accountId: payableId }
    );
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: voucher.id,
        ledgerAccountId: expenseId,
        debitAmount: input.transferCharges,
        creditAmount: "0",
        narration: `Transfer charges for container ${container.containerNumber}`,
      },
      {
        voucherId: voucher.id,
        ledgerAccountId: payableId,
        debitAmount: "0",
        creditAmount: input.transferCharges,
        narration: `Transfer charges for container ${container.containerNumber}`,
      },
    ]);
  }

  for (const [chargeIndex, charge] of (input.additionalCharges ?? []).entries()) {
    if (charge.amount <= 0) continue;
    const [creditAccount] = await tx
      .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.id, charge.ledgerAccountId),
          eq(schema.ledgerAccounts.companyId, companyId),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!creditAccount) {
      throw new ContainerOffloadLifecycleError(
        `Additional charge "${charge.description}" references an unavailable ledger account.`,
        400,
        "CONTAINER_OFFLOAD_ADDITIONAL_ACCOUNT_INVALID"
      );
    }
    if (["Direct Expense", "Indirect Expense"].includes(creditAccount.accountType)) {
      throw new ContainerOffloadLifecycleError(
        `Additional charge "${charge.description}" cannot credit the "${creditAccount.name}" expense account.`,
        400,
        "CONTAINER_OFFLOAD_ADDITIONAL_ACCOUNT_TYPE_INVALID"
      );
    }
    const expenseId = await accounts.expense("ADDITIONAL_CHARGES", "Additional Container Charges");
    const amountText = charge.amount.toFixed(2);
    const { voucher: voucher } = await insertInfrastructureVoucherTx(
      tx,
      {
        companyId,
        voucherNumber: `CHG-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `${charge.description} for container ${container.containerNumber}`,
        totalAmount: amountText,
      },
      infrastructurePostingIdentity(
        "container-offload-charge",
        `${companyId}:${container.id}:${chargeIndex}`,
        "additional"
      ),
      { charge }
    );
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: voucher.id,
        ledgerAccountId: expenseId,
        debitAmount: amountText,
        creditAmount: "0",
        narration: `${charge.description} for container ${container.containerNumber}`,
      },
      {
        voucherId: voucher.id,
        ledgerAccountId: charge.ledgerAccountId,
        debitAmount: "0",
        creditAmount: amountText,
        narration: `${charge.description} for container ${container.containerNumber}`,
      },
    ]);
  }
}
