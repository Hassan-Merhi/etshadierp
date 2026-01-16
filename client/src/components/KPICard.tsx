import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
}

export function KPICard({ title, value, change, changeType, icon: Icon }: KPICardProps) {
  return (
    <Card className="p-4 sm:p-6" data-testid={`card-kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 sm:gap-2 min-w-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground truncate">
            {title}
          </span>
          <span className="text-xl sm:text-3xl font-bold font-mono truncate" data-testid={`text-kpi-value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </span>
          {change && (
            <span
              className={`text-xs font-medium truncate ${
                changeType === "positive"
                  ? "text-chart-2"
                  : changeType === "negative"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {change}
            </span>
          )}
        </div>
        <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
        </div>
      </div>
    </Card>
  );
}
