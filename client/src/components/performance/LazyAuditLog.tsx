import { lazy, Suspense, type ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const AuditLogPanel = lazy(() =>
  import("@/pages/settings/AuditLog").then((module) => ({ default: module.AuditLog })),
);

type AuditLogProps = ComponentProps<typeof AuditLogPanel>;

export function AuditLog(props: AuditLogProps) {
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
