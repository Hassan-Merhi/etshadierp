/**
 * Pure helpers and lookup tables for the PostOffloadDialog page.
 *
 * Extracted from PostOffloadDialog.tsx during the Phase 4 god-file split.
 */
import {queryClient} from "@/lib/queryClient";

export function invalidateChargeQueries(containerId: number) {
  queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"], refetchType: "active" });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/production-value-report"] });
  queryClient.invalidateQueries({ queryKey: [`/api/factory/containers/${containerId}/post-offload-charges`] });
  queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
}
