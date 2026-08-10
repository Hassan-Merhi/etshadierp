import type { DailySummary, SalesReportItem } from "@/pages/salesreportlegacy/types";

export interface SalesReportSummaryTotals {
  itemCount: number;
  totalQty: number;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
}

export interface SalesReportCompanyOption {
  code: string;
  name: string;
}

export interface SalesReportSummaryResponse {
  groups: DailySummary[];
  totals: SalesReportSummaryTotals;
  companies: SalesReportCompanyOption[];
}

export const EMPTY_SALES_REPORT_TOTALS: SalesReportSummaryTotals = {
  itemCount: 0,
  totalQty: 0,
  totalSales: 0,
  totalCost: 0,
  totalConfiguredCost: 0,
  costProfit: 0,
  configuredProfit: 0,
};

export async function fetchSalesReportSummary(url: string): Promise<SalesReportSummaryResponse> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Sales report summary failed: ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.groups) || !data.totals) {
    throw new Error("Invalid sales report summary response");
  }
  return data as SalesReportSummaryResponse;
}

export async function fetchSalesReportRows(url: string): Promise<SalesReportItem[]> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Sales report export failed: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid sales report export response");
  return data as SalesReportItem[];
}
