import * as React from "react";
import { PackageSearch, Warehouse, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { ResponsiveActions, ResponsiveToolbar } from "@/components/ui/responsive-accessibility";
import { cn } from "@/lib/utils";

type OperationsScreenHeaderProps = React.HTMLAttributes<HTMLElement> & {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  icon?: LucideIcon;
  actionsLabel?: string;
  filtersLabel?: string;
};

export function OperationsScreenHeader({ eyebrow, title, description, actions, filters, icon: Icon = Warehouse, actionsLabel = "Operations page actions", filtersLabel = "Operations page filters", className, ...props }: OperationsScreenHeaderProps) {
  const titleId = React.useId();
  return (
    <header aria-labelledby={titleId} className={cn("space-y-4", className)} {...props}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="mt-0.5 shrink-0 rounded-lg bg-[hsl(var(--module-factory)/0.12)] p-2 text-[hsl(var(--module-factory))]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p> : null}
            <h1 id={titleId} className="break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
            {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <ResponsiveActions label={actionsLabel}>{actions}</ResponsiveActions> : null}
      </div>
      {filters ? <ResponsiveToolbar label={filtersLabel}>{filters}</ResponsiveToolbar> : null}
    </header>
  );
}

type OperationsMetricCardProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: LucideIcon;
  emphasize?: boolean;
};

export function OperationsMetricCard({ label, value, detail, icon: Icon = PackageSearch, emphasize = false, className, ...props }: OperationsMetricCardProps) {
  return (
    <Card className={cn("min-w-0", emphasize && "border-[hsl(var(--module-factory)/0.45)]", className)} {...props}>
      <CardContent className="flex items-start justify-between gap-3 p-4 sm:gap-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-muted-foreground">{label}</p>
          <div className="mt-1 break-words text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{value}</div>
          {detail ? <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</div> : null}
        </div>
        <div className="shrink-0 rounded-md bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" /></div>
      </CardContent>
    </Card>
  );
}

export function OperationsMetricGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", className)} {...props} />;
}

export function OperationsTableShell({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-w-full overflow-x-auto overscroll-x-contain rounded-lg border bg-card", className)} {...props} />;
}

export function OperationsTableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-full max-w-full overflow-x-auto overscroll-x-contain", className)} {...props} />;
}

export type { OperationsMetricCardProps, OperationsScreenHeaderProps };
