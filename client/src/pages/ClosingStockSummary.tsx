import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Package, ChevronRight, RefreshCw } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

  const { toast } = useToast();
  const [showCarryForwardDialog, setShowCarryForwardDialog] = useState(false);

  const carryForwardMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/reports/carryforward-closing-stock", {});
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message,
      });
      setShowCarryForwardDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/reports/closing-stock-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/opening-stock-summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed",
        description: error.message || "Failed to carry forward closing stock",
        variant: "destructive",
      });
    },
  });

  const handleCarryForward = () => {
    carryForwardMutation.mutate();
  };

  const handleGroupClick = (groupId: number, groupName: string) => {
    navigate(`/closing-stock/${groupId}?name=${encodeURIComponent(groupName)}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
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
        {data?.grandTotal && data.grandTotal.value > 0 && (
          <Button
            onClick={() => setShowCarryForwardDialog(true)}
            data-testid="button-carryforward-stock"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Set as Opening Stock
          </Button>
        )}
      </div>

      {/* Carry Forward Confirmation Dialog */}
      <Dialog open={showCarryForwardDialog} onOpenChange={setShowCarryForwardDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Closing Stock as Opening Stock</DialogTitle>
            <DialogDescription>
              This will replace the current opening stock with the closing stock values shown below.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Company:</span>
              <span className="font-medium">{selectedCompany?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Quantity:</span>
              <span className="font-mono">{data?.grandTotal ? formatNumber(data.grandTotal.quantity) : "0"} BL</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Value:</span>
              <span className="font-mono font-medium">${data?.grandTotal ? formatNumber(data.grandTotal.value) : "0.00"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCarryForwardDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCarryForward}
              disabled={carryForwardMutation.isPending}
              data-testid="button-confirm-carryforward"
            >
              {carryForwardMutation.isPending ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
