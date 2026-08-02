/**
 * StatCard — extracted sub-component.
 *
 * Extracted from ProductionComparison.tsx during the Phase 4 god-file split.
 */
import { Card, CardContent } from "@/components/ui/card";
import React from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  sub,
  valueClass,
  accent,
  icon,
  extraLine,
}: {
  title: string;
  value: string;
  sub?: string;
  valueClass?: string;
  accent?: "green" | "red" | "neutral";
  icon?: React.ReactNode;
  extraLine?: { label: string; value: string };
}) {
  const borderClass = accent === "green" ? "border-emerald-500/40" : accent === "red" ? "border-red-500/40" : "";
  return (
    <Card className={cn("relative overflow-hidden", borderClass)}>
      {accent === "green" && <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500/60 rounded-t" />}
      {accent === "red" && <div className="absolute inset-x-0 top-0 h-0.5 bg-red-500/60 rounded-t" />}
      <CardContent className="px-4 pt-4 pb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase leading-tight">{title}</p>
          {icon && <span className="text-muted-foreground/50 shrink-0">{icon}</span>}
        </div>
        <p className={cn("text-3xl font-extrabold leading-none tabular-nums", valueClass)}>{value}</p>
        {extraLine && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{extraLine.label}</span>
            <span className="text-sm font-semibold tabular-nums text-foreground/80">{extraLine.value}</span>
          </div>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
