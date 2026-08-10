/**
 * SkeletonBox — extracted sub-component.
 *
 * Extracted from DailyProductionReport.tsx during the Phase 4 god-file split.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonBox() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
