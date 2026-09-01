/**
 * Types for the FactoryInvoiceDetail page.
 *
 * Extracted from FactoryInvoiceDetail.tsx during the Phase 4 god-file split.
 */

export interface OrderLine {
  articleCode: string;
  baleName: string;
  qty: number;
  weightPerBale: number;
  totalWeight: number;
  pricePerBale: number;
  totalPrice: number;
  pricingMode?: string;
  pricePerKg?: number;
}

export interface OrderBale {
  id: number;
  baleId: number;
  baleReference: string;
  locationId: number;
  weight: number;
  articleCode: string;
  baleName: string;
  priceUsed: number;
}

export interface OrderCharge {
  id: number;
  name: string;
  amount: string;
  chargeType: string;
  ledgerAccountId?: number;
  voucherId?: number;
}

export interface OrderDetail {
  id: number;
  companyId: number;
  customerId: number;
  orderDate: string;
  status: string;
  invoiceNumber?: string;
  subtotalBales: string;
  freightAmount: string;
  otherChargesTotal: string;
  grandTotal: string;
  totalQtyBales: number;
  customerName: string;
  customerCode: string;
  containerNumber?: string | null;
  shippingCompany?: string | null;
  destination?: string | null;
  lines: OrderLine[];
  bales: OrderBale[];
  charges: OrderCharge[];
  dispatchBatchId?: number | null;
}
