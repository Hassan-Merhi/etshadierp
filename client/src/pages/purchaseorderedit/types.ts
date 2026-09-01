/**
 * Types for the PurchaseOrderEdit page.
 *
 * Extracted from PurchaseOrderEdit.tsx during the Phase 4 god-file split.
 */

export interface LineItem {
  id?: number;
  stockItemId: number | null;
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal?: string;
}

export interface StockItem {
  id: number;
  name: string;
  code: string;
}

export interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string;
  supplierCode: string;
  containerId: number;
  containerNumber: string;
  currency: string;
  itemsTotal: string;
  freight: string;
  surcharge: string;
  fumigation: string;
  documentCharges: string;
  discount: string;
  otherCharges: string;
  status: string;
  items: LineItem[];
  freightPaidBy?: string;
  freightOwnAccountId?: number | null;
  freightParentAccountId?: number | null;
}
