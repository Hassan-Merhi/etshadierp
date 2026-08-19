import { PackageCheck, PackageX, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface CustomerLoadingSummary {
  totalProducts: number;
  loadedProducts: number;
  neverLoadedProducts: number;
  productCoveragePct: number;
  totalBalesLoaded: number;
  totalKgLoaded: number;
}

interface CustomerLoadingSummaryCardsProps {
  summary?: CustomerLoadingSummary;
  formatNumber: (value: number, maximumFractionDigits?: number) => string;
}

export function CustomerLoadingSummaryCards({ summary, formatNumber }: CustomerLoadingSummaryCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-muted p-2">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total Products</div>
            <div className="text-xl font-semibold">{formatNumber(summary?.totalProducts ?? 0)}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-muted p-2">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Loaded Products</div>
            <div className="text-xl font-semibold">{formatNumber(summary?.loadedProducts ?? 0)}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-muted p-2">
            <PackageX className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Never Loaded</div>
            <div className="text-xl font-semibold">{formatNumber(summary?.neverLoadedProducts ?? 0)}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Product Coverage</div>
          <div className="text-xl font-semibold">{formatNumber(summary?.productCoveragePct ?? 0, 1)}%</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, summary?.productCoveragePct ?? 0)}%` }}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Bales Loaded</div>
          <div className="text-xl font-semibold">{formatNumber(summary?.totalBalesLoaded ?? 0)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatNumber(summary?.totalKgLoaded ?? 0, 1)} kg</div>
        </CardContent>
      </Card>
    </div>
  );
}
