import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Package, ChevronRight } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";

interface StockGroupSummary {
  id: number;
  code: string;
  name: string;
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
  itemCount: number;
}

interface ClosingStockData {
  stockGroups: StockGroupSummary[];
  grandTotal: {
    quantity: number;
    rate: number;
    value: number;
  };
}

function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatQty(value: number): string {
  if (value === 0) return "";
  return `${formatNumber(value)} BL`;
}

function formatValue(value: number): string {
  if (value === 0) return "";
  return formatNumber(value);
}

export default function ClosingStockSummary() {
  const [, navigate] = useLocation();
  const { selectedCompany } = useCompany();

  const { data, isLoading } = useQuery<ClosingStockData>({
    queryKey: ["/api/reports/closing-stock-summary", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const handleGroupClick = (groupId: number, groupName: string) => {
    navigate(`/closing-stock/${groupId}?name=${encodeURIComponent(groupName)}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/analytics")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Closing Stock Summary
          </h1>
          <p className="text-muted-foreground text-sm">
            Current inventory values - {selectedCompany?.name}
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-primary text-primary-foreground">
          <div className="grid grid-cols-4 p-3 font-semibold text-sm">
            <div className="col-span-1">Particulars</div>
            <div className="col-span-3 text-center border-l border-primary-foreground/30">
              Closing Balance
            </div>
          </div>
          <div className="grid grid-cols-4 px-3 pb-2 text-xs">
            <div></div>
            <div className="text-right">Quantity</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Value</div>
          </div>
        </div>

        <div className="divide-y">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data?.stockGroups && data.stockGroups.length > 0 ? (
            <>
              {data.stockGroups.map((group) => (
                <div
                  key={group.id}
                  className="grid grid-cols-4 p-3 cursor-pointer hover-elevate"
                  onClick={() => handleGroupClick(group.id, group.name)}
                  data-testid={`row-stock-group-${group.id}`}
                >
                  <div className="font-medium flex items-center gap-1">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    {group.name}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatQty(group.closing.quantity)}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatValue(group.closing.rate)}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatValue(group.closing.value)}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No closing stock data available.
            </div>
          )}
        </div>

        {data?.grandTotal && (
          <div className="bg-muted/50 border-t-2 border-primary">
            <div className="grid grid-cols-4 p-3 font-bold">
              <div>Grand Total</div>
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.quantity)} BL
              </div>
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.rate)}
              </div>
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.value)}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
