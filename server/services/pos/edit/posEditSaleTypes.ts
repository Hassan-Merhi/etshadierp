/**
 * server/services/pos/edit/posEditSaleTypes.ts
 *
 * Shared types for the POS edit-sale flow (PHASE 20 structural split).
 * Pure type definitions only — no behavior.
 */

export interface HandlerErrorResult {
  status: number;
  body: Record<string, any>;
}

/** Result of fetching the supplier-partner accounting configuration for edit-sale. */
export interface SpEditAccountingContext {
  isSpCompanyEdit: boolean;
  editSpPayableAccountId: number | null;
  editSpProfitAccountId: number | null;
  editSpCostClrAccountId: number | null;
  editSpDeductionClrAccountId: number | null;
}

export interface UpdatePosSaleParams {
  voucherId: number;
  currentCompanyId: number;
  userId: string;
  username: string;
  userRole: string | undefined;
  canSellNegativeStock: boolean;
  body: {
    description: any;
    items: any[];
    paymentAccountType: any;
    paymentAccountId: any;
    isCreditSale: any;
    voucherDate: any;
    locationId: any;
  };
}
