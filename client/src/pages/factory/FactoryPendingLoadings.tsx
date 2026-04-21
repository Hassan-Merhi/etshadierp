import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Clock, Package, Play, Trash2, Download, Link, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, keyStartsWith } from "@/lib/queryClient";

interface PendingLoad {
  id: number;
  customerId: number;
  customerName: string;
  orderDate: string;
  totalQtyBales: number;
  proformaIdUsed: number | null;
  proformaName: string | null;
  locationId: number | null;
  loadingStartedAt: string | null;
  status: string;
}

interface Proforma {
  id: number;
  name: string;
  status: string;
  customerId: number;
  createdAt: string;
  lines: Array<{ id: number; articleCode: string; productName: string; qty: number }>;
}

export default function FactoryPendingLoadings() {
  const { formatDisplayDate } = useDateFormat();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<PendingLoad | null>(null);
  const [linkTarget, setLinkTarget] = useState<PendingLoad | null>(null);
  const [selectedProformaId, setSelectedProformaId] = useState<number | null>(null);

  const { data: loads = [], isLoading } = useQuery<PendingLoad[]>({
    queryKey: ["/api/factory/customer-orders?status=LOADING"],
    refetchInterval: 30000,
  });

  const { data: proformas = [], isLoading: proformasLoading } = useQuery<Proforma[]>({
    queryKey: ["/api/factory/customer-proformas", linkTarget?.customerId],
    queryFn: async () => {
      if (!linkTarget) return [];
      const res = await fetch(`/api/factory/customer-proformas?customerId=${linkTarget.customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proformas");
      return res.json();
    },
    enabled: !!linkTarget,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/factory/customer-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      toast({ title: "Loading deleted", description: "Bales have been returned to stock." });
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const linkProformaMutation = useMutation({
    mutationFn: async ({ orderId, proformaId }: { orderId: number; proformaId: number | null }) => {
      return await apiRequest("PATCH", `/api/factory/customer-orders/${orderId}/link-proforma`, { proformaId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      toast({ title: "Proforma linked", description: "The loading has been linked to the selected proforma." });
      closeLinkDialog();
    },
    onError: (err: any) => {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    },
  });

  const closeLinkDialog = () => {
    setLinkTarget(null);
    setSelectedProformaId(null);
  };

  const handleOpenLink = (load: PendingLoad) => {
    setLinkTarget(load);
    setSelectedProformaId(load.proformaIdUsed);
  };

  const handleConfirmLink = () => {
    if (!linkTarget) return;
    linkProformaMutation.mutate({ orderId: linkTarget.id, proformaId: selectedProformaId });
  };

  const handleExport = (load: PendingLoad) => {
    window.open(`/api/factory/customer-orders/${load.id}/pending-export`, "_blank");
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const date = formatDisplayDate(dateStr.split("T")[0]);
    const time = new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
  };

  return (
    <div className="flex flex-col h-full p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Pending Loadings</h1>
        <p className="text-muted-foreground text-sm">In-progress container loads saved for later</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : loads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" data-testid="text-no-loads">
          <Clock className="h-16 w-16 mb-4 opacity-30" />
          <p className="text-lg font-medium">No pending loads</p>
          <p className="text-sm mt-1">All container loadings are either complete or not yet started.</p>
          <Button className="mt-6" onClick={() => navigate("/factory/sales/loading/new")} data-testid="button-start-new">
            <Play className="h-4 w-4 mr-2" />
            Start New Loading
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {loads.map((load) => (
            <Card key={load.id} className="p-4" data-testid={`card-load-${load.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base" data-testid={`text-customer-${load.id}`}>
                      {load.customerName || `Customer #${load.customerId}`}
                    </span>
                    <Badge variant="secondary" data-testid={`badge-load-id-${load.id}`}>
                      Loading #{load.id}
                    </Badge>
                    {load.proformaIdUsed ? (
                      <Badge variant="outline" data-testid={`badge-proforma-${load.id}`}>
                        <Link className="h-3 w-3 mr-1" />
                        {load.proformaName ? load.proformaName : `Proforma #${load.proformaIdUsed}`}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-no-proforma-${load.id}`}>
                        No proforma linked
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    <span>
                      <Clock className="inline h-3 w-3 mr-1" />
                      Started: {formatDate(load.loadingStartedAt)}
                    </span>
                    <span>
                      <Package className="inline h-3 w-3 mr-1" />
                      {load.totalQtyBales} bales scanned
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleExport(load)}
                    data-testid={`button-export-${load.id}`}
                    title="Export to Excel"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenLink(load)}
                    data-testid={`button-link-proforma-${load.id}`}
                    title="Link proforma"
                  >
                    <Link className="h-4 w-4 mr-1.5" />
                    {load.proformaIdUsed ? "Change Proforma" : "Link Proforma"}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setDeleteTarget(load)}
                    data-testid={`button-delete-${load.id}`}
                    title="Delete loading (returns bales to stock)"
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => navigate(`/factory/sales/loading/new?orderId=${load.id}`)}
                    data-testid={`button-resume-${load.id}`}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Resume
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Link Proforma Dialog */}
      <Dialog open={!!linkTarget} onOpenChange={(open) => { if (!open) closeLinkDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link Proforma to Loading #{linkTarget?.id}</DialogTitle>
            <DialogDescription>
              Select a proforma for <strong>{linkTarget?.customerName}</strong> to link to this loading. The proforma will be used to validate scanned bales.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[400px] overflow-y-auto py-2">
            {proformasLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : proformas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No proformas found for this customer.</p>
            ) : (
              <>
                {/* Option to unlink */}
                <button
                  type="button"
                  onClick={() => setSelectedProformaId(null)}
                  className={`w-full text-left rounded-md border p-3 transition-colors ${
                    selectedProformaId === null
                      ? "border-primary bg-primary/5"
                      : "border-border hover-elevate"
                  }`}
                  data-testid="option-no-proforma"
                >
                  <div className="flex items-center gap-2">
                    <X className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">No proforma (unlink)</span>
                  </div>
                </button>

                {proformas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProformaId(p.id)}
                    className={`w-full text-left rounded-md border p-3 transition-colors ${
                      selectedProformaId === p.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover-elevate"
                    }`}
                    data-testid={`option-proforma-${p.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.name || `Proforma #${p.id}`}</span>
                        <Badge
                          variant={p.status === "ACTIVE" ? "default" : "secondary"}
                          className="text-xs no-default-active-elevate"
                        >
                          {p.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {p.lines?.length ?? 0} lines
                      </span>
                    </div>
                    {p.createdAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Created {formatDisplayDate(p.createdAt.split("T")[0])}
                      </p>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeLinkDialog} data-testid="button-cancel-link">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmLink}
              disabled={linkProformaMutation.isPending}
              data-testid="button-confirm-link"
            >
              {linkProformaMutation.isPending ? "Linking…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pending loading?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete Loading #{deleteTarget?.id} for{" "}
              <strong>{deleteTarget?.customerName}</strong> and return all{" "}
              {deleteTarget?.totalQtyBales} scanned bales back to stock. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete & Return to Stock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
