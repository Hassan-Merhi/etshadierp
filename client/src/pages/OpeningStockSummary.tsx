import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useBackToParent } from "@/hooks/use-back-to-parent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Package, ChevronRight } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { PageHeader } from "@/components/PageHeader";

interface StockGroupSummary {
  id: number;
  code: string;
  name: string;
  opening: {
    quantity: number;
    rate: number;
    value: number;
  };
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
  itemCount: number;
}

interface OpeningStockData {
  stockGroups: StockGroupSummary[];
  grandTotal: {
    opening: { quantity: number; value: number };
    closing: { quantity: number; value: number };
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

export default function OpeningStockSummary() {
  const [, navigate] = useLocation();
  const handleBack = useBackToParent();
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();

  const { data, isLoading } = useQuery<OpeningStockData>({
    queryKey: ["/api/reports/opening-stock-summary", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const handleGroupClick = (groupId: number, groupName: string) => {
    navigate(`/opening-stock/${groupId}?name=${encodeURIComponent(groupName)}`);
  };

  // Calculate grand total rates
  const openingRate = data?.grandTotal?.opening?.quantity && data.grandTotal.opening.quantity > 0
    ? data.grandTotal.opening.value / data.grandTotal.opening.quantity
    : 0;
  const closingRate = data?.grandTotal?.closing?.quantity && data.grandTotal.closing.quantity > 0
    ? data.grandTotal.closing.value / data.grandTotal.closing.quantity
    : 0;

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <PageHeader title="Opening Stock Summary" icon={<Package className="h-5 w-5" />} />
          <p className="text-muted-foreground text-sm">
            {selectedCompany?.name}
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        {/* Header */}
        <div className="bg-primary text-primary-foreground">
          <div className="grid grid-cols-2 sm:grid-cols-7 p-2 sm:p-3 font-semibold text-xs sm:text-sm">
            <div className="col-span-1">Particulars</div>
            <div className="col-span-1 sm:col-span-3 text-center border-l border-primary-foreground/30">
              Opening Balance
            </div>
            <div className="hidden sm:block col-span-3 text-center border-l border-primary-foreground/30">
              Closing Balance
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-7 px-2 sm:px-3 pb-2 text-xs">
            <div></div>
            <div className="text-right border-l border-primary-foreground/30 pl-2">Quantity</div>
            <div className="hidden sm:block text-right">Rate</div>
            <div className="hidden sm:block text-right">Value</div>
            <div className="hidden sm:block text-right border-l border-primary-foreground/30 pl-2">Quantity</div>
            <div className="hidden sm:block text-right">Rate</div>
            <div className="hidden sm:block text-right">Value</div>
          </div>
        </div>

        {/* Body */}
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
                  className="grid grid-cols-2 sm:grid-cols-7 p-2 sm:p-3 cursor-pointer hover-elevate"
                  onClick={() => handleGroupClick(group.id, group.name)}
                  data-testid={`row-stock-group-${group.id}`}
                >
                  <div className="font-medium flex items-center gap-1 truncate text-xs sm:text-sm">
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{group.name}</span>
                  </div>
                  {/* Opening Balance */}
                  <div className="text-right font-mono text-sm">
                    {formatQty(group.opening.quantity)}
                  </div>
                  <div className="hidden sm:block text-right font-mono text-sm">
                    {group.opening.rate === 0 ? "" : formatAmount(group.opening.rate)}
                  </div>
                  <div className="hidden sm:block text-right font-mono text-sm">
                    {group.opening.value === 0 ? "" : formatAmount(group.opening.value)}
                  </div>
                  {/* Closing Balance */}
                  <div className="hidden sm:block text-right font-mono text-sm border-l pl-2">
                    {formatQty(group.closing.quantity)}
                  </div>
                  <div className="hidden sm:block text-right font-mono text-sm">
                    {group.closing.rate === 0 ? "" : formatAmount(group.closing.rate)}
                  </div>
                  <div className="hidden sm:block text-right font-mono text-sm">
                    {group.closing.value === 0 ? "" : formatAmount(group.closing.value)}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No opening stock data available.
            </div>
          )}
        </div>

        {/* Grand Total */}
        {data?.grandTotal && (
          <div className="bg-muted/50 border-t-2 border-primary">
            <div className="grid grid-cols-2 sm:grid-cols-7 p-2 sm:p-3 font-bold">
              <div className="text-xs sm:text-sm">Grand Total</div>
              {/* Opening Total */}
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.opening.quantity)} BL
              </div>
              <div className="hidden sm:block text-right font-mono">
                {openingRate === 0 ? "" : formatAmount(openingRate)}
              </div>
              <div className="hidden sm:block text-right font-mono">
                {data.grandTotal.opening.value === 0 ? "" : formatAmount(data.grandTotal.opening.value)}
              </div>
              {/* Closing Total */}
              <div className="hidden sm:block text-right font-mono border-l pl-2">
                {formatNumber(data.grandTotal.closing.quantity)} BL
              </div>
              <div className="hidden sm:block text-right font-mono">
                {closingRate === 0 ? "" : formatAmount(closingRate)}
              </div>
              <div className="hidden sm:block text-right font-mono">
                {data.grandTotal.closing.value === 0 ? "" : formatAmount(data.grandTotal.closing.value)}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
