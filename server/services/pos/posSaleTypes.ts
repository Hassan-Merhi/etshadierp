/**
 * server/services/pos/posSaleTypes.ts
 *
 * Shared types for the POS sale-creation flow (PHASE 19 structural split).
 * Pure type definitions only — no behavior.
 */

export interface HandlerErrorResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ResolvedPaymentAccount {
  accountType: "cash" | "bank" | "credit";
  accountId: number;
  customerAccount: unknown | null;
}

export interface ValidatedInventoryItem {
  item: unknown;
  inventoryRecord: unknown;
  currentQty: number;
  saleQty: number;
  newQty: number;
  currentRate: number;
}

export interface SupplierPartnerAccountingContext {
  isSpCompany: boolean;
  spPosPayableAccountId: number | null;
  spPosProfitAccountId: number | null;
  spPosCostClrAccountId: number | null;
  spPosDeductionClrAccountId: number | null;
  totalSupplierCost: number;
  spPosDeductionPerQty: number;
  spPosTotalQtySold: number;
}

export interface CreatePosSaleParams {
  currentCompanyId: number;
  userId: string;
  username: string;
  userRole: string | undefined;
  canSellNegativeStock: boolean;
  sessionCashAccountId: number | null | undefined;
  voucherDateFallback: string;
  body: {
    locationId: unknown;
    cashAccountId: unknown;
    paymentAccountType: unknown;
    paymentAccountId: unknown;
    items: unknown[];
    notes: unknown;
    isCreditSale: unknown;
    voucherDate: unknown;
    shiftId: unknown;
    clientSaleId: unknown;
    currency: unknown;
    exchangeRate: unknown;
  };
}
