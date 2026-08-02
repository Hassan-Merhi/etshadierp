import { eq, and, isNull, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import * as schema from "@shared/schema";
import type { POLineItem, ContainerOffload } from "@shared/schema";
import { getLocationById } from "../inventory";

import { getContainerById, getPurchaseOrdersByContainer } from "./containers";
import { getLineItemsByPO } from "./line-items-charges";

export async function offloadContainer(
  containerId: number,
  locationId: number,
  duties: string,
  dutiesAccountId: number | null | undefined,
  officeCharges: string,
  officeChargesAccountId: number | null | undefined,
  officeChargesCashAccountId: number | null | undefined,
  transferCharges: string,
  transportFees: string,
  transportAccountId: number | null | undefined,
  additionalCharges: Array<{ description: string; amount: number; ledgerAccountId: number }> = [],
  offloadDate?: string,
  inventoryCostCorrections: Array<{ stockItemId: number; correctRate: number }> = []
): Promise<ContainerOffload> {
  const container = await getContainerById(containerId);
  if (!container) throw new Error(`Container ${containerId} not found`);

  const pos = await getPurchaseOrdersByContainer(containerId);
  const allLineItems: POLineItem[] = [];
  for (const po of pos) {
    const items = await getLineItemsByPO(po.id);
    allLineItems.push(...items);
  }

  const totalBales = allLineItems.reduce((sum, item) => {
    if (!item.stockItemId || item.stockItemId === 0) return sum;
    return sum + parseFloat(item.quantity);
  }, 0);

  const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
  const poCharges = parseFloat(container.chargesTotal || "0");
  const totalCharges =
    parseFloat(duties) +
    parseFloat(officeCharges) +
    parseFloat(transferCharges) +
    parseFloat(transportFees) +
    additionalChargesTotal +
    poCharges;

  const additionalCostPerBale = totalBales > 0 ? Math.round((totalCharges / totalBales) * 100) / 100 : 0;
  const expectedChargesApplied = additionalCostPerBale * totalBales;
  const roundingDifference = Math.round((totalCharges - expectedChargesApplied) * 100) / 100;

  const itemsMap = new Map<number, { stockItemId: number; totalQuantity: number; weightedRateSum: number }>();
  for (const item of allLineItems) {
    const stockItemId = item.stockItemId;
    if (!stockItemId || stockItemId === 0) {
      logger.warn(`Skipping line item ${item.id} - invalid stock item ID: ${stockItemId}`);
      continue;
    }
    const quantity = parseFloat(item.quantity);
    const rate = parseFloat(item.rate);
    if (itemsMap.has(stockItemId)) {
      const existing = itemsMap.get(stockItemId)!;
      existing.totalQuantity += quantity;
      existing.weightedRateSum += rate * quantity;
    } else {
      itemsMap.set(stockItemId, { stockItemId, totalQuantity: quantity, weightedRateSum: rate * quantity });
    }
  }

  const offloadItemsToStore: Array<{ stockItemId: number; quantity: number; rate: number; totalValue: number }> = [];
  const itemsArray = Array.from(itemsMap.entries());
  const lastItemIndex = itemsArray.length - 1;

  const offload = await db.transaction(async (tx) => {
    const validCorrectionItemIds = new Set(itemsMap.keys());
    if (inventoryCostCorrections.length > 0) {
      for (const correction of inventoryCostCorrections) {
        if (correction.correctRate <= 0) continue;
        if (!validCorrectionItemIds.has(correction.stockItemId)) continue;
        const correctionRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${correction.stockItemId} FOR UPDATE`
        );
        const corrRow = correctionRows.rows?.[0] || correctionRows[0];
        if (corrRow) {
          const existingQty = parseFloat(corrRow.quantity);
          if (existingQty > 0) {
            const newTotalValue = existingQty * correction.correctRate;
            await tx
              .update(schema.inventory)
              .set({
                averageRate: correction.correctRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, corrRow.id));
          }
        }
      }
    }

    for (let i = 0; i < itemsArray.length; i++) {
      const [stockItemId, data] = itemsArray[i];
      const isLastItem = i === lastItemIndex;
      if (data.totalQuantity === 0) continue;

      const averageOriginalRate = data.weightedRateSum / data.totalQuantity;
      const newRate = averageOriginalRate + additionalCostPerBale;
      let offloadValueCents = Math.round(data.totalQuantity * newRate * 100);
      if (isLastItem && roundingDifference !== 0) {
        offloadValueCents += Math.round(roundingDifference * 100);
      }
      const offloadValue = offloadValueCents / 100;
      const adjustedRate = offloadValue / data.totalQuantity;

      offloadItemsToStore.push({
        stockItemId,
        quantity: data.totalQuantity,
        rate: adjustedRate,
        totalValue: offloadValue,
      });

      if (!isFinite(newRate)) throw new Error(`Calculated rate is infinite for stock item ${stockItemId}`);

      const existingRows = await (tx as any).execute(
        sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId} FOR UPDATE`
      );
      const existing = existingRows.rows?.[0] || existingRows[0];

      if (existing) {
        const existingQty = parseFloat(existing.quantity);
        const existingRate = parseFloat(existing.average_rate);
        const existingValue = parseFloat(existing.total_value || "0");
        const newQty = existingQty + data.totalQuantity;
        let weightedAvgRate: number, newTotalValue: number;

        if (newQty === 0) {
          weightedAvgRate = adjustedRate;
          newTotalValue = 0;
        } else if (newQty < 0) {
          weightedAvgRate = adjustedRate;
          newTotalValue = newQty * adjustedRate;
        } else {
          if (existingQty < 0) {
            newTotalValue = newQty * Math.max(adjustedRate, 0);
          } else {
            newTotalValue = existingValue + offloadValue;
            if (newQty > 0 && newTotalValue < 0) newTotalValue = newQty * Math.max(adjustedRate, 0);
          }
          weightedAvgRate = newQty > 0 ? newTotalValue / newQty : 0;
        }

        if (!isFinite(weightedAvgRate))
          throw new Error(`Calculated weighted average rate is infinite for stock item ${stockItemId}`);

        await tx
          .update(schema.inventory)
          .set({
            quantity: newQty.toString(),
            averageRate: weightedAvgRate.toFixed(2),
            totalValue: newTotalValue.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(schema.inventory.id, existing.id));
      } else {
        const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId));
        if (!location) throw new Error(`Location ${locationId} not found when creating inventory record`);
        await tx.insert(schema.inventory).values({
          companyId: location.companyId,
          locationId,
          stockItemId,
          quantity: data.totalQuantity.toString(),
          averageRate: adjustedRate.toFixed(2),
          totalValue: offloadValue.toFixed(2),
          lastUpdated: new Date(),
        });
      }
    }

    const resolvedOffloadDate = offloadDate || new Date().toISOString().split("T")[0];
    const containerUpdateSet: Record<string, unknown> = { status: "OFFLOADED", offloadDate: resolvedOffloadDate };
    const actualDuties = parseFloat(duties);
    if (actualDuties > 0) containerUpdateSet.dutyFee = duties;
    await tx.update(schema.containers).set(containerUpdateSet).where(eq(schema.containers.id, containerId));

    const location = await getLocationById(locationId);
    if (!location) throw new Error("Location not found");

    const voucherDate = offloadDate || new Date().toISOString().split("T")[0];

    const findOrCreateImportChargesParent = async () => {
      let [parentAccount] = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, "IMPORT_CHARGES"))
        )
        .limit(1);
      if (!parentAccount) {
        [parentAccount] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
            code: "IMPORT_CHARGES",
            name: "Import Charges",
            accountType: "Direct Expense",
            subType: "Direct Expense",
            openingBalance: "0",
            openingBalanceSide: "Dr",
          })
          .returning();
      }
      return parentAccount.id;
    };

    const findOrCreateExpenseAccount = async (code: string, name: string, parentId: number) => {
      let account = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, code)))
        .limit(1);
      if (!account.length) {
        const [newAccount] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
            code,
            name,
            accountType: "Direct Expense",
            subType: "Direct Expense",
            parentId,
            openingBalance: "0",
            openingBalanceSide: "Dr",
          })
          .returning();
        account = [newAccount];
      }
      return account[0].id;
    };

    const importChargesParentId = await findOrCreateImportChargesParent();

    for (const po of pos) {
      if (po.voucherId) {
        await tx
          .update(schema.vouchers)
          .set({
            description: `Purchase Order ${po.poNumber} - Container ${container.containerNumber} (Offloaded)`,
          })
          .where(eq(schema.vouchers.id, po.voucherId));
      }
    }

    if (dutiesAccountId && parseFloat(duties) > 0) {
      const dutiesExpenseAccountId = await findOrCreateExpenseAccount("DUTIES", "Duties", importChargesParentId);
      const voucherNumber = `DUTY-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Duties for container ${container.containerNumber}`,
          totalAmount: duties,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: dutiesExpenseAccountId,
        debitAmount: duties,
        creditAmount: "0",
        narration: `Duties for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: dutiesAccountId,
        debitAmount: "0",
        creditAmount: duties,
        narration: `Duties for container ${container.containerNumber}`,
      });
    }

    if (officeChargesAccountId && officeChargesCashAccountId && parseFloat(officeCharges) > 0) {
      const [officeChargesAccount] = await tx
        .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
        .from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.id, officeChargesAccountId), isNull(schema.ledgerAccounts.deletedAt)))
        .limit(1);
      const officeInvalidTypes = [
        "Expense",
        "Direct Expense",
        "Indirect Expense",
        "Income",
        "Liability",
        "Current Liability",
        "Profit",
        "Government Taxes",
        "COGS",
      ];
      if (!officeChargesAccount || officeInvalidTypes.includes(officeChargesAccount.accountType)) {
        throw new Error(
          `Office charges account "${officeChargesAccount?.name || `ID ${officeChargesAccountId}`}" has type "${officeChargesAccount?.accountType ?? "deleted/not found"}" which is invalid. It must be an Asset-type account.`
        );
      }
      const voucherNumber = `OFFICE-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Office charges for container ${container.containerNumber}`,
          totalAmount: officeCharges,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: officeChargesAccountId,
        debitAmount: officeCharges,
        creditAmount: "0",
        narration: `Office charges for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: officeChargesCashAccountId,
        debitAmount: "0",
        creditAmount: officeCharges,
        narration: `Office charges for container ${container.containerNumber}`,
      });
    }

    if (parseFloat(transportFees) > 0) {
      const transportExpenseAccountId = await findOrCreateExpenseAccount(
        "TRANSPORT",
        "Transport Charges",
        importChargesParentId
      );
      const expenseTypes = ["Expense", "Direct Expense", "Indirect Expense"];

      const getTransportPayableAccount = async () => {
        let transportPayableAccount = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, location.companyId),
              eq(schema.ledgerAccounts.code, "TRANSPORT_PAYABLE"),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        if (!transportPayableAccount.length) {
          const [newAccount] = await tx
            .insert(schema.ledgerAccounts)
            .values({
              companyId: location.companyId,
              code: "TRANSPORT_PAYABLE",
              name: "Transport Fees Payable",
              accountType: "Liability",
              subType: "Current Liability",
              openingBalance: "0",
              openingBalanceSide: "Cr",
            })
            .returning();
          transportPayableAccount = [newAccount];
        }
        return transportPayableAccount[0].id;
      };

      let creditAccountId = transportAccountId;
      if (transportAccountId) {
        const [selectedAccount] = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.id, transportAccountId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(1);
        if (!selectedAccount || expenseTypes.includes(selectedAccount.accountType)) {
          creditAccountId = await getTransportPayableAccount();
        }
      } else {
        creditAccountId = await getTransportPayableAccount();
      }
      if (!creditAccountId) creditAccountId = await getTransportPayableAccount();

      const voucherNumber = `TRANS-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Transport fees for container ${container.containerNumber}`,
          totalAmount: transportFees,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: transportExpenseAccountId,
        debitAmount: transportFees,
        creditAmount: "0",
        narration: `Transport fees for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: creditAccountId,
        debitAmount: "0",
        creditAmount: transportFees,
        narration: `Transport fees for container ${container.containerNumber}`,
      });
    }

    if (parseFloat(transferCharges) > 0) {
      const transferExpenseAccountId = await findOrCreateExpenseAccount(
        "TRANSFER_CHARGES",
        "Transfer Charges",
        importChargesParentId
      );
      let transferPayableAccount = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, "TRANSFER_PAYABLE"),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      if (!transferPayableAccount.length) {
        const [newAccount] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
            code: "TRANSFER_PAYABLE",
            name: "Transfer Charges Payable",
            accountType: "Liability",
            subType: "Current Liability",
            openingBalance: "0",
            openingBalanceSide: "Cr",
          })
          .returning();
        transferPayableAccount = [newAccount];
      }
      const voucherNumber = `XFER-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Transfer charges for container ${container.containerNumber}`,
          totalAmount: transferCharges,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: transferExpenseAccountId,
        debitAmount: transferCharges,
        creditAmount: "0",
        narration: `Transfer charges for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: transferPayableAccount[0].id,
        debitAmount: "0",
        creditAmount: transferCharges,
        narration: `Transfer charges for container ${container.containerNumber}`,
      });
    }

    for (const charge of additionalCharges) {
      if (charge.amount > 0) {
        const [additionalCreditAccount] = await tx
          .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.id, charge.ledgerAccountId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(1);
        if (!additionalCreditAccount)
          throw new Error(
            `Additional charge "${charge.description}" references a deleted or non-existent ledger account (ID: ${charge.ledgerAccountId}).`
          );
        if (
          additionalCreditAccount.accountType === "Direct Expense" ||
          additionalCreditAccount.accountType === "Indirect Expense"
        ) {
          throw new Error(
            `Additional charge "${charge.description}" cannot credit the "${additionalCreditAccount.name}" account (type: ${additionalCreditAccount.accountType}).`
          );
        }
        const additionalExpenseAccountId = await findOrCreateExpenseAccount(
          "ADDITIONAL_CHARGES",
          "Additional Container Charges",
          importChargesParentId
        );
        const voucherNumber = `CHG-${container.containerNumber}-${Date.now()}`;
        const [v] = await tx
          .insert(schema.vouchers)
          .values({
            companyId: location.companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate,
            description: `${charge.description} for container ${container.containerNumber}`,
            totalAmount: charge.amount.toFixed(2),
          })
          .returning();
        await tx.insert(schema.voucherEntries).values({
          voucherId: v.id,
          ledgerAccountId: additionalExpenseAccountId,
          debitAmount: charge.amount.toFixed(2),
          creditAmount: "0",
          narration: `${charge.description} for container ${container.containerNumber}`,
        });
        await tx.insert(schema.voucherEntries).values({
          voucherId: v.id,
          ledgerAccountId: charge.ledgerAccountId,
          debitAmount: "0",
          creditAmount: charge.amount.toFixed(2),
          narration: `${charge.description} for container ${container.containerNumber}`,
        });
      }
    }

    const [offloadRecord] = await tx
      .insert(schema.containerOffloads)
      .values({
        containerId,
        locationId,
        duties,
        officeCharges,
        transferCharges,
        transportFees,
        totalCharges: totalCharges.toFixed(2),
        totalBales: totalBales.toFixed(3),
        additionalCostPerBale: additionalCostPerBale.toFixed(2),
        offloadedAt: offloadDate ? new Date(offloadDate) : new Date(),
      })
      .returning();

    for (const item of offloadItemsToStore) {
      await tx.insert(schema.containerOffloadItems).values({
        offloadId: offloadRecord.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
        totalValue: item.totalValue.toFixed(2),
      });
    }

    return offloadRecord;
  });

  return offload;
}

// ---------------------------------------------------------------------------
// Container Sales
// ---------------------------------------------------------------------------
