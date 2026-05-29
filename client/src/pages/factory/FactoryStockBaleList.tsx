import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ArrowLeft, Package, AlertTriangle } from "lucide-react";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { cn } from "@/lib/utils";

interface StockBale {
  id: number;
  referenceNumber: string;
  baleCode: string;
  weightKg: string;
  stockEntryDate: string | null;
  finalizedAt: string | null;
  productionDate: string | null;
  workerName: string | null;
  lockedInLoading: boolean;
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function FactoryStockBaleList() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const articleCode = params.get("articleCode") || "";
  const productName = params.get("productName") || articleCode;
  const locationId  = params.get("locationId") || "";
  const backUrl     = params.get("back") || "";

  const handleBack = () => {
    if (backUrl) navigate(backUrl);
    else navigate(-1 as any);
  };
  useEscapeBack(handleBack);

  const queryParams = new URLSearchParams({ articleCode });
  if (locationId) queryParams.set("locationId", locationId);

  const { data: bales = [], isLoading } = useQuery<StockBale[]>({
    queryKey: [`/api/factory/bale-stock-list`, articleCode, locationId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/bale-stock-list?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load bales");
      return res.json();
    },
    enabled: !!articleCode,
  });

  const available = bales.filter(b => !b.lockedInLoading);
  const locked    = bales.filter(b => b.lockedInLoading);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-back-bale-list">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title={`IN_STOCK Bales — ${productName}`}
          subtitle={articleCode !== productName ? articleCode : undefined}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      ) : bales.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Package className="h-8 w-8 opacity-30" />
          <p className="text-sm">No IN_STOCK bales found for {articleCode}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="secondary">{available.length} available</Badge>
            {locked.length > 0 && (
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/40">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {locked.length} locked in loading
              </Badge>
            )}
          </div>

          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-3 py-2.5 font-medium border-b text-xs">Reference No.</th>
                  <th className="text-left px-3 py-2.5 font-medium border-b text-xs">Bale Code</th>
                  <th className="text-right px-3 py-2.5 font-medium border-b text-xs">Weight (kg)</th>
                  <th className="text-left px-3 py-2.5 font-medium border-b text-xs">Production Date</th>
                  <th className="text-left px-3 py-2.5 font-medium border-b text-xs">Worker</th>
                  <th className="text-center px-3 py-2.5 font-medium border-b text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {bales.map((bale, idx) => (
                  <tr
                    key={bale.id}
                    className={cn(
                      "border-b last:border-0 transition-colors",
                      idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                      bale.lockedInLoading && "opacity-60",
                    )}
                    data-testid={`row-bale-${bale.referenceNumber}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{bale.referenceNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{bale.baleCode}</td>
                    <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                      {parseFloat(bale.weightKg).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {fmtDate(bale.productionDate ?? bale.finalizedAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{bale.workerName || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {bale.lockedInLoading ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-amber-600 dark:text-amber-400 border-amber-500/40">
                          Loading
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-green-700 dark:text-green-400 border-green-600/40">
                          Available
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
