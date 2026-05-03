import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface LoadingSkeletonProps {
  variant?: "page" | "card" | "table" | "list" | "kpi-grid" | "form";
  rows?: number;
  className?: string;
  "data-testid"?: string;
}

/**
 * LoadingSkeleton — shared skeleton presets so loading states across the app
 * look identical. Use `variant` to pick a layout that matches the surface
 * being rendered.
 */
export function LoadingSkeleton({
  variant = "card",
  rows = 5,
  className,
  "data-testid": testId,
}: LoadingSkeletonProps) {
  const tid = testId ?? `skeleton-${variant}`;

  if (variant === "page") {
    return (
      <div className={cn("space-y-6", className)} data-testid={tid}>
        <div className="space-y-2">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5"><Skeleton className="h-16 w-full" /></Card>
          ))}
        </div>
        <Card className="p-5"><Skeleton className="h-64 w-full" /></Card>
      </div>
    );
  }

  if (variant === "kpi-grid") {
    return (
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3", className)} data-testid={tid}>
        {Array.from({ length: rows }).map((_, i) => (
          <Card key={i} className="p-5"><Skeleton className="h-16 w-full" /></Card>
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <Card className={cn("p-4", className)} data-testid={tid}>
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (variant === "list") {
    return (
      <div className={cn("space-y-2", className)} data-testid={tid}>
        {Array.from({ length: rows }).map((_, i) => (
          <Card key={i} className="p-3 flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-md shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (variant === "form") {
    return (
      <div className={cn("space-y-4", className)} data-testid={tid}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card className={cn("p-5 space-y-3", className)} data-testid={tid}>
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </Card>
  );
}
