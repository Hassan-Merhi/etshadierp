import type {
  StockInSalesGrouping,
  StockInSalesReportMetrics,
  StockInSalesReportRow,
} from "./stockInSalesReportService";
import { getStockInSalesReport } from "./stockInSalesReportService";

export interface StockInSalesComparisonSideFilters {
  locationId: number;
  stockGroupIds: number[];
}

export interface StockInSalesComparisonFilters {
  companyId: number;
  startDate?: string;
  endDate?: string;
  grouping: StockInSalesGrouping;
  search?: string;
  sideA: StockInSalesComparisonSideFilters;
  sideB: StockInSalesComparisonSideFilters;
}

export interface StockInSalesComparisonSet {
  sideA: StockInSalesReportMetrics;
  sideB: StockInSalesReportMetrics;
  difference: StockInSalesReportMetrics;
}

export interface StockInSalesComparisonRow extends StockInSalesComparisonSet {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

export interface StockInSalesComparisonResult {
  generatedAt: string;
  filters: Omit<StockInSalesComparisonFilters, "companyId">;
  summary: StockInSalesComparisonSet;
  rows: StockInSalesComparisonRow[];
  rowCount: number;
}

const EMPTY_METRICS: StockInSalesReportMetrics = {
  stockInQty: 0,
  stockInValue: 0,
  stockInAvgRate: 0,
  stockOutQty: 0,
  totalSales: 0,
  costOfSales: 0,
  costProfit: 0,
  avgProfitPerBale: 0,
};

function subtractMetrics(
  sideA: StockInSalesReportMetrics,
  sideB: StockInSalesReportMetrics
): StockInSalesReportMetrics {
  return {
    stockInQty: sideA.stockInQty - sideB.stockInQty,
    stockInValue: sideA.stockInValue - sideB.stockInValue,
    stockInAvgRate: sideA.stockInAvgRate - sideB.stockInAvgRate,
    stockOutQty: sideA.stockOutQty - sideB.stockOutQty,
    totalSales: sideA.totalSales - sideB.totalSales,
    costOfSales: sideA.costOfSales - sideB.costOfSales,
    costProfit: sideA.costProfit - sideB.costProfit,
    avgProfitPerBale: sideA.avgProfitPerBale - sideB.avgProfitPerBale,
  };
}

function indexRows(rows: StockInSalesReportRow[]): Map<string, StockInSalesReportRow> {
  return new Map(rows.map((row) => [row.periodKey, row]));
}

export async function getStockInSalesComparison(
  filters: StockInSalesComparisonFilters
): Promise<StockInSalesComparisonResult> {
  const common = {
    companyId: filters.companyId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    grouping: filters.grouping,
    profitFilter: "all" as const,
    search: filters.search,
  };

  const [sideAReport, sideBReport] = await Promise.all([
    getStockInSalesReport({
      ...common,
      locationIds: [filters.sideA.locationId],
      stockGroupIds: filters.sideA.stockGroupIds,
    }),
    getStockInSalesReport({
      ...common,
      locationIds: [filters.sideB.locationId],
      stockGroupIds: filters.sideB.stockGroupIds,
    }),
  ]);

  const sideARows = indexRows(sideAReport.rows);
  const sideBRows = indexRows(sideBReport.rows);
  const periodKeys = Array.from(new Set([...sideARows.keys(), ...sideBRows.keys()])).sort((a, b) =>
    b.localeCompare(a)
  );

  const rows = periodKeys.map((periodKey): StockInSalesComparisonRow => {
    const sideARow = sideARows.get(periodKey);
    const sideBRow = sideBRows.get(periodKey);
    const sideA = sideARow ?? EMPTY_METRICS;
    const sideB = sideBRow ?? EMPTY_METRICS;
    const boundsSource = sideARow ?? sideBRow;

    return {
      periodKey,
      periodStart: boundsSource?.periodStart ?? periodKey,
      periodEnd: boundsSource?.periodEnd ?? periodKey,
      sideA,
      sideB,
      difference: subtractMetrics(sideA, sideB),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      startDate: filters.startDate,
      endDate: filters.endDate,
      grouping: filters.grouping,
      search: filters.search,
      sideA: filters.sideA,
      sideB: filters.sideB,
    },
    summary: {
      sideA: sideAReport.summary,
      sideB: sideBReport.summary,
      difference: subtractMetrics(sideAReport.summary, sideBReport.summary),
    },
    rows,
    rowCount: rows.length,
  };
}
