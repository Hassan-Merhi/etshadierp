import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Package, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

interface LiveCharges {
  duties: number;
  officeCharges: number;
  transportFees: number;
  transferCharges: number;
  additionalCharges: number;
  totalOffloadCharges: number;
  totalAllCharges: number;
  additionalCostPerBale: number;
  hasVouchers: boolean;
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
  liveCharges?: LiveCharges;
}

function LiveBadge({ original, live }: { original: number; live: number }) {
  const changed = Math.abs(live - original) >= 0.01;
  if (!changed) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="text-amber-600 border-amber-500 bg-amber-500/10 gap-1 ml-2 text-[10px] px-1 py-0">
          <Zap className="w-2.5 h-2.5" />
          updated
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>Original at offload: {formatAmount(original)}</p>
        <p>Current from voucher: {formatAmount(live)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ChargeRow({ label, original, live, isSubtotal = false, isNegative = false }: {
  label: string;
  original: number;
  live?: number;
  isSubtotal?: boolean;
  isNegative?: boolean;
}) {
  const displayValue = live !== undefined ? live : original;
  if (displayValue === 0 && (live === undefined || live === 0)) return null;
  return (
    <tr className={isSubtotal ? "border-t bg-muted/20 font-medium" : "border-b"}>
      <td className="p-3 flex items-center gap-1">
        {label}
        {live !== undefined && <LiveBadge original={original} live={live} />}
      </td>
      <td className={`p-3 text-right font-mono ${isNegative ? "text-red-600 dark:text-red-400" : ""}`}>
        {isNegative ? `-${formatAmount(displayValue)}` : formatAmount(displayValue)}
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
  const live = offload?.liveCharges;
  const hasPoCharges = (offload?.poCharges?.total ?? 0) > 0;

  // Prefer live voucher amounts when available
  const displayDuties         = live?.hasVouchers ? live.duties          : Number(offload?.duties || 0);
  const displayOfficeCharges  = live?.hasVouchers ? live.officeCharges   : Number(offload?.officeCharges || 0);
  const displayTransportFees  = live?.hasVouchers ? live.transportFees   : Number(offload?.transportFees || 0);
  const displayTransferCharges= live?.hasVouchers ? live.transferCharges : Number(offload?.transferCharges || 0);
  const displayAddlCharges    = live?.hasVouchers ? live.additionalCharges : 0;
  const displayOffloadTotal   = live?.hasVouchers ? live.totalOffloadCharges
    : (displayDuties + displayOfficeCharges + displayTransportFees + displayTransferCharges + displayAddlCharges);

  const displayGrandCharges       = live?.hasVouchers ? live.totalAllCharges     : Number(offload?.totalCharges || 0);
  const displayCostPerBale        = live?.hasVouchers ? live.additionalCostPerBale : Number(offload?.additionalCostPerBale || 0);

  // Stored original values for comparison badges
  const storedDuties          = Number(offload?.duties || 0);
  const storedOfficeCharges   = Number(offload?.officeCharges || 0);
  const storedTransportFees   = Number(offload?.transportFees || 0);
  const storedTransferCharges = Number(offload?.transferCharges || 0);

  const anyVoucherUpdated = live?.hasVouchers && (
    Math.abs(live.duties - storedDuties) >= 0.01 ||
    Math.abs(live.officeCharges - storedOfficeCharges) >= 0.01 ||
    Math.abs(live.transportFees - storedTransportFees) >= 0.01 ||
    Math.abs(live.transferCharges - storedTransferCharges) >= 0.01
  );

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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-amber-600 border-amber-500 bg-amber-500/10 gap-1">
              <Package className="w-3 h-3" />
              Offload
            </Badge>
            {isLoading ? (
              <Skeleton className="h-7 w-40" />
            ) : (
              <h1 className="text-xl font-semibold">{offload?.containerNumber}</h1>
            )}
            {anyVoucherUpdated && (
              <Badge variant="outline" className="text-amber-600 border-amber-500 bg-amber-500/10 gap-1 text-xs">
                <Zap className="w-3 h-3" />
                Vouchers updated since offload
              </Badge>
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium font-mono text-amber-600 dark:text-amber-400">
                      {formatAmount(displayCostPerBale)}
                    </p>
                    {live?.hasVouchers && Math.abs(live.additionalCostPerBale - Number(offload.additionalCostPerBale)) >= 0.01 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-amber-600 border-amber-500 bg-amber-500/10 gap-1 text-[10px]">
                            <Zap className="w-2.5 h-2.5" />
                            updated
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Original at offload: {formatAmount(Number(offload.additionalCostPerBale))}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
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
                    {offload.poCharges.freight > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Freight</td>
                        <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.freight)}</td>
                      </tr>
                    )}
                    {offload.poCharges.fumigation > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Fumigation</td>
                        <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.fumigation)}</td>
                      </tr>
                    )}
                    {offload.poCharges.surcharge > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Surcharge</td>
                        <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.surcharge)}</td>
                      </tr>
                    )}
                    {offload.poCharges.documentCharges > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Document Charges</td>
                        <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.documentCharges)}</td>
                      </tr>
                    )}
                    {offload.poCharges.otherCharges > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Other Charges</td>
                        <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.otherCharges)}</td>
                      </tr>
                    )}
                    {offload.poCharges.discount > 0 && (
                      <tr className="border-b">
                        <td className="p-3">Discount</td>
                        <td className="p-3 text-right font-mono text-green-600 dark:text-green-400">
                          -{formatAmount(offload.poCharges.discount)}
                        </td>
                      </tr>
                    )}
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Subtotal</td>
                      <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Offload Landing Charges — uses live voucher values */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {hasPoCharges ? "Offload Landing Charges" : "Import Charges"}
              </p>
              {live?.hasVouchers && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Zap className="w-3 h-3" />
                  Live from vouchers
                </Badge>
              )}
            </div>
            <div className="border rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-3 font-medium">Charge</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(displayDuties > 0 || storedDuties > 0) && (
                    <ChargeRow
                      label="Duties"
                      original={storedDuties}
                      live={live?.hasVouchers ? live.duties : undefined}
                    />
                  )}
                  {(displayOfficeCharges > 0 || storedOfficeCharges > 0) && (
                    <ChargeRow
                      label="Office Charges"
                      original={storedOfficeCharges}
                      live={live?.hasVouchers ? live.officeCharges : undefined}
                    />
                  )}
                  {(displayTransferCharges > 0 || storedTransferCharges > 0) && (
                    <ChargeRow
                      label="Transfer Charges"
                      original={storedTransferCharges}
                      live={live?.hasVouchers ? live.transferCharges : undefined}
                    />
                  )}
                  {(displayTransportFees > 0 || storedTransportFees > 0) && (
                    <ChargeRow
                      label="Transport Fees"
                      original={storedTransportFees}
                      live={live?.hasVouchers ? live.transportFees : undefined}
                    />
                  )}
                  {offload.additionalCharges.filter(c => Number(c.amount) !== 0).map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="p-3">{c.chargeType}</td>
                      <td className="p-3 text-right font-mono">{formatAmount(Number(c.amount))}</td>
                    </tr>
                  ))}
                  {hasPoCharges ? (
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Subtotal</td>
                      <td className="p-3 text-right font-mono">{formatAmount(displayOffloadTotal)}</td>
                    </tr>
                  ) : (
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Total Charges</td>
                      <td className="p-3 text-right font-mono">{formatAmount(displayGrandCharges)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Combined totals when there are PO charges */}
          {hasPoCharges && (
            <div className="border rounded-md">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="p-3 text-muted-foreground">Container Freight Charges</td>
                    <td className="p-3 text-right font-mono">{formatAmount(offload.poCharges.total)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-3 text-muted-foreground">
                      Offload Landing Charges{displayAddlCharges > 0 ? " + Additional" : ""}
                    </td>
                    <td className="p-3 text-right font-mono">{formatAmount(displayOffloadTotal)}</td>
                  </tr>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="p-3">Total All Charges</td>
                    <td className="p-3 text-right font-mono">{formatAmount(displayGrandCharges)}</td>
                  </tr>
                  <tr className="border-t text-sm text-muted-foreground">
                    <td className="p-3">
                      Cost / Bale&nbsp;
                      <span className="font-mono text-xs">
                        ({formatAmount(displayGrandCharges)} ÷ {formatNumber(Number(offload.totalBales))} bales)
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {formatAmount(displayCostPerBale)} / bale
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
                  Bale cost = purchase rate + {formatAmount(displayCostPerBale)} / bale
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
