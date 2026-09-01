/**
 * Types for the SalesReportDetail page.
 *
 * Extracted from SalesReportDetail.tsx during the Phase 4 god-file split.
 */

export type PLFilter = "all" | "gain" | "loss";

export type PLBasis = "config" | "cost";

export interface SalesReportItem {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  locationId: number | null;
  locationName: string | null;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  actualSellingPrice: string;
  configuredSellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  totalConfiguredCost: number;
  costProfit: string;
  costProfitPercentage: number;
  configuredProfit: number;
  configuredProfitPercentage: number;
  isCreditSale?: boolean;
  customerName?: string | null;
  createdAt: string;
  companyId?: number;
  companyCode?: string;
  companyName?: string;
}

export interface LocationSummary {
  locationKey: string;
  locationId: number | null;
  locationName: string;
  totalQty: number;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  items: SalesReportItem[];
}

export interface ItemGroup {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  totalQty: number;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  locationBreakdown: LocationSummary[];
}

export interface VoucherGroup {
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  createdAt: string;
  locationName: string;
  totalQty: number;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  items: SalesReportItem[];
}
