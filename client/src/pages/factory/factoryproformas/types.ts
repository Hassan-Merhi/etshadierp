/**
 * Types for the FactoryProformas page.
 *
 * Extracted from FactoryProformas.tsx during the Phase 4 god-file split.
 */

export interface ProformaLine {
  id: number;
  proformaId: number;
  articleCode: string;
  productName: string;
  quantity: number;
  pricePerBale: string;
  weightPerBaleKg?: string | null;
  pricingMode?: string | null;
  pricePerKg?: string | null;
}

export interface Proforma {
  id: number;
  customerId: number;
  companyId: number;
  name: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lines: ProformaLine[];
}

export interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}
