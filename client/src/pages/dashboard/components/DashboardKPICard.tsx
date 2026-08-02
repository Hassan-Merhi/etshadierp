/**
 * DashboardKPICard — extracted sub-component.
 *
 * Extracted from Dashboard.tsx during the Phase 4 god-file split.
 */
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardKPICard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  stripeClass,
  iconBgClass,
  iconFgClass,
  onClick,
  testId,
}: {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  stripeClass: string;
  iconBgClass: string;
  iconFgClass: string;
  onClick?: () => void;
  testId?: string;
}) {
  const ChangeIcon = changeType === "positive" ? ArrowUpRight : changeType === "negative" ? ArrowDownRight : Minus;
  return (
    <Card
      className={cn("overflow-hidden p-0", onClick && "cursor-pointer hover-elevate active-elevate-2")}
      onClick={onClick}
      data-testid={testId}
    >
      <div className={cn("h-1 w-full", stripeClass)} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums mt-1.5 leading-none">
              {value}
            </div>
            {change && (
              <span
                className={cn(
                  "mt-2 flex items-center gap-0.5 text-xs font-medium",
                  changeType === "positive"
                    ? "text-chart-2"
                    : changeType === "negative"
                      ? "text-destructive"
                      : "text-muted-foreground"
                )}
              >
                <ChangeIcon className="h-3 w-3 shrink-0" />
                {change}
              </span>
            )}
          </div>
          <div
            className={cn("flex h-12 w-12 items-center justify-center rounded-xl shrink-0", iconBgClass, iconFgClass)}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </Card>
  );
}
