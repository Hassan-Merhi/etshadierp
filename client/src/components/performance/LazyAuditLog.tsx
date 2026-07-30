import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const AuditLogPanel = lazy(() =>
  import("@/pages/settings/AuditLog").then((module) => ({ default: module.AuditLog })),
);

export function AuditLog(props: Record<string, unknown>) {
  return (
    <Suspense
      fallback={
        <div className="space-y-2 p-4" data-testid="audit-log-lazy-loading">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      }
    >
      <AuditLogPanel {...props} />
    </Suspense>
  );
}
