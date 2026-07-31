/**
 * Types for the ContainerLoadingScan page.
 *
 * Extracted from ContainerLoadingScan.tsx during the Phase 4 god-file split.
 */

export interface Customer {
  id: number;
  legalName: string;
}

export interface Location {
  id: number;
  name: string;
  code?: string;
}

export interface ProformaLine {
  id: number;
  articleCode: string;
  productName: string;
  quantity: number;
  pricePerBale: string;
  weightPerBaleKg?: string | null;
}

export interface Proforma {
  id: number;
  customerId: number;
  name: string;
  isActive: boolean;
  lines: ProformaLine[];
}

export interface OrderBale {
  id: number;
  baleId: number;
  baleReference: string;
  articleCode: string;
  baleName: string;
  weight: string;
  priceUsed: string;
}

export interface OrderDetail {
  id: number;
  customerId: number;
  locationId: number;
  companyId: number;
  orderDate: string;
  status: string;
  proformaIdUsed: number | null;
  totalQtyBales: number;
  containerNotes: string | null;
  bales: OrderBale[];
}
