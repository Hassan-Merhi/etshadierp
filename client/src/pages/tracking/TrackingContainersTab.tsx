import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/contexts/CompanyContext";
import GITContainers from "@/pages/GITContainers";

function isTrackingContainersQuery(queryKey: readonly unknown[]): boolean {
  const requestUrl = queryKey[0];
  return typeof requestUrl === "string" && requestUrl.startsWith("/api/git/containers");
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";

  return name === "AbortError" || /\b(abort(?:ed)?|cancelled|canceled)\b/i.test(message);
}

function TrackingContainersFallback() {
  return (
    <div className="p-4 space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function TrackingContainersTab() {
  const queryClient = useQueryClient();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id ?? null;
  const [readyCompanyId, setReadyCompanyId] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    setReadyCompanyId(null);

    void (async () => {
      await queryClient.cancelQueries({
        predicate: (query) => isTrackingContainersQuery(query.queryKey),
      });
      queryClient.removeQueries({
        predicate: (query) => isTrackingContainersQuery(query.queryKey),
      });

      if (!disposed) setReadyCompanyId(companyId);
    })();

    return () => {
      disposed = true;
    };
  }, [companyId, queryClient]);

  useEffect(() => {
    let disposed = false;
    const recovering = new Set<string>();

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const query = event.query;
      if (!isTrackingContainersQuery(query.queryKey)) return;
      if (!isAbortLikeError(query.state.error)) return;
      if (recovering.has(query.queryHash)) return;

      recovering.add(query.queryHash);
      queueMicrotask(() => {
        if (disposed) return;
        void queryClient.resetQueries({ queryKey: query.queryKey, exact: true }).finally(() =>
          recovering.delete(query.queryHash),
        );
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [queryClient]);

  if (!companyId || readyCompanyId !== companyId) {
    return <TrackingContainersFallback />;
  }

  return <GITContainers key={`tracking-containers-${companyId}`} embedded />;
}
