import { useQuery } from "@tanstack/react-query";
import { Factory } from "lucide-react";

export function formatDailyNum(val: number): string {
  if (val === 0) return "0";
  return val % 1 === 0 ? val.toFixed(0) : parseFloat(val.toFixed(3)).toString();
}

export function DailyStockSummary({ date }: { date: string }) {
  const todayStr = new Date().toLocaleDateString("en-CA");

  const { data: summaryRows = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/bales/daily-summary", date],
    queryFn: () =>
      fetch(`/api/factory/bales/daily-summary?date=${date}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 30000,
  });

  let totalQty = 0,
    totalKg = 0;
  let garbageQty = 0,
    garbageKg = 0;
  let wipersQty = 0,
    wipersKg = 0;

  for (const row of summaryRows) {
    const cat = (row.category || "").toLowerCase().trim();
    const qty = Number(row.count || 0);
    const kg = parseFloat(row.totalKg || "0");
    if (cat === "garbage") {
      garbageQty += qty;
      garbageKg += kg;
    } else if (cat === "wipers") {
      wipersQty += qty;
      wipersKg += kg;
    } else {
      totalQty += qty;
      totalKg += kg;
    }
  }

  const isToday = date === todayStr;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Label */}
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
        {isToday ? "Today" : "Production"}
      </span>

      {/* Production */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20">
        <Factory className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span
          className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
          data-testid="text-entry-today-qty"
        >
          {totalQty}
        </span>
        <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70">bales</span>
        <span className="w-px h-3 bg-emerald-500/30" />
        <span
          className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
          data-testid="text-entry-today-kg"
        >
          {formatDailyNum(totalKg)}
        </span>
        <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70">kg</span>
      </div>

      {/* Garbage */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-orange-500/10 border-orange-500/20">
        <span className="text-xs font-semibold text-orange-500">Garbage</span>
        <span
          className="text-sm font-bold tabular-nums text-orange-600 dark:text-orange-400"
          data-testid="text-entry-today-garbage-qty"
        >
          {garbageQty}
        </span>
        <span className="text-xs text-orange-600/70 dark:text-orange-400/70">bales</span>
        <span className="w-px h-3 bg-orange-500/30" />
        <span
          className="text-sm font-bold tabular-nums text-orange-600 dark:text-orange-400"
          data-testid="text-entry-today-garbage-kg"
        >
          {formatDailyNum(garbageKg)}
        </span>
        <span className="text-xs text-orange-600/70 dark:text-orange-400/70">kg</span>
      </div>

      {/* Wipers */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-blue-500/10 border-blue-500/20">
        <span className="text-xs font-semibold text-blue-500">Wipers</span>
        <span
          className="text-sm font-bold tabular-nums text-blue-600 dark:text-blue-400"
          data-testid="text-entry-today-wipers-qty"
        >
          {wipersQty}
        </span>
        <span className="text-xs text-blue-600/70 dark:text-blue-400/70">bales</span>
        <span className="w-px h-3 bg-blue-500/30" />
        <span
          className="text-sm font-bold tabular-nums text-blue-600 dark:text-blue-400"
          data-testid="text-entry-today-wipers-kg"
        >
          {formatDailyNum(wipersKg)}
        </span>
        <span className="text-xs text-blue-600/70 dark:text-blue-400/70">kg</span>
      </div>
    </div>
  );
}
