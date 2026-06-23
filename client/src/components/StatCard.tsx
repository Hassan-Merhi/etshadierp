import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LucideIcon, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5";

const toneStyles: Record<StatTone, { bg: string; fg: string }> = {
  default: { bg: "bg-muted", fg: "text-foreground" },
  primary: { bg: "bg-primary/10", fg: "text-primary" },
  success: { bg: "bg-success-soft", fg: "text-success-soft-foreground" },
  warning: { bg: "bg-warning-soft", fg: "text-warning-soft-foreground" },
  destructive: { bg: "bg-destructive-soft", fg: "text-destructive" },
  info: { bg: "bg-info-soft", fg: "text-info-soft-foreground" },
  "chart-2": { bg: "bg-[hsl(var(--chart-2)/0.12)]", fg: "text-[hsl(var(--chart-2))]" },
  "chart-3": { bg: "bg-[hsl(var(--chart-3)/0.12)]", fg: "text-[hsl(var(--chart-3))]" },
  "chart-4": { bg: "bg-[hsl(var(--chart-4)/0.12)]", fg: "text-[hsl(var(--chart-4))]" },
  "chart-5": { bg: "bg-[hsl(var(--chart-5)/0.12)]", fg: "text-[hsl(var(--chart-5))]" },
};

export interface StatCardProps {
  title: string;
  value: React.ReactNode;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon?: LucideIcon;
  tone?: StatTone;
  hint?: string;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

/**
 * StatCard — canonical KPI tile used across all dashboards (ERP, POS, Factory,
 * Properties, etc). Provides a consistent grammar: title, big value, optional
 * delta, icon, and tone. Supports a loading skeleton state.
 */
export function StatCard({
  title,
  value,
  change,
  changeType = "neutral",
  icon: Icon,
  tone = "primary",
  hint,
  loading,
  onClick,
  className,
  "data-testid": testId,
}: StatCardProps) {
  const isClickable = !!onClick;
  const ChangeIcon = changeType === "positive" ? ArrowUpRight : changeType === "negative" ? ArrowDownRight : Minus;
  const t = toneStyles[tone];
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  return (
    <Card
      className={cn("p-4 sm:p-5", isClickable && "hover-elevate active-elevate-2 cursor-pointer", className)}
      onClick={onClick}
      data-testid={testId ?? `card-stat-${slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </span>
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <span
              className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums leading-none truncate"
              data-testid={`text-stat-value-${slug}`}
            >
              {value}
            </span>
          )}
          {!loading && change && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums truncate",
                changeType === "positive"
                  ? "text-success"
                  : changeType === "negative"
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
              data-testid={`text-stat-delta-${slug}`}
            >
              <ChangeIcon className="h-3 w-3 shrink-0" />
              {change}
            </span>
          )}
          {!loading && hint && !change && <span className="text-xs text-muted-foreground truncate">{hint}</span>}
        </div>
        {Icon && (
          <div
            className={cn("flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg shrink-0", t.bg, t.fg)}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
}
