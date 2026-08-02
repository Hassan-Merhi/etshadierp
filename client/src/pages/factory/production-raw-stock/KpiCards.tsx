import { ArrowDownCircle, ArrowUpCircle, Package } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";
import { useFactoryText } from "@/i18n/modules/factory";

interface KpiCardsProps {
  totalReceived: number;
  totalReceivedValue: number;
  totalUsed: number;
  totalUsedValue: number;
  totalFree: number;
  totalValue: number;
}

export function KpiCards({
  totalReceived,
  totalReceivedValue,
  totalUsed,
  totalUsedValue,
  totalFree,
  totalValue,
}: KpiCardsProps) {
  const tUi = useFactoryText();
  const fmtKg = (n: number) => formatNumber(n, 3);

  return (
    <div className="rounded-xl border bg-card">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
        {/* Total Received */}
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-slate-500/10 border border-slate-500/20 shrink-0 mt-0.5">
            <ArrowDownCircle className="h-4.5 w-4.5 text-slate-500" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
              {tUi("total.received")}
            </p>
            <p className="text-2xl font-bold font-mono tabular-nums leading-tight" data-testid="text-total-received">
              {fmtKg(totalReceived)} <span className="text-sm font-medium text-muted-foreground">kg</span>
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5" data-testid="text-total-received-value">
              ${formatNumber(totalReceivedValue)}
            </p>
          </div>
        </div>
        {/* Total Used */}
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-amber-500/10 border border-amber-500/20 shrink-0 mt-0.5">
            <ArrowUpCircle className="h-4.5 w-4.5 text-amber-500" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
              {tUi("total.used")}
            </p>
            <p className="text-2xl font-bold font-mono tabular-nums leading-tight" data-testid="text-total-used">
              {fmtKg(totalUsed)} <span className="text-sm font-medium text-muted-foreground">kg</span>
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5" data-testid="text-total-used-value">
              ${formatNumber(totalUsedValue)}
            </p>
          </div>
        </div>
        {/* Free Available */}
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0 mt-0.5">
            <Package className="h-4.5 w-4.5 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
              {tUi("free.available")}
            </p>
            <p
              className="text-2xl font-bold font-mono tabular-nums leading-tight text-emerald-600 dark:text-emerald-400"
              data-testid="text-total-free"
            >
              {fmtKg(totalFree)}{" "}
              <span className="text-sm font-medium text-emerald-600/70 dark:text-emerald-400/70">kg</span>
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5" data-testid="text-total-value">
              Stock Value: <span className="text-foreground font-semibold">${formatNumber(totalValue)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
