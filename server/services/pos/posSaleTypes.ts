/**
 * server/services/pos/posSaleTypes.ts
 *
 * Shared types for the POS sale-creation flow (PHASE 19 structural split).
 * Pure type definitions only — no behavior.
 */

export interface HandlerErrorResult {
  status: number;
  body: Record<string, any>;
}

export interface ResolvedPaymentAccount {
  accountType: "cash" | "bank" | "credit";
  accountId: number;
  customerAccount: any | null;
}

export interface ValidatedInventoryItem {
  item: any;
  inventoryRecord: any;
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
    locationId: any;
    cashAccountId: any;
    paymentAccountType: any;
    paymentAccountId: any;
    items: any[];
    notes: any;
    isCreditSale: any;
    voucherDate: any;
    shiftId: any;
    clientSaleId: any;
    currency: any;
    exchangeRate: any;
  };
}
