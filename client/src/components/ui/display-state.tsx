import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingRowsProps {
  rows?: number;
  className?: string;
  rowClassName?: string;
}

export function LoadingRows({ rows = 8, className, rowClassName }: LoadingRowsProps) {
  return (
    <div className={cn("space-y-3 p-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={cn("h-10 w-full", rowClassName)} />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <div className="rounded-full bg-muted p-3 text-muted-foreground" aria-hidden="true">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
