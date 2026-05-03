import { Card } from "@/components/ui/card";
import { LucideIcon, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  "data-testid"?: string;
}

export function KPICard({ title, value, change, changeType, icon: Icon, onClick, "data-testid": testId }: KPICardProps) {
  const isClickable = !!onClick;
  const ChangeIcon = changeType === "positive" ? ArrowUpRight : changeType === "negative" ? ArrowDownRight : null;
  return (
    <Card
      className={cn("p-4 sm:p-5", isClickable && "hover-elevate cursor-pointer")}
      onClick={onClick}
      data-testid={testId ?? `card-kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </span>
          <span
            className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums leading-none truncate"
            data-testid={`text-kpi-value-${title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {value}
          </span>
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums truncate",
                changeType === "positive" ? "text-success" :
                changeType === "negative" ? "text-destructive" :
                "text-muted-foreground"
              )}
            >
              {ChangeIcon && <ChangeIcon className="h-3 w-3 shrink-0" />}
              {change}
            </span>
          )}
        </div>
        <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
