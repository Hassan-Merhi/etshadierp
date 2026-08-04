import {useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {ArrowLeft} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import type {PosUser, TransferDetail, TransferDetailItem} from "../types";
import {EditableTransferDetail} from "./EditableTransferDetail";

export function TransferOrderDetail({
  voucherId,
  posUser,
  onBack,
}: {
  voucherId: number;
  posUser: PosUser;
  onBack: () => void;
}) {
  const {data: detail, isLoading} = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, {credentials: "include"});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const editorDetail = useMemo<TransferDetail | null>(() => {
    if (!detail) return null;

    const effective = new Map<string, TransferDetailItem>();
    for (const item of detail.items) {
      effective.set(`${item.stockItemId}:${item.sourceLocationId ?? ""}`, {...item});
    }

    let syntheticId = -1;
    for (const revision of [...(detail.revisions ?? [])].sort((a, b) => a.revisionNumber - b.revisionNumber)) {
      if (revision.status === "rejected" || revision.status === "superseded") continue;
      for (const item of revision.items) {
        const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
        const existing = effective.get(key);
        const quantity = String(Number(item.newQuantity) || 0);
        if (existing) {
          effective.set(key, {
            ...existing,
            quantity,
            stockItemName: item.stockItemName || existing.stockItemName,
            sourceLocationId: item.sourceLocationId ?? existing.sourceLocationId,
            sourceLocationName: item.sourceLocationName ?? existing.sourceLocationName,
          });
        } else if (Number(quantity) > 0) {
          effective.set(key, {
            id: syntheticId--,
            transferId: detail.transferId,
            stockItemId: item.stockItemId,
            stockItemName: item.stockItemName,
            sourceLocationId: item.sourceLocationId ?? undefined,
            sourceLocationName: item.sourceLocationName ?? undefined,
            quantity,
          });
        }
      }
    }

    return {
      ...detail,
      items: Array.from(effective.values()).filter((item) => Number(item.quantity) > 0),
      // The editor receives a clean snapshot. Historical revisions remain in
      // the view-only timeline and are never re-applied as draft deltas.
      revisions: [],
    };
  }, [detail]);

  if (isLoading) {
    return <div className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!editorDetail) {
    return (
      <div className="p-4 space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1.5" />Back</Button>
        <p className="text-sm text-destructive">Failed to load order.</p>
      </div>
    );
  }

  return <EditableTransferDetail detail={editorDetail} posUser={posUser} voucherId={voucherId} onBack={onBack} />;
}
