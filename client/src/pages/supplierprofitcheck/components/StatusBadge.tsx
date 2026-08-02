/**
 * StatusBadge — extracted sub-component.
 *
 * Extracted from SupplierProfitCheck.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

export function StatusBadge({ status }: { status: string }) {
  if (status === "gaining")
    return (
      <Badge className="bg-emerald-500 text-white gap-1 font-medium">
        <TrendingUp className="w-3 h-3" />
        Gaining
      </Badge>
    );
  if (status === "losing")
    return (
      <Badge className="bg-red-500 text-white gap-1 font-medium">
        <TrendingDown className="w-3 h-3" />
        Losing
      </Badge>
    );
  if (status === "break_even")
    return (
      <Badge className="bg-blue-500 text-white gap-1 font-medium">
        <Minus className="w-3 h-3" />
        Break Even
      </Badge>
    );
  return (
    <Badge className="bg-amber-500 text-white gap-1 font-medium">
      <AlertTriangle className="w-3 h-3" />
      No Data
    </Badge>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
