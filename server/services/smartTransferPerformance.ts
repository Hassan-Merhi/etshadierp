export type TransferPerformanceClassification =
  | "strong_seller"
  | "good_seller"
  | "normal_seller"
  | "slow_seller"
  | "overstocked"
  | "no_recent_sales";

export interface TransferPerformanceInputs {
  olderTransferQty: number;
  newerTransferQty: number;
  salesAfterOlderTransfer: number;
  salesAfterNewerTransfer: number;
  currentDestinationQty: number;
  latestWindowDays: number;
}

export interface DatedSaleQuantity {
  voucherDate: string;
  quantity: number;
}

export function roundNumber(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateSellThroughPercentage(soldQty: number, transferredQty: number): number {
  if (!Number.isFinite(soldQty) || !Number.isFinite(transferredQty) || transferredQty <= 0) return 0;
  return roundNumber(Math.min(100, Math.max(0, soldQty) / transferredQty * 100), 2);
}

export function calendarDaysInclusive(dateFrom: string, dateTo: string): number {
  const from = new Date(`${dateFrom}T00:00:00.000Z`).getTime();
  const to = new Date(`${dateTo}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 1;
  return Math.floor((to - from) / 86_400_000) + 1;
}

export function calculateDaysToSellThrough(
  sales: DatedSaleQuantity[],
  transferredQty: number,
  transferDate: string
): number | null {
  if (!Number.isFinite(transferredQty) || transferredQty <= 0) return null;

  let cumulative = 0;
  const ordered = sales
    .filter((sale) => sale.voucherDate >= transferDate && Number.isFinite(sale.quantity) && sale.quantity > 0)
    .slice()
    .sort((a, b) => a.voucherDate.localeCompare(b.voucherDate));

  for (const sale of ordered) {
    cumulative += sale.quantity;
    if (cumulative >= transferredQty) {
      return calendarDaysInclusive(transferDate, sale.voucherDate);
    }
  }
  return null;
}

export function classifyTransferPerformance(inputs: TransferPerformanceInputs): TransferPerformanceClassification {
  const totalTransferred = Math.max(0, inputs.olderTransferQty) + Math.max(0, inputs.newerTransferQty);
  const totalSold = Math.max(0, inputs.salesAfterOlderTransfer) + Math.max(0, inputs.salesAfterNewerTransfer);
  const latestDays = Math.max(1, Math.floor(inputs.latestWindowDays));
  const dailySalesRate = Math.max(0, inputs.salesAfterNewerTransfer) / latestDays;
  const overallSellThrough = calculateSellThroughPercentage(totalSold, totalTransferred);

  if (totalSold <= 0) {
    return inputs.currentDestinationQty > 0 ? "overstocked" : "no_recent_sales";
  }

  if (overallSellThrough >= 85) return "strong_seller";
  if (overallSellThrough >= 60) return "good_seller";
  if (overallSellThrough >= 35) return "normal_seller";

  const daysOfStockRemaining = dailySalesRate > 0 ? inputs.currentDestinationQty / dailySalesRate : null;
  if (
    inputs.currentDestinationQty > Math.max(totalSold, totalTransferred * 0.5) ||
    (daysOfStockRemaining !== null && daysOfStockRemaining > 60)
  ) {
    return "overstocked";
  }

  return "slow_seller";
}

export function performanceLabel(classification: TransferPerformanceClassification): string {
  switch (classification) {
    case "strong_seller":
      return "Strong seller";
    case "good_seller":
      return "Good seller";
    case "normal_seller":
      return "Normal seller";
    case "slow_seller":
      return "Slow seller";
    case "overstocked":
      return "Overstocked";
    case "no_recent_sales":
    default:
      return "No recent sales";
  }
}
