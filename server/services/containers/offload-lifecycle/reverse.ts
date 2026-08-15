import { and, eq, sql } from "drizzle-orm";
import { reverseInventoryByExactValue } from "../../../inventoryHelper";
import * as schema from "@shared/schema";

import { amount, buildItemMap } from "./types";

async function deleteVoucherWithEntries(tx: unknown, voucherId: number): Promise<void> {
  await tx.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, voucherId));
  await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
}

export async function reverseExistingOffload(
  tx: unknown,
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

  await tx.delete(schema.containerOffloadItems).where(eq(schema.containerOffloadItems.offloadId, existingOffload.id));

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
