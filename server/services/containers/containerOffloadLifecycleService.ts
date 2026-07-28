import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { reverseInventoryByExactValue } from "../../inventoryHelper";
import * as schema from "@shared/schema";

export type ContainerOffloadLifecycleMode = "create-or-replace" | "replace-only";

export interface ContainerOffloadAdditionalCharge {
  description: string;
  amount: number;
  ledgerAccountId: number;
}

export interface ContainerOffloadAgentCharge {
  description?: string;
  amountUsd: number;
  parentAgentAccountId: number;
}

export interface ContainerOffloadLifecycleInput {
  companyId: number;
  containerId: number;
  mode: ContainerOffloadLifecycleMode;
  locationId: number;
  offloadDate: string;
  duties: string;
  dutiesAccountId?: number | null;
  officeCharges: string;
  officeChargesAccountId?: number | null;
  officeChargesCashAccountId?: number | null;
  transferCharges: string;
  transportFees: string;
  transportAccountId?: number | null;
  additionalCharges?: ContainerOffloadAdditionalCharge[];
  inventoryCostCorrections?: Array<{ stockItemId: number; correctRate: number }>;
  agentChargeLines?: ContainerOffloadAgentCharge[];
}

export interface ContainerOffloadLifecycleResult {
  offload: typeof schema.containerOffloads.$inferSelect;
  companyId: number;
  locationId: number;
  stockItemIds: number[];
  replacedExistingOffload: boolean;
}

export class ContainerOffloadLifecycleError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ContainerOffloadLifecycleError";
  }
}

function amount(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveIds(values: unknown[]): number[] {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))].sort(
    (left, right) => left - right
  );
}

function buildItemMap(
  lineItems: Array<{ stockItemId: number; quantity: string; rate: string }>
): Map<number, { stockItemId: number; totalQuantity: number; weightedRateSum: number }> {
  const items = new Map<number, { stockItemId: number; totalQuantity: number; weightedRateSum: number }>();
  for (const line of lineItems) {
    const stockItemId = Number(line.stockItemId);
    if (!Number.isInteger(stockItemId) || stockItemId <= 0) continue;
    const quantity = amount(line.quantity);
    const rate = amount(line.rate);
    if (items.has(stockItemId)) {
      const current = items.get(stockItemId)!;
      current.totalQuantity += quantity;
      current.weightedRateSum += quantity * rate;
    } else {
      items.set(stockItemId, {
        stockItemId,
        totalQuantity: quantity,
        weightedRateSum: quantity * rate,
      });
    }
  }
  return items;
}

async function deleteVoucherWithEntries(tx: any, voucherId: number): Promise<void> {
  await tx.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, voucherId));
  await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
}

async function reverseExistingOffload(
  tx: any,
  container: typeof schema.containers.$inferSelect,
  existingOffload: typeof schema.containerOffloads.$inferSelect,
  lineItems: Array<{ stockItemId: number; quantity: string; rate: string }>
): Promise<void> {
  const storedItems = await tx
    .select()
    .from(schema.containerOffloadItems)
    .where(eq(schema.containerOffloadItems.offloadId, existingOffload.id));

  if (storedItems.length > 0) {
    for (const item of storedItems) {
      await reverseInventoryByExactValue(
        tx,
        existingOffload.locationId,
        item.stockItemId,
        amount(item.quantity),
        amount(item.totalValue)
      );
    }
  } else {
    const legacyAdditionalCost = amount(existingOffload.additionalCostPerBale);
    const legacyItems = buildItemMap(lineItems);
    for (const [stockItemId, item] of legacyItems) {
      const estimatedValue = item.weightedRateSum + item.totalQuantity * legacyAdditionalCost;
      await reverseInventoryByExactValue(
        tx,
        existingOffload.locationId,
        stockItemId,
        item.totalQuantity,
        estimatedValue
      );
    }
  }

  await tx
    .delete(schema.containerOffloadItems)
    .where(eq(schema.containerOffloadItems.offloadId, existingOffload.id));

  const containerPattern = `%container ${container.containerNumber}%`;
  const localVouchers = await tx
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.companyId, container.companyId),
        sql`(
          (
            LOWER(${schema.vouchers.description}) LIKE LOWER(${containerPattern})
            AND (
              ${schema.vouchers.voucherNumber} LIKE 'DUTY-%' OR
              ${schema.vouchers.voucherNumber} LIKE 'OFFICE-%' OR
              ${schema.vouchers.voucherNumber} LIKE 'TRANS-%' OR
              ${schema.vouchers.voucherNumber} LIKE 'CHG-%' OR
              ${schema.vouchers.voucherNumber} LIKE 'XFER-%'
            )
          )
          OR ${schema.vouchers.voucherNumber} LIKE ${`SP-OTW-REV-ERP-${container.id}-%`}
          OR ${schema.vouchers.voucherNumber} LIKE ${`SP-STOCK-ERP-${container.id}-%`}
          OR ${schema.vouchers.voucherNumber} LIKE ${`SP-AGENT-SETTLE-${container.id}-%`}
        )`
      )
    );

  for (const voucher of localVouchers) {
    await deleteVoucherWithEntries(tx, voucher.id);
  }

  const parentAgentVouchers = await tx
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.companyId, 1),
        sql`${schema.vouchers.voucherNumber} LIKE ${`SP-AGENT-ERP-${container.id}-%`}`
      )
    );
  for (const voucher of parentAgentVouchers) {
    await deleteVoucherWithEntries(tx, voucher.id);
  }

  await tx.delete(schema.containerOffloads).where(eq(schema.containerOffloads.id, existingOffload.id));
}

async function findOrCreateImportChargeAccounts(tx: any, companyId: number) {
  let [parent] = await tx
    .select()
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.companyId, companyId),
        eq(schema.ledgerAccounts.code, "IMPORT_CHARGES"),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    )
    .limit(1);

  if (!parent) {
    [parent] = await tx
      .insert(schema.ledgerAccounts)
      .values({
        companyId,
        code: "IMPORT_CHARGES",
        name: "Import Charges",
        accountType: "Direct Expense",
        subType: "Direct Expense",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      })
      .returning();
  }

  const expense = async (code: string, name: string): Promise<number> => {
    let [row] = await tx
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, companyId),
          eq(schema.ledgerAccounts.code, code),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!row) {
      [row] = await tx
        .insert(schema.ledgerAccounts)
        .values({
          companyId,
          code,
          name,
          accountType: "Direct Expense",
          subType: "Direct Expense",
          parentId: parent.id,
          openingBalance: "0",
          openingBalanceSide: "Dr",
        })
        .returning();
    }
    return row.id;
  };

  const payable = async (code: string, name: string): Promise<number> => {
    let [row] = await tx
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, companyId),
          eq(schema.ledgerAccounts.code, code),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!row) {
      [row] = await tx
        .insert(schema.ledgerAccounts)
        .values({
          companyId,
          code,
          name,
          accountType: "Liability",
          subType: "Current Liability",
          openingBalance: "0",
          openingBalanceSide: "Cr",
        })
        .returning();
    }
    return row.id;
  };

  return { expense, payable };
}

async function postChargeVouchers(
  tx: any,
  container: typeof schema.containers.$inferSelect,
  companyId: number,
  input: ContainerOffloadLifecycleInput
): Promise<void> {
  const accounts = await findOrCreateImportChargeAccounts(tx, companyId);
  const voucherDate = input.offloadDate;

  if (input.dutiesAccountId && amount(input.duties) > 0) {
    const expenseId = await accounts.expense("DUTIES", "Duties");
    const [voucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId,
        voucherNumber: `DUTY-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Duties for container ${container.containerNumber}`,
        totalAmount: input.duties,
      })
      .returning();
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

  if (
    input.officeChargesAccountId &&
    input.officeChargesCashAccountId &&
    amount(input.officeCharges) > 0
  ) {
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
    const [voucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId,
        voucherNumber: `OFFICE-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Office charges for container ${container.containerNumber}`,
        totalAmount: input.officeCharges,
      })
      .returning();
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
    const [voucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId,
        voucherNumber: `TRANS-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Transport fees for container ${container.containerNumber}`,
        totalAmount: input.transportFees,
      })
      .returning();
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
    const [voucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId,
        voucherNumber: `XFER-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `Transfer charges for container ${container.containerNumber}`,
        totalAmount: input.transferCharges,
      })
      .returning();
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

  for (const charge of input.additionalCharges ?? []) {
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
    const [voucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId,
        voucherNumber: `CHG-${container.containerNumber}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate,
        description: `${charge.description} for container ${container.containerNumber}`,
        totalAmount: amountText,
      })
      .returning();
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

async function getSpAccount(tx: any, companyId: number, subType: string) {
  const [account] = await tx
    .select()
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.companyId, companyId),
        eq(schema.ledgerAccounts.subType, subType),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    )
    .limit(1);
  return account;
}

async function postSupplierPartnerJournals(
  tx: any,
  container: typeof schema.containers.$inferSelect,
  purchaseOrders: Array<typeof schema.purchaseOrders.$inferSelect>,
  input: ContainerOffloadLifecycleInput
): Promise<void> {
  const [company] = await tx
    .select({ companyType: schema.companies.companyType, parentCompanyId: schema.companies.parentCompanyId })
    .from(schema.companies)
    .where(eq(schema.companies.id, container.companyId))
    .limit(1);
  if (company?.companyType !== "supplier_partner") return;

  const validAgentLines = (input.agentChargeLines ?? []).filter((line) => line.amountUsd > 0);
  const totalAgentAmount = validAgentLines.reduce((sum, line) => sum + line.amountUsd, 0);
  const totalOtw = amount(container.grandTotal);

  const otw = await getSpAccount(tx, container.companyId, "sp_goods_otw");
  const otwClearing = await getSpAccount(tx, container.companyId, "sp_otw_clearing");
  const stock = await getSpAccount(tx, container.companyId, "sp_stock");
  const costClearing = await getSpAccount(tx, container.companyId, "sp_cost_clearing");
  if (!otw || !otwClearing || !stock || !costClearing) {
    throw new ContainerOffloadLifecycleError(
      "SP OTW, Stock, or Cost Clearing accounts are not configured. Run SP Setup first.",
      400,
      "CONTAINER_OFFLOAD_SP_ACCOUNTS_MISSING"
    );
  }

  let parentIntercompany: typeof schema.ledgerAccounts.$inferSelect | undefined;
  let spIntercompany: typeof schema.ledgerAccounts.$inferSelect | undefined;
  let prepaidExpenses: typeof schema.ledgerAccounts.$inferSelect | undefined;
  const parentCompanyId = Number(company.parentCompanyId ?? 1);
  if (validAgentLines.length > 0) {
    parentIntercompany = await getSpAccount(tx, parentCompanyId, "hadi_sp_intercompany");
    spIntercompany = await getSpAccount(tx, container.companyId, "sp_hadi_intercompany");
    prepaidExpenses = await getSpAccount(tx, container.companyId, "sp_prepaid_expenses");
    if (!parentIntercompany || !spIntercompany || !prepaidExpenses) {
      throw new ContainerOffloadLifecycleError(
        "SP parent-agent intercompany accounts are not configured.",
        400,
        "CONTAINER_OFFLOAD_SP_AGENT_ACCOUNTS_MISSING"
      );
    }
  }

  if (totalOtw > 0) {
    const [reversalVoucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId: container.companyId,
        voucherType: "Journal",
        voucherNumber: `SP-OTW-REV-ERP-${container.id}-${Date.now()}`,
        voucherDate: input.offloadDate,
        description: `Goods OTW Reversal — ERP container #${container.id}`,
        totalAmount: String(totalOtw),
        currency: "USD",
        exchangeRate: "1",
        sourceModule: "SP",
      })
      .returning();

    const poTotals = purchaseOrders
      .map((po) => ({
        supplierId: po.supplierId,
        value:
          amount(po.itemsTotal) +
          amount(po.freight) +
          amount(po.otherCharges) +
          amount(po.surcharge) +
          amount(po.fumigation) +
          amount(po.documentCharges) -
          amount(po.discount),
      }))
      .filter((row) => row.value > 0);

    if (poTotals.length === 0) {
      await tx.insert(schema.voucherEntries).values({
        voucherId: reversalVoucher.id,
        ledgerAccountId: otwClearing.id,
        supplierId: null,
        debitAmount: String(totalOtw),
        creditAmount: "0",
        narration: `OTW Clearing reversal — ERP container #${container.id}`,
      });
    } else {
      const calculatedTotal = poTotals.reduce((sum, row) => sum + row.value, 0);
      for (let index = 0; index < poTotals.length; index += 1) {
        const row = poTotals[index];
        const debit = index === poTotals.length - 1 ? row.value + (totalOtw - calculatedTotal) : row.value;
        if (debit <= 0) {
          throw new ContainerOffloadLifecycleError(
            "SP purchase-order totals do not reconcile to the container OTW value.",
            409,
            "CONTAINER_OFFLOAD_SP_OTW_MISMATCH"
          );
        }
        await tx.insert(schema.voucherEntries).values({
          voucherId: reversalVoucher.id,
          ledgerAccountId: otwClearing.id,
          supplierId: row.supplierId ?? null,
          debitAmount: debit.toFixed(2),
          creditAmount: "0",
          narration: `OTW Clearing reversal — ERP container #${container.id}`,
        });
      }
    }

    await tx.insert(schema.voucherEntries).values({
      voucherId: reversalVoucher.id,
      ledgerAccountId: otw.id,
      debitAmount: "0",
      creditAmount: totalOtw.toFixed(2),
      narration: `Goods OTW reversal — ERP container #${container.id}`,
    });

    const [stockVoucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId: container.companyId,
        voucherType: "Journal",
        voucherNumber: `SP-STOCK-ERP-${container.id}-${Date.now()}`,
        voucherDate: input.offloadDate,
        description: `Stock cost recognition — ERP container #${container.id}`,
        totalAmount: totalOtw.toFixed(2),
        currency: "USD",
        exchangeRate: "1",
        sourceModule: "SP",
      })
      .returning();
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: stockVoucher.id,
        ledgerAccountId: stock.id,
        debitAmount: totalOtw.toFixed(2),
        creditAmount: "0",
        narration: `Stock on floor — ERP container #${container.id}`,
      },
      {
        voucherId: stockVoucher.id,
        ledgerAccountId: costClearing.id,
        debitAmount: "0",
        creditAmount: totalOtw.toFixed(2),
        narration: `Base goods cost payable — ERP container #${container.id}`,
      },
    ]);
  }

  if (validAgentLines.length > 0 && parentIntercompany && spIntercompany && prepaidExpenses) {
    const [settlement] = await tx
      .insert(schema.vouchers)
      .values({
        companyId: container.companyId,
        voucherType: "Journal",
        voucherNumber: `SP-AGENT-SETTLE-${container.id}-${Date.now()}`,
        voucherDate: input.offloadDate,
        description: `Agent charge settlement via parent company — container #${container.id}`,
        totalAmount: totalAgentAmount.toFixed(2),
        currency: "USD",
        exchangeRate: "1",
        sourceModule: "SP",
      })
      .returning();
    await tx.insert(schema.voucherEntries).values([
      {
        voucherId: settlement.id,
        ledgerAccountId: spIntercompany.id,
        debitAmount: totalAgentAmount.toFixed(2),
        creditAmount: "0",
        narration: `Agent charges via parent company — ERP container #${container.id}`,
      },
      {
        voucherId: settlement.id,
        ledgerAccountId: prepaidExpenses.id,
        debitAmount: "0",
        creditAmount: totalAgentAmount.toFixed(2),
        narration: `Prepaid expenses used for agent charges — ERP container #${container.id}`,
      },
    ]);

    const [parentVoucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId: parentCompanyId,
        voucherType: "Journal",
        voucherNumber: `SP-AGENT-ERP-${container.id}-${Date.now()}`,
        voucherDate: input.offloadDate,
        description: `Agent charges for ERP offload — container #${container.id}`,
        totalAmount: totalAgentAmount.toFixed(2),
        currency: "USD",
        exchangeRate: "1",
        sourceModule: "SP",
      })
      .returning();
    await tx.insert(schema.voucherEntries).values({
      voucherId: parentVoucher.id,
      ledgerAccountId: parentIntercompany.id,
      debitAmount: totalAgentAmount.toFixed(2),
      creditAmount: "0",
      narration: `ERP container offload agent charges — container #${container.id}`,
    });
    for (const line of validAgentLines) {
      await tx.insert(schema.voucherEntries).values({
        voucherId: parentVoucher.id,
        ledgerAccountId: line.parentAgentAccountId,
        debitAmount: "0",
        creditAmount: line.amountUsd.toFixed(2),
        narration: `Agent credit for ERP container #${container.id}${line.description ? ` — ${line.description}` : ""}`,
      });
    }
  }
}

export async function executeContainerOffloadLifecycle(
  input: ContainerOffloadLifecycleInput
): Promise<ContainerOffloadLifecycleResult> {
  return db.transaction(async (tx: any) => {
    const [container] = await tx
      .select()
      .from(schema.containers)
      .where(
        and(
          eq(schema.containers.id, input.containerId),
          eq(schema.containers.companyId, input.companyId)
        )
      )
      .limit(1);

    if (!container) {
      throw new ContainerOffloadLifecycleError("Container not found", 404, "CONTAINER_NOT_FOUND");
    }
    if (input.mode === "replace-only" && container.status !== "OFFLOADED") {
      throw new ContainerOffloadLifecycleError(
        "Container must be offloaded before it can be edited.",
        409,
        "CONTAINER_NOT_OFFLOADED"
      );
    }
    if (container.status !== "OTW" && container.status !== "OFFLOADED") {
      throw new ContainerOffloadLifecycleError(
        `Container status ${container.status} cannot be offloaded.`,
        409,
        "CONTAINER_NOT_OFFLOADABLE"
      );
    }

    const [location] = await tx
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, input.locationId),
          eq(schema.locations.companyId, input.companyId),
          isNull(schema.locations.deletedAt)
        )
      )
      .limit(1);
    if (!location) {
      throw new ContainerOffloadLifecycleError(
        "Invalid destination location for the selected company.",
        400,
        "CONTAINER_OFFLOAD_LOCATION_INVALID"
      );
    }

    const purchaseOrders = await tx
      .select()
      .from(schema.purchaseOrders)
      .where(
        and(
          eq(schema.purchaseOrders.containerId, input.containerId),
          eq(schema.purchaseOrders.companyId, input.companyId)
        )
      );
    if (purchaseOrders.length === 0) {
      throw new ContainerOffloadLifecycleError(
        "Container has no purchase orders to offload.",
        400,
        "CONTAINER_OFFLOAD_NO_PURCHASE_ORDERS"
      );
    }

const poIds = purchaseOrders.map(
  (po: typeof schema.purchaseOrders.$inferSelect) => po.id,
);    const lineItems = await tx
      .select({
        stockItemId: schema.poLineItems.stockItemId,
        quantity: schema.poLineItems.quantity,
        rate: schema.poLineItems.rate,
      })
      .from(schema.poLineItems)
      .where(inArray(schema.poLineItems.poId, poIds));
    if (lineItems.length === 0) {
      throw new ContainerOffloadLifecycleError(
        "Container purchase orders have no line items.",
        400,
        "CONTAINER_OFFLOAD_NO_LINE_ITEMS"
      );
    }

    const existingOffloads = await tx
      .select()
      .from(schema.containerOffloads)
      .where(eq(schema.containerOffloads.containerId, input.containerId))
      .orderBy(desc(schema.containerOffloads.id))
      .limit(2);
    if (existingOffloads.length > 1) {
      throw new ContainerOffloadLifecycleError(
        "Multiple offload records exist for this container. Reconcile them before editing.",
        409,
        "CONTAINER_OFFLOAD_DUPLICATE_RECORDS"
      );
    }
    const existingOffload = existingOffloads[0] ?? null;
    const replacing = container.status === "OFFLOADED";
    if (replacing && !existingOffload) {
      throw new ContainerOffloadLifecycleError(
        "The container is marked offloaded but its offload record is missing.",
        409,
        "CONTAINER_OFFLOAD_RECORD_MISSING"
      );
    }
    if (!replacing && existingOffload) {
      throw new ContainerOffloadLifecycleError(
        "An offload record already exists while the container is marked OTW.",
        409,
        "CONTAINER_OFFLOAD_STATE_MISMATCH"
      );
    }

    if (existingOffload) {
      await reverseExistingOffload(tx, container, existingOffload, lineItems);
    }

    const itemMap = buildItemMap(lineItems);
    const totalBales = [...itemMap.values()].reduce((sum, item) => sum + item.totalQuantity, 0);
    if (totalBales <= 0) {
      throw new ContainerOffloadLifecycleError(
        "Container has no positive stock quantity to offload.",
        400,
        "CONTAINER_OFFLOAD_ZERO_QUANTITY"
      );
    }

    const additionalCharges = input.additionalCharges ?? [];
    const totalCharges =
      amount(input.duties) +
      amount(input.officeCharges) +
      amount(input.transferCharges) +
      amount(input.transportFees) +
      additionalCharges.reduce((sum, charge) => sum + charge.amount, 0) +
      amount(container.chargesTotal);
    const additionalCostPerBale = Math.round((totalCharges / totalBales) * 100) / 100;
    const roundingDifference = Math.round((totalCharges - additionalCostPerBale * totalBales) * 100) / 100;
    const storedItems: Array<{ stockItemId: number; quantity: number; rate: number; totalValue: number }> = [];
    const entries = [...itemMap.entries()];

    const validCorrectionIds = new Set(itemMap.keys());
    for (const correction of input.inventoryCostCorrections ?? []) {
      if (correction.correctRate <= 0 || !validCorrectionIds.has(correction.stockItemId)) continue;
      const correctionRows = await tx.execute(
        sql`SELECT * FROM inventory WHERE location_id = ${input.locationId} AND stock_item_id = ${correction.stockItemId} FOR UPDATE`
      );
      const row = correctionRows.rows?.[0] ?? correctionRows[0];
      if (!row) continue;
      const existingQuantity = amount(row.quantity);
      if (existingQuantity <= 0) continue;
      await tx
        .update(schema.inventory)
        .set({
          averageRate: correction.correctRate.toFixed(2),
          totalValue: (existingQuantity * correction.correctRate).toFixed(2),
          lastUpdated: new Date(),
        })
        .where(eq(schema.inventory.id, row.id));
    }

    for (let index = 0; index < entries.length; index += 1) {
      const [stockItemId, item] = entries[index];
      if (item.totalQuantity === 0) continue;
      const originalRate = item.weightedRateSum / item.totalQuantity;
      const newRate = originalRate + additionalCostPerBale;
      let valueCents = Math.round(item.totalQuantity * newRate * 100);
      if (index === entries.length - 1 && roundingDifference !== 0) {
        valueCents += Math.round(roundingDifference * 100);
      }
      const offloadValue = valueCents / 100;
      const adjustedRate = offloadValue / item.totalQuantity;
      if (!Number.isFinite(adjustedRate)) {
        throw new ContainerOffloadLifecycleError(
          `Calculated rate is invalid for stock item ${stockItemId}.`,
          409,
          "CONTAINER_OFFLOAD_RATE_INVALID"
        );
      }

      storedItems.push({
        stockItemId,
        quantity: item.totalQuantity,
        rate: adjustedRate,
        totalValue: offloadValue,
      });

      const inventoryRows = await tx.execute(
        sql`SELECT * FROM inventory WHERE location_id = ${input.locationId} AND stock_item_id = ${stockItemId} FOR UPDATE`
      );
      const current = inventoryRows.rows?.[0] ?? inventoryRows[0];
      if (current) {
        const currentQuantity = amount(current.quantity);
        const currentValue = amount(current.total_value);
        const nextQuantity = currentQuantity + item.totalQuantity;
        let nextValue: number;
        if (nextQuantity === 0) {
          nextValue = 0;
        } else if (nextQuantity < 0) {
          nextValue = nextQuantity * adjustedRate;
        } else if (currentQuantity < 0) {
          nextValue = nextQuantity * Math.max(adjustedRate, 0);
        } else {
          nextValue = currentValue + offloadValue;
          if (nextValue < 0) nextValue = nextQuantity * Math.max(adjustedRate, 0);
        }
        const nextRate = nextQuantity > 0 ? nextValue / nextQuantity : adjustedRate;
        if (!Number.isFinite(nextRate)) {
          throw new ContainerOffloadLifecycleError(
            `Calculated weighted rate is invalid for stock item ${stockItemId}.`,
            409,
            "CONTAINER_OFFLOAD_WEIGHTED_RATE_INVALID"
          );
        }
        await tx
          .update(schema.inventory)
          .set({
            quantity: nextQuantity.toString(),
            averageRate: nextRate.toFixed(2),
            totalValue: nextValue.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(schema.inventory.id, current.id));
      } else {
        await tx.insert(schema.inventory).values({
          companyId: input.companyId,
          locationId: input.locationId,
          stockItemId,
          quantity: item.totalQuantity.toString(),
          averageRate: adjustedRate.toFixed(2),
          totalValue: offloadValue.toFixed(2),
          lastUpdated: new Date(),
        });
      }
    }

    await tx
      .update(schema.containers)
      .set({
        status: "OFFLOADED",
        offloadDate: input.offloadDate,
        dutyFee: amount(input.duties) > 0 ? input.duties : "0",
      })
      .where(eq(schema.containers.id, input.containerId));

    for (const po of purchaseOrders) {
      if (!po.voucherId) continue;
      await tx
        .update(schema.vouchers)
        .set({ description: `Purchase Order ${po.poNumber} - Container ${container.containerNumber} (Offloaded)` })
        .where(eq(schema.vouchers.id, po.voucherId));
    }

    await postChargeVouchers(tx, container, input.companyId, input);

    const [offload] = await tx
      .insert(schema.containerOffloads)
      .values({
        containerId: input.containerId,
        locationId: input.locationId,
        duties: input.duties,
        officeCharges: input.officeCharges,
        transferCharges: input.transferCharges,
        transportFees: input.transportFees,
        totalCharges: totalCharges.toFixed(2),
        totalBales: totalBales.toFixed(3),
        additionalCostPerBale: additionalCostPerBale.toFixed(2),
        offloadedAt: new Date(`${input.offloadDate}T00:00:00.000Z`),
      })
      .returning();

    for (const item of storedItems) {
      await tx.insert(schema.containerOffloadItems).values({
        offloadId: offload.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
        totalValue: item.totalValue.toFixed(2),
      });
    }

    await postSupplierPartnerJournals(tx, container, purchaseOrders, input);

    return {
      offload,
      companyId: input.companyId,
      locationId: input.locationId,
      stockItemIds: positiveIds(storedItems.map((item) => item.stockItemId)),
      replacedExistingOffload: replacing,
    };
  });
}
