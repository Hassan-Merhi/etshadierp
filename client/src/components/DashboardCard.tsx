import * as React from "react";
import { Link } from "wouter";
import { ArrowRight, LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface DashboardCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  primaryValue?: React.ReactNode;
  primaryLabel?: string;
  loading?: boolean;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * DashboardCard — clickable drill-down card combining a KPI summary with a
 * title/description. Used on top-level module dashboards (ContainerDashboard,
 * Properties, Factory, POS) to drive consistent navigation visuals.
 */
export function DashboardCard({
  title,
  description,
  icon: Icon,
  href,
  onClick,
  primaryValue,
  primaryLabel,
  loading,
  badge,
  children,
  className,
  "data-testid": testId,
}: DashboardCardProps) {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const interactive = !!href || !!onClick;

  const inner = (
    <Card
      className={cn(
        "p-5 flex flex-col gap-4 h-full",
        interactive && "hover-elevate active-elevate-2 cursor-pointer",
        className
      )}
      onClick={onClick}
      data-testid={testId ?? `card-dashboard-${slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold leading-tight truncate">{title}</h3>
              {badge}
            </div>
            {description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{description}</p>}
          </div>
        </div>
        {interactive && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" aria-hidden />}
      </div>

      {(primaryValue !== undefined || loading) && (
        <div className="flex items-baseline gap-2 flex-wrap">
          {loading ? (
            <Skeleton className="h-7 w-20" />
          ) : (
            <span
              className="text-2xl font-semibold tabular-nums tracking-tight"
              data-testid={`text-dashboard-value-${slug}`}
            >
              {primaryValue}
            </span>
          )}
          {primaryLabel && <span className="text-xs text-muted-foreground">{primaryLabel}</span>}
        </div>
      )}

      {children}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
