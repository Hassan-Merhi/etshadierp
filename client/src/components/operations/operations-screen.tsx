import * as React from "react";
import { PackageSearch, Warehouse, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type OperationsScreenHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  icon?: LucideIcon;
};

export function OperationsScreenHeader({
  eyebrow,
  title,
  description,
  actions,
  filters,
  icon: Icon = Warehouse,
  className,
  ...props
}: OperationsScreenHeaderProps) {
  return (
    <section className={cn("space-y-4", className)} {...props}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 rounded-lg bg-[hsl(var(--module-factory)/0.12)] p-2 text-[hsl(var(--module-factory))]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            {eyebrow ? <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p> : null}
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
            {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </div>
      {filters ? <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">{filters}</div> : null}
    </section>
  );
}

type OperationsMetricCardProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: LucideIcon;
  emphasize?: boolean;
};

export function OperationsMetricCard({
  label,
  value,
  detail,
  icon: Icon = PackageSearch,
  emphasize = false,
  className,
  ...props
}: OperationsMetricCardProps) {
  return (
    <Card className={cn(emphasize && "border-[hsl(var(--module-factory)/0.45)]", className)} {...props}>
      <CardContent className="flex items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className="mt-1 break-words text-2xl font-semibold tabular-nums text-foreground">{value}</div>
          {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
        </div>
        <div className="rounded-md bg-muted p-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

export function OperationsMetricGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)} {...props} />;
}

export function OperationsTableShell({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-hidden rounded-lg border bg-card", className)} {...props} />;
}

export function OperationsTableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-full overflow-x-auto", className)} {...props} />;
}

export type { OperationsMetricCardProps, OperationsScreenHeaderProps };
