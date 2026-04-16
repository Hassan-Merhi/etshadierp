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

interface PoCharges {
  freight: number;
  surcharge: number;
  fumigation: number;
  documentCharges: number;
  discount: number;
  otherCharges: number;
  total: number;
}

interface AdditionalCharge {
  id: number;
  chargeType: string;
  amount: string;
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
  containerChargesTotal: string;
  items: OffloadItem[];
  poCharges: PoCharges;
  additionalCharges: AdditionalCharge[];
}

function ChargeRow({ label, value, isSubtotal = false, isNegative = false }: {
  label: string;
  value: number;
  isSubtotal?: boolean;
  isNegative?: boolean;
}) {
  if (value === 0) return null;
  return (
    <tr className={isSubtotal ? "border-t bg-muted/20 font-medium" : "border-b"}>
      <td className="p-3">{label}</td>
      <td className={`p-3 text-right font-mono ${isNegative ? "text-red-600 dark:text-red-400" : ""}`}>
        {isNegative ? `-${formatAmount(value)}` : formatAmount(value)}
      </td>
    </tr>
  );
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

  const poCharges = offload?.poCharges;
  const hasPoCharges = poCharges && poCharges.total > 0;

  const offloadLandingTotal =
    Number(offload?.duties || 0) +
    Number(offload?.officeCharges || 0) +
    Number(offload?.transferCharges || 0) +
    Number(offload?.transportFees || 0);

  const additionalChargesTotal = (offload?.additionalCharges || []).reduce((s, c) => s + Number(c.amount), 0);

  const grandTotalCharges = Number(offload?.totalCharges || 0);

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
                  <p className="font-medium font-mono text-amber-600 dark:text-amber-400">
                    {formatAmount(Number(offload.additionalCostPerBale))}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Container Freight Charges from Purchase Orders */}
          {hasPoCharges && (
            <div>
              <p className="text-sm font-medium mb-2 text-muted-foreground uppercase tracking-wide">Container Freight Charges</p>
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left p-3 font-medium">Charge</th>
                      <th className="text-right p-3 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ChargeRow label="Freight" value={poCharges.freight} />
                    <ChargeRow label="Fumigation" value={poCharges.fumigation} />
                    <ChargeRow label="Surcharge" value={poCharges.surcharge} />
                    <ChargeRow label="Document Charges" value={poCharges.documentCharges} />
                    <ChargeRow label="Other Charges" value={poCharges.otherCharges} />
                    {poCharges.discount > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Discount</td>
                        <td className="p-3 text-right font-mono text-green-600 dark:text-green-400">
                          -{formatAmount(poCharges.discount)}
                        </td>
                      </tr>
                    )}
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Subtotal</td>
                      <td className="p-3 text-right font-mono">{formatAmount(poCharges.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Offload Landing Charges */}
          <div>
            <p className="text-sm font-medium mb-2 text-muted-foreground uppercase tracking-wide">
              {hasPoCharges ? "Offload Landing Charges" : "Import Charges"}
            </p>
            <div className="border rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-3 font-medium">Charge</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <ChargeRow label="Duties" value={Number(offload.duties)} />
                  <ChargeRow label="Office Charges" value={Number(offload.officeCharges)} />
                  <ChargeRow label="Transfer Charges" value={Number(offload.transferCharges)} />
                  <ChargeRow label="Transport Fees" value={Number(offload.transportFees)} />
                  {offload.additionalCharges.map((c) => (
                    Number(c.amount) !== 0 && (
                      <tr key={c.id} className="border-b">
                        <td className="p-3">{c.chargeType}</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(c.amount))}</td>
                      </tr>
                    )
                  ))}
                  {hasPoCharges ? (
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Subtotal</td>
                      <td className="p-3 text-right font-mono">
                        {formatAmount(offloadLandingTotal + additionalChargesTotal)}
                      </td>
                    </tr>
                  ) : (
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Total Charges</td>
                      <td className="p-3 text-right font-mono">{formatAmount(grandTotalCharges)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Combined charge total when there are PO charges */}
          {hasPoCharges && (
            <div className="border rounded-md">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="p-3 text-muted-foreground">Container Freight Charges</td>
                    <td className="p-3 text-right font-mono">{formatAmount(poCharges.total)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-3 text-muted-foreground">
                      Offload Landing Charges{additionalChargesTotal > 0 ? " + Additional" : ""}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {formatAmount(offloadLandingTotal + additionalChargesTotal)}
                    </td>
                  </tr>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="p-3">Total All Charges</td>
                    <td className="p-3 text-right font-mono">{formatAmount(grandTotalCharges)}</td>
                  </tr>
                  <tr className="border-t text-sm text-muted-foreground">
                    <td className="p-3">
                      Cost / Bale calculation&nbsp;
                      <span className="font-mono text-xs">
                        ({formatAmount(grandTotalCharges)} ÷ {formatNumber(Number(offload.totalBales))} bales)
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {formatAmount(Number(offload.additionalCostPerBale))} / bale
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="border rounded-md p-4 flex items-center justify-between bg-muted/20">
            <div>
              <p className="text-sm text-muted-foreground">Grand Total (charges included in rates)</p>
              <p className="text-2xl font-semibold font-mono mt-0.5">{formatAmount(itemsTotal)}</p>
              {hasPoCharges && (
                <p className="text-xs text-muted-foreground mt-1">
                  Bale cost = purchase rate + {formatAmount(Number(offload.additionalCostPerBale))} / bale
                </p>
              )}
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
