import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RefreshEtaResult {
  status: string;
  message: string;
  oldEta: string | null;
  newEta: string | null;
}

interface BulkRefreshResult {
  total: number;
  updated: number;
  unchanged: number;
  noEta: number;
  notFound: number;
  skippedRecent: number;
  unsupportedCarrier: number;
  errors: number;
  message: string;
}

/** JSONCargo ETA refresh — Maersk / Hapag-Lloyd / MSC / CMA CGM only. */
export function useJsonCargoEta() {
  const { toast } = useToast();
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());

  const refreshOneMutation = useMutation({
    mutationFn: async (containerId: number) => {
      setRefreshingIds((prev) => new Set(prev).add(containerId));
      const res = await apiRequest("POST", `/api/containers/${containerId}/refresh-eta`, {});
      return (await res.json()) as RefreshEtaResult;
    },
    onSuccess: (data, containerId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });
      toast({ title: "ETA Refresh", description: data.message });
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(containerId);
        return next;
      });
    },
    onError: (error: any, containerId) => {
      if (error?._handledGlobally) return;
      toast({ title: "ETA Refresh Failed", description: error.message, variant: "destructive" });
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(containerId);
        return next;
      });
    },
  });

  const refreshBulkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/containers/refresh-etas", {});
      return (await res.json()) as BulkRefreshResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });
      toast({ title: "Bulk ETA Refresh", description: data.message });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Bulk ETA Refresh Failed", description: error.message, variant: "destructive" });
    },
  });

  return {
    refreshOne: (containerId: number) => refreshOneMutation.mutate(containerId),
    refreshingIds,
    refreshBulk: () => refreshBulkMutation.mutate(),
    bulkIsPending: refreshBulkMutation.isPending,
  };
}
