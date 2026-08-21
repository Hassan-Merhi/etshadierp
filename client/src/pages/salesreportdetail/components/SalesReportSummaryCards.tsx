import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/formatNumber";
import { profitColor } from "../utils";

interface SalesReportSummaryCardsProps {
  totalQty: number;
  totalSales: number;
  totalCost: number;
  costProfit: number;
  totalConfiguredCost: number;
  configuredProfit: number;
  formatAmount: (value: number) => string;
}

export function SalesReportSummaryCards(props: SalesReportSummaryCardsProps) {
  const { totalQty, totalSales, totalCost, costProfit, totalConfiguredCost, configuredProfit, formatAmount } = props;
  return (
    <>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Total Qty</CardDescription>
            <CardTitle className="text-lg">{formatNumber(totalQty)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Total Sales</CardDescription>
            <CardTitle className="text-lg">{formatAmount(totalSales)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Cost Total</CardDescription>
            <CardTitle className="text-lg">{formatAmount(totalCost)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Cost Profit</CardDescription>
            <CardTitle className={`text-lg ${profitColor(costProfit)}`}>{formatAmount(Math.abs(costProfit))}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Hassan's Total</CardDescription>
            <CardTitle className="text-lg">{formatAmount(totalConfiguredCost)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Hassan's Profit</CardDescription>
            <CardTitle className={`text-lg ${profitColor(configuredProfit)}`}>
              {formatAmount(Math.abs(configuredProfit))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
