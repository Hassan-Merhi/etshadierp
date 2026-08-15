import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";

import { ContainerOffloadLifecycleError, ContainerOffloadLifecycleInput, amount } from "./types";

async function getSpAccount(tx: unknown, companyId: number, subType: string) {
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

export async function postSupplierPartnerJournals(
  tx: unknown,
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
