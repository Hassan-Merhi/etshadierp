import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { factoryQueryClient, factoryApiRequest } from "@/lib/factoryApi";
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

/** JSONCargo ETA refresh for factory containers — Maersk / Hapag-Lloyd / MSC / CMA CGM only. */
export function useFactoryJsonCargoEta() {
  const { toast } = useToast();
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());

  const refreshOneMutation = useMutation({
    mutationFn: async (containerId: number) => {
      setRefreshingIds((prev) => new Set(prev).add(containerId));
      const res = await factoryApiRequest("POST", `/api/factory/containers/${containerId}/refresh-eta`, {});
      return (await res.json()) as RefreshEtaResult;
    },
    onSuccess: (data, containerId) => {
      factoryQueryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
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
      const res = await factoryApiRequest("POST", "/api/factory/containers/refresh-etas", {});
      return (await res.json()) as BulkRefreshResult;
    },
    onSuccess: (data) => {
      factoryQueryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
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
