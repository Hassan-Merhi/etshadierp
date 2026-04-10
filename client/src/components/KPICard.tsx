import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
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
  return (
    <Card
      className={cn("p-4 sm:p-6", isClickable && "hover-elevate cursor-pointer")}
      onClick={onClick}
      data-testid={testId ?? `card-kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 sm:gap-2 min-w-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground truncate">
            {title}
          </span>
          <span
            className="text-xl sm:text-3xl font-bold font-mono truncate"
            data-testid={`text-kpi-value-${title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {value}
          </span>
          {change && (
            <span
              className={cn(
                "text-xs font-medium truncate",
                changeType === "positive" ? "text-chart-2" :
                changeType === "negative" ? "text-destructive" :
                "text-muted-foreground"
              )}
            >
              {change}
            </span>
          )}
        </div>
        <div className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-md bg-primary/10 shrink-0">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
        </div>
      </div>
    </Card>
  );
}
