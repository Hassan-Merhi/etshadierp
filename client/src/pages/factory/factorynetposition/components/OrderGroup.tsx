/**
 * OrderGroup — extracted sub-component.
 *
 * Extracted from FactoryNetPosition.tsx during the Phase 4 god-file split.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { OrderItem } from "../types";
import { fmt, fmtDate } from "../utils";

export function OrderGroup({
  label,
  orders,
  total,
  icon,
  accentClass,
  badgeClass,
}: {
  label: string;
  orders: OrderItem[];
  total: number;
  icon: React.ReactNode;
  accentClass: string;
  badgeClass: string;
}) {
  const [open, setOpen] = useState(true);
  if (orders.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover-elevate bg-muted/30"
        onClick={() => setOpen((o) => !o)}
        data-testid={`toggle-order-group-${label.toLowerCase()}`}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          {icon}
          <span className="text-sm font-semibold">{label}</span>
          <Badge className={`text-xs ${badgeClass}`}>{orders.length}</Badge>
        </div>
        <span className={`font-mono text-sm font-bold ${accentClass}`}>{fmt(total)}</span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {orders.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
              data-testid={`row-order-${o.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">#{o.id}</span>
                  <span className="font-medium truncate">{o.customerName}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground">{fmtDate(o.orderDate)}</span>
                  <span className="text-xs text-muted-foreground">
                    {o.totalQtyBales} bale{o.totalQtyBales !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <span className={`font-mono text-sm font-semibold ml-4 shrink-0 ${accentClass}`}>
                {fmt(o.grandTotal)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Custom Net Position View ─────────────────────────────────────────────── */
