import * as React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Activity } from "lucide-react";

export interface ActivityTimelineItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  timestamp?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
  meta?: React.ReactNode;
}

export interface ActivityTimelineProps {
  items: ActivityTimelineItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  "data-testid"?: string;
}

const TONE: Record<NonNullable<ActivityTimelineItem["tone"]>, string> = {
  default:     "bg-muted text-muted-foreground",
  success:     "bg-success-soft text-success-soft-foreground",
  warning:     "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive",
  info:        "bg-info-soft text-info-soft-foreground",
};

/**
 * ActivityTimeline — vertical list of recent activity events. Standardizes
 * "recent activity" rails on dashboards and detail pages.
 */
export function ActivityTimeline({
  items,
  emptyTitle = "No recent activity",
  emptyDescription,
  className,
  "data-testid": testId,
}: ActivityTimelineProps) {
  if (!items.length) {
    return (
      <EmptyState
        icon={Activity}
        title={emptyTitle}
        description={emptyDescription}
        data-testid={testId ?? "timeline-empty"}
      />
    );
  }

  return (
    <ol className={cn("relative space-y-3", className)} data-testid={testId ?? "timeline"}>
      {items.map((item) => {
        const Icon = item.icon;
        const tone = item.tone ?? "default";
        return (
          <li
            key={item.id}
            className="flex items-start gap-3"
            data-testid={`timeline-item-${item.id}`}
          >
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-md shrink-0 mt-0.5", TONE[tone])}>
              {Icon ? <Icon className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium leading-tight min-w-0">{item.title}</div>
                {item.timestamp && (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {item.timestamp}
                  </span>
                )}
              </div>
              {item.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              )}
              {item.meta && <div className="mt-1">{item.meta}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
