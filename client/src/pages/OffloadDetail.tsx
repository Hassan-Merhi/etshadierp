import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { parseISO, format } from "date-fns";

function formatAmount(value: number) {
  if (isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  if (isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDisplayDate(date: Date) {
  return format(date, "dd MMM yyyy");
}

interface OffloadItem {
  id: number;
  stockItemId: number;
  stockItemName: string | null;
  stockItemCode: string | null;
  quantity: string;
  rate: string;
  totalValue: string;
}

interface OffloadDetailData {
  id: number;
  containerId: number;
  containerNumber: string;
  locationId: number;
  locationName: string | null;
  duties: string;
  officeCharges: string;
  transferCharges: string;
  transportFees: string;
  totalCharges: string;
  totalBales: string;
  additionalCostPerBale: string;
  offloadedAt: string;
  items: OffloadItem[];
}

export default function OffloadDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = params.id;

  const { data: offload, isLoading } = useQuery<OffloadDetailData>({
    queryKey: [`/api/offloads/${id}`],
    enabled: !!id,
  });

  const itemsTotal = offload?.items.reduce((s, i) => s + Number(i.totalValue), 0) ?? 0;
  const grandTotal = itemsTotal;

  return (
    <div className="w-full p-4 sm:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.history.back()}
          data-testid="button-back-offload"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-amber-600 border-amber-500 bg-amber-500/10 gap-1">
              <Package className="w-3 h-3" />
              Offload
            </Badge>
            {isLoading ? (
              <Skeleton className="h-7 w-40" />
            ) : (
              <h1 className="text-xl font-semibold">{offload?.containerNumber}</h1>
            )}
          </div>
          {offload && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatDisplayDate(parseISO(offload.offloadedAt.slice(0, 10)))}
              {offload.locationName ? ` — ${offload.locationName}` : ""}
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : offload ? (
        <>
          {offload.items.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2 text-muted-foreground uppercase tracking-wide">Stock Items</p>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/50">
                    <tr className="border-b bg-muted/40">
                      <th className="text-left p-3 font-medium">Item</th>
                      <th className="text-right p-3 font-medium">Qty</th>
                      <th className="text-right p-3 font-medium">Rate</th>
                      <th className="text-right p-3 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offload.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="p-3">{item.stockItemName || item.stockItemCode || `Item #${item.stockItemId}`}</td>
                        <td className="p-3 text-right font-mono">{formatNumber(Number(item.quantity))}</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(item.rate))}</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(item.totalValue))}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-muted/20 font-medium">
                      <td className="p-3">Total</td>
                      <td className="p-3 text-right font-mono">
                        {formatNumber(offload.items.reduce((s, i) => s + Number(i.quantity), 0))}
                      </td>
                      <td></td>
                      <td className="p-3 text-right font-mono">{formatAmount(itemsTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                <div>
                  <p className="text-muted-foreground">Total Bales</p>
                  <p className="font-medium font-mono">{formatNumber(Number(offload.totalBales))}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Additional Cost / Bale</p>
                  <p className="font-medium font-mono">{formatAmount(Number(offload.additionalCostPerBale))}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium mb-2 text-muted-foreground uppercase tracking-wide">Import Charges</p>
            <div className="border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50">
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-3 font-medium">Charge</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {Number(offload.duties) !== 0 && (
                    <tr className="border-b">
                      <td className="p-3">Duties</td>
                      <td className="p-3 text-right font-mono">{formatAmount(Number(offload.duties))}</td>
                    </tr>
                  )}
                  {Number(offload.officeCharges) !== 0 && (
                    <tr className="border-b">
                      <td className="p-3">Office Charges</td>
                      <td className="p-3 text-right font-mono">{formatAmount(Number(offload.officeCharges))}</td>
                    </tr>
                  )}
                  {Number(offload.transferCharges) !== 0 && (
                    <tr className="border-b">
                      <td className="p-3">Transfer Charges</td>
                      <td className="p-3 text-right font-mono">{formatAmount(Number(offload.transferCharges))}</td>
                    </tr>
                  )}
                  {Number(offload.transportFees) !== 0 && (
                    <tr className="border-b">
                      <td className="p-3">Transport Fees</td>
                      <td className="p-3 text-right font-mono">{formatAmount(Number(offload.transportFees))}</td>
                    </tr>
                  )}
                  <tr className="bg-muted/20 font-medium">
                    <td className="p-3">Total Charges</td>
                    <td className="p-3 text-right font-mono">{formatAmount(Number(offload.totalCharges))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="border rounded-md p-4 flex items-center justify-between bg-muted/20">
            <div>
              <p className="text-sm text-muted-foreground">Grand Total (charges included in rates)</p>
              <p className="text-2xl font-semibold font-mono mt-0.5">{formatAmount(grandTotal)}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate(`/containers/${offload.containerId}`)}
              data-testid="button-goto-container"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Container
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">Offload not found.</p>
      )}
    </div>
  );
}
