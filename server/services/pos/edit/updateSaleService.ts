/**
 * server/services/pos/edit/updateSaleService.ts
 *
 * PHASE 20 — POS Backend Edit-Sale Structural Split.
 *
 * Program 2C keeps the existing edit formulas and response contract, while
 * moving the authoritative voucher, location, currency, accounting-entry, and
 * sales-item reads under one transaction lock. Concurrent edits therefore use
 * the latest committed sale state instead of stale pre-transaction snapshots.
 */
import { db } from "../../../db";
import { logger } from "../../../lib/logger";
import { storage } from "../../../storage";
import { logAudit, recalculateIntercompanyForDate } from "../../../routes/_helpers";
import { salesItems, voucherEntries, stockItems, vouchers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { HandlerErrorResult, UpdatePosSaleParams } from "./posEditSaleTypes";
import { fetchSpEditAccountingContext, fetchSpEditDeductionPerQty } from "./posEditSaleHelpers";
import { isReadonlyMigratedVoucher, READONLY_MIGRATED_VOUCHER_MESSAGE } from "../../../lib/migratedVoucherGuard";
import {
  validateItemsPositive,
  loadAndValidateExistingVoucher,
  applyPosRoleRestrictions,
  resolveEditLocations,
  validateNewLocationBelongsToCompany,
} from "./validateEditSaleRequest";
import { reverseOriginalSaleInventory, clearOldSaleRecords } from "./reverseOriginalSaleInventory";
import { rebuildSaleItems } from "./rebuildSaleItems";
import { updateVoucherRecord } from "./updateSaleVoucher";
import { rebuildSaleAccountingEntries } from "./rebuildSaleAccounting";

function err(result: HandlerErrorResult) {
  return { status: result.status, body: result.body };
}

export async function updatePosSale(params: UpdatePosSaleParams): Promise<{ status: number; body: unknown }> {
  const { voucherId, currentCompanyId, userId, username, userRole, canSellNegativeStock, body } = params;

  // Detect supplier_partner for SP-specific accounting on edit
  const spContextResult = await fetchSpEditAccountingContext(currentCompanyId);
  if ("error" in spContextResult) return err(spContextResult.error);
  const { isSpCompanyEdit, editSpPayableAccountId, editSpDeductionClrAccountId } = spContextResult.context;

  const {
    description,
    items,
    paymentAccountType: rawPaymentAccountType,
    paymentAccountId: rawPaymentAccountId,
    isCreditSale,
    voucherDate,
    locationId: newLocationId,
  } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { message: "At least one item is required" } };
  }

  validateItemsPositive(items);

  // Fast validation before opening the transaction. The same state-sensitive
  // checks are repeated against the locked voucher below.
  const voucherResult = await loadAndValidateExistingVoucher(voucherId, currentCompanyId);
  if ("error" in voucherResult) return err(voucherResult.error);
  const preExistingVoucher = voucherResult.existingVoucher;

  if (isReadonlyMigratedVoucher(preExistingVoucher)) {
    return err({ status: 403, body: { message: READONLY_MIGRATED_VOUCHER_MESSAGE } });
  }

  const preRestrictionResult = applyPosRoleRestrictions(userRole, newLocationId, preExistingVoucher.locationId);
  if ("error" in preRestrictionResult) return err(preRestrictionResult.error);

  const paymentAccountType = rawPaymentAccountType;
  const paymentAccountId = rawPaymentAccountId;

  const transactionResult: any = await db.transaction(async (tx) => {
    const [lockedVoucher] = await tx
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, currentCompanyId)))
      .for("update");

    if (!lockedVoucher || lockedVoucher.deletedAt) {
      return { error: { status: 404, body: { message: "Voucher not found" } } };
    }
    if (lockedVoucher.voucherType !== "Sales") {
      return {
        error: {
          status: 400,
          body: { message: "Only Sales vouchers can be updated with this endpoint" },
        },
      };
    }
    if (isReadonlyMigratedVoucher(lockedVoucher)) {
      return { error: { status: 403, body: { message: READONLY_MIGRATED_VOUCHER_MESSAGE } } };
    }

    const restrictionResult = applyPosRoleRestrictions(userRole, newLocationId, lockedVoucher.locationId);
    if ("error" in restrictionResult) return restrictionResult;

    if (!lockedVoucher.locationId) {
      return { error: { status: 400, body: { message: "Existing sale is missing a location" } } };
    }

    const { targetLocationId, oldLocationId, locationChanged } = resolveEditLocations(
      lockedVoucher.locationId,
      newLocationId
    );

    if (locationChanged) {
      const newLocationResult = await validateNewLocationBelongsToCompany(
        targetLocationId,
        oldLocationId,
        currentCompanyId,
        tx
      );
      if ("error" in newLocationResult) return newLocationResult;
    }

    const editSpDeductionPerQty = await fetchSpEditDeductionPerQty(isSpCompanyEdit, targetLocationId, tx);

    // Voucher entries are loaded after the voucher lock, so account preservation
    // and historical currency reconstruction use the latest committed edit.
    const oldEntries = await tx.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

    // Lock the current sales items in the same transaction. A second edit waits,
    // then sees the first edit's committed voucher, entries, location, and items.
    const oldSalesItems = await tx.select().from(salesItems).where(eq(salesItems.voucherId, voucherId)).for("update");
    oldSalesItems.sort((a, b) => a.stockItemId - b.stockItemId);

    const oldItemsMap = new Map(oldSalesItems.map((item) => [item.id, item]));

    await reverseOriginalSaleInventory(tx, lockedVoucher, oldSalesItems);
    await clearOldSaleRecords(tx, voucherId);

    const rebuildResult = await rebuildSaleItems(tx, {
      voucherId,
      targetLocationId,
      items,
      oldItemsMap,
      canSellNegativeStock,
      companyId: lockedVoucher.companyId,
    });

    await updateVoucherRecord(tx, {
      voucherId,
      description,
      grandTotal: rebuildResult.grandTotal,
      locationChanged,
      targetLocationId,
      oldLocationId,
      voucherDate,
    });

    await rebuildSaleAccountingEntries(tx, {
      voucherId,
      oldEntries,
      grandTotal: rebuildResult.grandTotal,
      paymentAccountType,
      paymentAccountId,
      isSpCompanyEdit,
      editSpPayableAccountId,
      editSpDeductionClrAccountId,
      totalQtySoldEdit: rebuildResult.totalQtySoldEdit,
      editSpDeductionPerQty,
      currency: lockedVoucher.currency || "USD",
      exchangeRate: lockedVoucher.exchangeRate ? String(lockedVoucher.exchangeRate) : null,
    });

    return {
      existingVoucher: lockedVoucher,
      targetLocationId,
      grandTotal: rebuildResult.grandTotal,
      totalQtySoldEdit: rebuildResult.totalQtySoldEdit,
    };
  });

  if (transactionResult.error) return err(transactionResult.error);

  const existingVoucher = transactionResult.existingVoucher;
  const targetLocationId = transactionResult.targetLocationId;

  // Fetch updated data to return for print template
  const [updatedVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, voucherId)).limit(1);

  const updatedSalesItems = await db
    .select({
      id: salesItems.id,
      stockItemId: salesItems.stockItemId,
      stockItemName: stockItems.name,
      stockItemCode: stockItems.code,
      quantity: salesItems.quantity,
      sellingPrice: salesItems.sellingPrice,
      costPrice: salesItems.costPrice,
      totalSales: salesItems.totalSales,
      totalCost: salesItems.totalCost,
      profit: salesItems.profit,
      rate: salesItems.sellingPrice,
      rateUSD: salesItems.sellingPrice,
    })
    .from(salesItems)
    .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
    .where(eq(salesItems.voucherId, voucherId));

  const updatedLocation = await storage.getLocationById(targetLocationId);

  let customerAccount = null;
  if (isCreditSale) {
    const updatedEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
    const debitEntry = updatedEntries.find((entry) => parseFloat(entry.debitAmount || "0") > 0);
    if (debitEntry?.ledgerAccountId) {
      customerAccount = await storage.getLedgerAccountById(debitEntry.ledgerAccountId);
    }
  }

  // Recalculate INTERCO vouchers for affected date(s) (non-blocking).
  const oldDate = existingVoucher.voucherDate;
  const newDate = voucherDate || oldDate;
  const datesToRecalc = new Set<string>([oldDate]);
  if (newDate !== oldDate) datesToRecalc.add(newDate);
  for (const date of datesToRecalc) {
    recalculateIntercompanyForDate(currentCompanyId, date).catch((error) =>
      logger.error("[IntercompanyPOS Recalc] Unhandled:", { error })
    );
  }

  try {
    const changes: Record<string, { old?: unknown; new?: unknown }> = {};
    if (existingVoucher.totalAmount !== updatedVoucher.totalAmount)
      changes.totalAmount = { old: existingVoucher.totalAmount, new: updatedVoucher.totalAmount };
    if (existingVoucher.voucherDate !== updatedVoucher.voucherDate)
      changes.date = { old: existingVoucher.voucherDate, new: updatedVoucher.voucherDate };
    if (existingVoucher.locationId !== updatedVoucher.locationId)
      changes.locationId = { old: existingVoucher.locationId, new: updatedVoucher.locationId };
    changes.itemCount = { new: updatedSalesItems.length };
    await logAudit({
      userId,
      username,
      companyId: currentCompanyId,
      action: "update",
      tableName: "vouchers",
      recordId: voucherId,
      recordIdentifier: updatedVoucher.voucherNumber,
      changes,
    });
  } catch {
    /* non-fatal */
  }

  return {
    status: 200,
    body: {
      voucher: updatedVoucher,
      location: updatedLocation,
      items: updatedSalesItems,
      grandTotal: updatedVoucher.totalAmount,
      voucherNumber: updatedVoucher.voucherNumber,
      saleDate: updatedVoucher.voucherDate,
      isCreditSale: !!isCreditSale,
      customer: customerAccount
        ? { id: customerAccount.id, code: customerAccount.code, name: customerAccount.name }
        : null,
    },
  };
}
