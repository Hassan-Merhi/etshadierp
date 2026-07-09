/**
 * server/services/pos/edit/updateSaleService.ts
 *
 * PHASE 20 — POS Backend Edit-Sale Structural Split.
 *
 * Orchestrates the existing PUT /api/vouchers/:id/sales edit-sale flow,
 * calling the extracted functions in the EXACT same order as the original
 * monolithic route handler. No business rule, SQL query, accounting entry,
 * voucher field, transaction boundary, or error message was changed — only
 * relocated.
 *
 * Returns a plain `{ status, body }` result for every outcome (success and
 * validation failures) so the route handler can respond with
 * res.status(status).json(body) unchanged. Errors that were previously
 * thrown and mapped to a status code in the route's catch block (Insufficient
 * stock / Inventory not found / etc.) are still thrown as Error here for the
 * same reason.
 */
import { db } from "../../../db";
import { storage } from "../../../storage";
import { logAudit, recalculateIntercompanyForDate } from "../../../routes/_helpers";
import { salesItems, voucherEntries, stockItems, vouchers } from "@shared/schema";
import { eq } from "drizzle-orm";
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

export async function updatePosSale(params: UpdatePosSaleParams): Promise<{ status: number; body: any }> {
  const { voucherId, currentCompanyId, userId, username, userRole, canSellNegativeStock, body } = params;

  // Detect supplier_partner for SP-specific accounting on edit
  const spContextResult = await fetchSpEditAccountingContext(currentCompanyId);
  if ("error" in spContextResult) return err(spContextResult.error);
  const { isSpCompanyEdit, editSpPayableAccountId, editSpDeductionClrAccountId } = spContextResult.context;

  const { description, items, paymentAccountType: rawPaymentAccountType, paymentAccountId: rawPaymentAccountId, isCreditSale, voucherDate, locationId: newLocationId } =
    body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { message: "At least one item is required" } };
  }

  // Validate all items have positive quantities and prices
  validateItemsPositive(items);

  // Get existing voucher to validate it's a Sales voucher in the current company
  const voucherResult = await loadAndValidateExistingVoucher(voucherId, currentCompanyId);
  if ("error" in voucherResult) return err(voucherResult.error);
  const { existingVoucher } = voucherResult;

  if (isReadonlyMigratedVoucher(existingVoucher as any)) {
    return err({ status: 403, body: { message: READONLY_MIGRATED_VOUCHER_MESSAGE } });
  }

  // POS restrictions on existing sales (location-change block only — see
  // applyPosRoleRestrictions for why the original payment-account "strip" was
  // a no-op that must not actually be applied here).
  const posRestrictionResult = applyPosRoleRestrictions(userRole, newLocationId, existingVoucher.locationId);
  if ("error" in posRestrictionResult) return err(posRestrictionResult.error);
  const paymentAccountType = rawPaymentAccountType;
  const paymentAccountId = rawPaymentAccountId;

  // Determine target location - use new location if provided, otherwise keep existing
  const oldLocationId = existingVoucher.locationId!;
  const { targetLocationId, locationChanged } = resolveEditLocations(oldLocationId, newLocationId);

  // SP edit: load target location's per-qty deduction rate
  const editSpDeductionPerQty = await fetchSpEditDeductionPerQty(isSpCompanyEdit, targetLocationId);

  // Validate new location belongs to company if changed
  if (locationChanged) {
    const newLocationResult = await validateNewLocationBelongsToCompany(targetLocationId, oldLocationId, currentCompanyId);
    if ("error" in newLocationResult) return err(newLocationResult.error);
  }

  // Get existing voucher entries to recreate them
  const oldEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

  let grandTotal = 0;
  let totalQtySoldEdit = 0;

  // Begin transaction
  await db.transaction(async (tx) => {
    // Read + lock the CURRENT old sales items INSIDE the transaction (not before it
    // starts). If two edits of the same voucher race (two tabs, a double-submit, or
    // a network retry), this FOR UPDATE lock forces them to run strictly one after
    // the other: the second edit sees the first edit's already-committed items as
    // its "old" state, instead of both reversing the same stale pre-transaction
    // snapshot and double-counting inventory.
    const oldSalesItems = await tx
      .select()
      .from(salesItems)
      .where(eq(salesItems.voucherId, voucherId))
      .for("update");
    // Sort by stockItemId so the reversal loop always acquires locks in a
    // consistent order — prevents deadlocks with concurrent sale transactions.
    oldSalesItems.sort((a, b) => a.stockItemId - b.stockItemId);

    // Create map of old items by line ID for cost preservation (not stockItemId to handle duplicates)
    const oldItemsMap = new Map(oldSalesItems.map((item) => [item.id, item]));

    // Reverse old inventory movements
    await reverseOriginalSaleInventory(tx, existingVoucher, oldSalesItems);

    // Delete old sales items and voucher entries
    await clearOldSaleRecords(tx, voucherId);

    // Create new sales items and apply new inventory movements
    const rebuildResult = await rebuildSaleItems(tx, {
      voucherId,
      targetLocationId,
      items,
      oldItemsMap,
      canSellNegativeStock,
      companyId: existingVoucher.companyId,
    });
    grandTotal = rebuildResult.grandTotal;
    totalQtySoldEdit = rebuildResult.totalQtySoldEdit;

    // Update voucher description, total amount, location, and optionally date
    await updateVoucherRecord(tx, {
      voucherId,
      description,
      grandTotal,
      locationChanged,
      targetLocationId,
      oldLocationId,
      voucherDate,
    });

    // Recreate voucher entries with new total
    await rebuildSaleAccountingEntries(tx, {
      voucherId,
      oldEntries,
      grandTotal,
      paymentAccountType,
      paymentAccountId,
      isSpCompanyEdit,
      editSpPayableAccountId,
      editSpDeductionClrAccountId,
      totalQtySoldEdit,
      editSpDeductionPerQty,
    });
  });

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
    const debitEntry = updatedEntries.find((e) => parseFloat(e.debitAmount || "0") > 0);
    if (debitEntry?.ledgerAccountId) {
      customerAccount = await storage.getLedgerAccountById(debitEntry.ledgerAccountId);
    }
  }

  // ── Recalculate INTERCO vouchers for affected date(s) (non-blocking) ──
  // Always recalculate old date; if date changed, also recalculate new date.
  const oldDate = existingVoucher.voucherDate;
  const newDate = voucherDate || oldDate;
  const datesToRecalc = new Set<string>([oldDate]);
  if (newDate !== oldDate) datesToRecalc.add(newDate);
  for (const d of datesToRecalc) {
    recalculateIntercompanyForDate(currentCompanyId, d).catch((error) =>
      console.error("[IntercompanyPOS Recalc] Unhandled:", error)
    );
  }

  try {
    const _posChanges: Record<string, { old: any; new: any }> = {};
    if (existingVoucher.totalAmount !== updatedVoucher.totalAmount)
      _posChanges.totalAmount = { old: existingVoucher.totalAmount, new: updatedVoucher.totalAmount };
    if (existingVoucher.voucherDate !== updatedVoucher.voucherDate)
      _posChanges.date = { old: existingVoucher.voucherDate, new: updatedVoucher.voucherDate };
    if (existingVoucher.locationId !== updatedVoucher.locationId)
      _posChanges.locationId = { old: existingVoucher.locationId, new: updatedVoucher.locationId };
    _posChanges.itemCount = { new: updatedSalesItems.length };
    await logAudit({
      userId,
      username,
      companyId: currentCompanyId,
      action: "update",
      tableName: "vouchers",
      recordId: voucherId,
      recordIdentifier: updatedVoucher.voucherNumber,
      changes: _posChanges,
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
