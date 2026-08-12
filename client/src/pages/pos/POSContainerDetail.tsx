import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Download, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { utils, writeFile } from "@/lib/excelHelper";

interface PosContainerItem {
  itemName: string;
  quantity: string;
}

interface PosContainerDetailResponse {
  container: {
    id: number;
    containerNumber: string;
  };
  items: PosContainerItem[];
  totalQty: number;
}

async function loadContainerDetail(id: string): Promise<PosContainerDetailResponse> {
  const response = await fetch(`/api/pos/containers-otw/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Failed to load container");
  return body;
}

function formatQty(value: string | number): string {
  const quantity = Number.parseFloat(String(value));
  if (!Number.isFinite(quantity)) return "0";
  return quantity.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export default function POSContainerDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const containerId = params.id;

  const { data, isLoading, isError, error } = useQuery<PosContainerDetailResponse>({
    queryKey: ["/api/pos/containers-otw/detail", containerId],
    queryFn: () => loadContainerDetail(containerId),
    enabled: Boolean(containerId),
    staleTime: 30_000,
  });

  async function exportNoCostNoFreight() {
    if (!data) return;
    try {
      const rows: Array<Record<string, string | number>> = data.items.map((item) => ({
        "Item Name": item.itemName,
        Qty: Number.parseFloat(item.quantity) || 0,
      }));
      rows.push({ "Item Name": "TOTAL QTY", Qty: data.totalQty });

      const worksheet = utils.json_to_sheet(rows);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Container Items");
      await writeFile(workbook, `container_${data.container.containerNumber}_no_cost_no_freight.xlsx`);
      toast({
        title: "Export downloaded",
        description: "No-cost / no-freight Excel file is ready.",
      });
    } catch (exportError) {
      toast({
        title: "Export failed",
        description: exportError instanceof Error ? exportError.message : "Unable to create Excel export",
        variant: "destructive",
      });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="pos-container-detail-loading">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-72 items-center justify-center text-center">
        <div>
          <Package className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-medium">Container unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Container not found"}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/pos-containers")}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to containers
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pos-container-detail-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/pos-containers")}
            aria-label="Back to containers"
            data-testid="button-pos-container-back"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold sm:text-2xl">Container {data.container.containerNumber}</h1>
            <p className="text-sm text-muted-foreground">Item quantities only — no cost or freight information</p>
          </div>
        </div>
        <Button onClick={exportNoCostNoFreight} className="gap-2" data-testid="button-pos-container-no-cost-export">
          <Download className="h-4 w-4" aria-hidden="true" />
          No Cost / No Freight Export
        </Button>
      </div>

      <div className="overflow-auto rounded-lg border" data-table-scroll-region>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item Name</TableHead>
              <TableHead className="text-right">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="h-32 text-center text-muted-foreground">
                  No items found in this container
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((item, index) => (
                <TableRow key={`${item.itemName}-${index}`} data-testid={`row-pos-container-item-${index}`}>
                  <TableCell className="font-medium">{item.itemName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(item.quantity)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total Qty</TableCell>
              <TableCell
                className="text-right text-base font-bold tabular-nums"
                data-testid="text-pos-container-total-qty"
              >
                {formatQty(data.totalQty)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
