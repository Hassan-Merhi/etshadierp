/**
 * TransferOrderDetail — extracted sub-component.
 *
 * Extracted from PosTransferOrders.tsx during the Phase 4 god-file split.
 */
import {useQuery} from "@tanstack/react-query";
import {ArrowLeft} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import type {PosUser, TransferDetail} from "../types";
import {EditableTransferDetail} from "./EditableTransferDetail";

export // ─── Detail shell ─────────────────────────────────────────────────────────────
function TransferOrderDetail({
  voucherId,
  posUser,
  onBack,
}: {
  voucherId: number;
  posUser: PosUser;
  onBack: () => void;
}) {
  const { data: detail, isLoading } = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-4 space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back
        </Button>
        <p className="text-sm text-destructive">Failed to load order.</p>
      </div>
    );
  }

  return <EditableTransferDetail detail={detail} posUser={posUser} voucherId={voucherId} onBack={onBack} />;
}

// ─── Create Transfer Dialog (multi-location POS users) ───────────────────────
