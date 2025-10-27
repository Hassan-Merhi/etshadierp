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
    <Card className="p-6" data-testid={`card-kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <span className="text-3xl font-bold font-mono" data-testid={`text-kpi-value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </span>
          {change && (
            <span
              className={`text-xs font-medium ${
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
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </Card>
  );
}
