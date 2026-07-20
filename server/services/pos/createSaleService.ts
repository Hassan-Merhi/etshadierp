/**
 * server/services/pos/createSaleService.ts
 *
 * PHASE 19 — POS Backend Sale Creation Structural Split.
 *
 * Orchestrates the existing POST /api/pos/sales sale-creation flow, calling the
 * extracted functions in the EXACT same order as the original monolithic route
 * handler. No business rule, SQL query, accounting entry, voucher field,
 * transaction boundary, or error message was changed — only relocated.
 *
 * Returns a plain `{ status, body }` result for every outcome (success and
 * validation failures) so the route handler can respond with res.status(status).json(body)
 * unchanged. The two "insufficient stock" / "inventory not found" cases are
 * intentionally still thrown as Error (matching the original behavior) so the
 * route's existing catch-block message-based status mapping keeps working
 * unmodified, and so the row-lock check performed *inside* the DB transaction
 * still triggers a proper rollback.
 */
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import { storage } from "../../storage";
import { logAudit, runIntercompanyPosTransfer } from "../../routes/_helpers";
import { stockItems, stockItemLocationPrices, salesItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { CreatePosSaleParams, HandlerErrorResult } from "./posSaleTypes";
import {
  checkIdempotentSale,
  resolvePosEnforcedCashAccount,
  resolvePaymentAccount,
  validateLocationAccess,
  validateStockItemsExist,
} from "./validateSaleRequest";
import { validateItemsBasic, calculateGrandTotal, validateInventoryAvailability } from "./buildSaleItems";
import { getOrCreateSalesRevenueAccount, fetchSupplierPartnerAccountingContext, insertSaleAccountingEntries } from "./postSaleAccounting";
import { insertSaleVoucher } from "./createSaleVoucher";
import { lockAndDeductInventoryForSaleItem } from "./deductSaleInventory";

function err(result: HandlerErrorResult) {
  return { status: result.status, body: result.body };
}

export async function createPosSale(
  params: CreatePosSaleParams,
  companyType: { isSpCompany: boolean }
): Promise<{ status: number; body: any }> {
  const { currentCompanyId, userId, username, userRole, canSellNegativeStock, sessionCashAccountId, voucherDateFallback, body } =
    params;
  const { isSpCompany } = companyType;
  const isPOSUser = userRole === "POS";

  const {
    locationId,
    cashAccountId,
    paymentAccountId,
    items,
    notes,
    isCreditSale,
    voucherDate: providedVoucherDate,
    shiftId,
    clientSaleId,
    currency,
    exchangeRate,
  } = body;

  // POS cash account enforcement
  const posEnforcedResult = await resolvePosEnforcedCashAccount({
    isPOSUser,
    isCreditSale,
    locationId,
    userId,
    companyId: currentCompanyId,
    sessionCashAccountId,
  });
  if ("error" in posEnforcedResult) return err(posEnforcedResult.error);
  const { posEnforcedCashAccountId } = posEnforcedResult;

  // Determine account type and ID by validating against actual database records
  const accountResult = await resolvePaymentAccount({
    isCreditSale,
    paymentAccountId,
    cashAccountId,
    posEnforcedCashAccountId,
    companyId: currentCompanyId,
  });
  if ("error" in accountResult) return err(accountResult.error);
  const { accountType, accountId, customerAccount } = accountResult;

  console.log("[POS Sale] Payment info:", {
    provided: { paymentAccountType: body.paymentAccountType, paymentAccountId, cashAccountId, isCreditSale },
    resolved: { accountType, accountId },
  });

  // Fix 4: Idempotency — if this clientSaleId was already saved, return the existing sale
  const idempotentResult = await checkIdempotentSale(currentCompanyId, clientSaleId);
  if (idempotentResult) return idempotentResult;

  // Validate required fields
  if (!locationId) {
    return { status: 400, body: { message: "Location is required" } };
  }

  // Validate shiftId if one was provided — if invalid/closed, just ignore it and proceed without a shift
  let effectiveShiftId: number | null = shiftId || null;
  if (effectiveShiftId) {
    const shift = await storage.getShiftById(effectiveShiftId);
    if (!shift || shift.companyId !== currentCompanyId || shift.locationId !== locationId || shift.status !== "open" || shift.userId !== userId) {
      effectiveShiftId = null;
    }
  }
  if (!accountId) {
    return { status: 400, body: { message: isCreditSale ? "Customer is required" : "Payment account is required" } };
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { message: "At least one item is required" } };
  }

  // Input validation assertions for inventory safety
  const parsedLocationId = Number(locationId);
  const basicItemsCheck = validateItemsBasic(locationId, items);
  if (basicItemsCheck) return err(basicItemsCheck.error);

  // Validate and calculate total
  const grandTotalResult = calculateGrandTotal(items);
  if ("error" in grandTotalResult) return err(grandTotalResult.error);
  const { grandTotal } = grandTotalResult;

  // Get or create SALES revenue account (outside transaction for simplicity)
  const salesAccountResult = await getOrCreateSalesRevenueAccount(currentCompanyId);
  if ("error" in salesAccountResult) return err(salesAccountResult.error);
  const { salesAccount } = salesAccountResult;

  // Get location details
  const locationResult = await validateLocationAccess({
    locationId,
    parsedLocationId,
    companyId: currentCompanyId,
    isPOSUser,
    userId,
  });
  if ("error" in locationResult) return err(locationResult.error);
  const { location } = locationResult;

  // STEP 1: Validate inventory availability
  const voucherNumber = `SALES-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const voucherDate = providedVoucherDate || voucherDateFallback;

  // Fix 5: Verify each stockItemId exists, belongs to this company, and is not deleted/merged
  const stockExistsError = await validateStockItemsExist(currentCompanyId, items);
  if (stockExistsError) return err(stockExistsError.error);

  // STEP 1a: Validate inventory rows (best-effort pre-check; authoritative check is inside the transaction)
  // NOTE: throws Error on missing inventory / insufficient stock — propagates to the route's catch block.
  const inventoryValidation = await validateInventoryAvailability(locationId, items, canSellNegativeStock);

  // ── SP company: fetch configured POS accounts & pre-compute supplier cost ──
  const spCtxResult = await fetchSupplierPartnerAccountingContext(isSpCompany, currentCompanyId, location, inventoryValidation);
  if ("error" in spCtxResult) return err(spCtxResult.error);
  const spCtx = spCtxResult;

  // STEP 1b: Create accounting records, update inventory, and create sales items
  // All wrapped in a single DB transaction for atomicity
  const txResult = await db.transaction(async (tx) => {
    const txVoucher = await insertSaleVoucher(tx, {
      companyId: currentCompanyId,
      locationId,
      locationName: location.name,
      voucherNumber,
      voucherDate,
      notes,
      isCreditSale,
      customerAccountName: customerAccount ? (customerAccount as any).name : undefined,
      grandTotal,
      effectiveShiftId,
      clientSaleId,
      currency,
      exchangeRate,
    });

    await insertSaleAccountingEntries(tx, {
      txVoucherId: txVoucher.id,
      voucherNumber,
      grandTotal,
      isCreditSale,
      accountType,
      accountId,
      location,
      customerAccount,
      companyId: currentCompanyId,
      isSpCompany,
      salesAccount,
      spCtx,
      // Thread through the voucher's currency/rate so entries carry dual-currency fields
      currency: currency || "USD",
      exchangeRate: exchangeRate ? String(exchangeRate) : null,
    });

    const txSaleItems: any[] = [];

    for (const validatedItem of inventoryValidation) {
      const { item, currentRate, inventoryRecord, currentQty, saleQty } = validatedItem;

      const { costPrice } = await lockAndDeductInventoryForSaleItem(
        tx,
        parsedLocationId,
        locationId,
        validatedItem,
        canSellNegativeStock,
        currentCompanyId
      );

      const [stockItem] = await tx.select().from(stockItems).where(eq(stockItems.id, item.stockItemId));

      const qty = parseFloat(item.quantity);
      const sellingPrice = parseFloat(item.rate) || 0;
      const totalSales = qty * sellingPrice;
      const totalCost = qty * costPrice;
      const profit = totalSales - totalCost;

      // Get configured selling price from location prices BEFORE insert so we can persist it
      const [locPrice] = await tx
        .select()
        .from(stockItemLocationPrices)
        .where(and(eq(stockItemLocationPrices.stockItemId, item.stockItemId), eq(stockItemLocationPrices.locationId, locationId)))
        .limit(1);
      const configuredPrice = locPrice?.sellingPrice || stockItem?.sellingPrice || "0";
      const configuredPriceNum = parseFloat(configuredPrice);

      await tx.insert(salesItems).values({
        voucherId: txVoucher.id,
        stockItemId: item.stockItemId,
        quantity: qty.toString(),
        sellingPrice: sellingPrice.toFixed(2),
        costPrice: costPrice.toFixed(2),
        totalSales: totalSales.toFixed(2),
        totalCost: totalCost.toFixed(2),
        profit: profit.toFixed(2),
        configuredPrice: configuredPriceNum.toFixed(6),
      });
      const profitPerUnit = sellingPrice - configuredPriceNum;
      const totalProfitVsConfigured = profitPerUnit * qty;

      txSaleItems.push({
        ...item,
        stockItemName: stockItem?.name || "",
        stockItemCode: stockItem?.code || "",
        amount: totalSales.toFixed(2),
        configuredPrice: configuredPriceNum.toFixed(2),
        profitPerUnit: profitPerUnit.toFixed(2),
        totalProfitVsConfigured: totalProfitVsConfigured.toFixed(2),
      });
    }

    return { voucher: txVoucher, saleItems: txSaleItems };
  });

  const voucher = txResult.voucher;
  const saleItems = txResult.saleItems;

  try {
    await logAudit({
      userId,
      username,
      companyId: currentCompanyId,
      action: "create",
      tableName: "vouchers",
      recordId: voucher.id,
      recordIdentifier: voucherNumber,
      changes: {
        voucherNumber: { old: undefined, new: voucherNumber },
        voucherType: { old: undefined, new: "Sales" },
        saleType: { old: undefined, new: isCreditSale ? "Credit Invoice" : "Cash Sale" },
        location: { old: undefined, new: location.name },
        totalAmount: { old: undefined, new: grandTotal.toFixed(2) },
        date: { old: undefined, new: voucherDate },
        itemCount: { old: undefined, new: saleItems.length },
        customer: { old: undefined, new: customerAccount ? (customerAccount as any).name : null },
      },
    });
  } catch {
    /* non-fatal */
  }

  // ── Intercompany POS auto-transfer (non-blocking, cash sales only) ──
  if (!isCreditSale && accountType === "cash") {
    // fire-and-forget; never let errors surface to the client
    runIntercompanyPosTransfer(currentCompanyId, accountId, grandTotal, voucherDate).catch((err) =>
      console.error("[IntercompanyPOS] Unhandled:", err)
    );
  }

  return {
    status: 200,
    body: {
      voucher,
      location,
      items: saleItems,
      grandTotal: grandTotal.toFixed(2),
      voucherNumber,
      saleDate: voucherDate,
      isCreditSale,
      customer: customerAccount
        ? {
            id: customerAccount.id,
            code: customerAccount.code,
            name: customerAccount.name,
          }
        : null,
    },
  };
}
