import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Clock, Package, Play, StickyNote } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

interface PendingLoad {
  id: number;
  customerId: number;
  customerName: string;
  orderDate: string;
  totalQtyBales: number;
  proformaIdUsed: number | null;
  locationId: number | null;
  loadingStartedAt: string | null;
  containerNotes: string | null;
  status: string;
}

export default function PendingLoadings() {
  const [, navigate] = useLocation();

  const { data: loads = [], isLoading } = useQuery<PendingLoad[]>({
    queryKey: ["/api/factory/customer-orders?status=LOADING"],
    refetchInterval: 30000,
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full p-4 lg:p-6">
      <div className="mb-6">
        <PageHeader title="Pending Loadings" subtitle="In-progress container loads saved for later" />
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
                    {load.proformaIdUsed && (
                      <Badge variant="outline" data-testid={`badge-proforma-${load.id}`}>
                        Proforma #{load.proformaIdUsed}
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
                  {load.containerNotes && (
                    <div className="flex items-start gap-1.5 text-sm text-muted-foreground mt-0.5" data-testid={`text-note-${load.id}`}>
                      <StickyNote className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="italic">{load.containerNotes}</span>
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => navigate(`/factory/sales/loading/new?orderId=${load.id}`)}
                  data-testid={`button-resume-${load.id}`}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Resume
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
