import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, Scale, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";
import type { FactoryMixBatch, FactoryMixBatchSource } from "@shared/schema";

interface BatchDetailProps {
  batchId: number;
  onBack: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_PRESSING: "outline",
  LABEL_PRINTED: "secondary",
  PRESSED: "default",
  FINALIZED: "default",
  RESERVED: "outline",
  SOLD: "destructive",
};

export default function BatchDetail({ batchId, onBack }: BatchDetailProps) {
  const { data: batch, isLoading: batchLoading } = useQuery<FactoryMixBatch>({
    queryKey: ["/api/factory/mix-batches", batchId],
  });

  const { data: balesData, isLoading: balesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/bales", { mixBatchId: batchId }],
    queryFn: async () => {
      const res = await fetch(`/api/factory/bales?mixBatchId=${batchId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch bales");
      return res.json();
    },
  });

  const { data: sources, isLoading: sourcesLoading } = useQuery<FactoryMixBatchSource[]>({
    queryKey: ["/api/factory/mix-batches", batchId, "sources"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/mix-batches/${batchId}/sources`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch sources");
      return res.json();
    },
  });

  const isLoading = batchLoading || balesLoading || sourcesLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={onBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Batch not found</p>
        </div>
      </div>
    );
  }

  const totalWeight = parseFloat(batch.totalWeightKg || "0");
  const usedWeight = parseFloat(batch.usedKg || "0");
  const remainingWeight = totalWeight - usedWeight;
  const usagePercent = totalWeight > 0 ? Math.min((usedWeight / totalWeight) * 100, 100) : 0;
  const costPerKg = parseFloat(batch.costPerKg || "0");

  const bales = balesData || [];
  const totalBalesCount = bales.length;
  const totalBalesWeight = bales.reduce(
    (sum: number, row: any) => sum + parseFloat(row.bale?.weightKg || "0"),
    0
  );
  const avgCost =
    totalBalesCount > 0
      ? bales.reduce(
          (sum: number, row: any) => sum + parseFloat(row.bale?.costPerKg || "0"),
          0
        ) / totalBalesCount
      : 0;

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "default";
      case "COMPLETED":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} data-testid="button-back">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      <Card data-testid="card-batch-info">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <Boxes className="h-5 w-5 text-muted-foreground" />
              <CardTitle data-testid="text-batch-name">
                {batch.name || batch.batchCode}
              </CardTitle>
              <Badge
                variant={getStatusVariant(batch.status) as any}
                data-testid="badge-batch-status"
              >
                {batch.status}
              </Badge>
            </div>
            <span className="text-sm text-muted-foreground" data-testid="text-batch-date">
              {new Date(batch.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Weight</p>
              <p className="text-lg font-mono font-semibold" data-testid="text-total-weight">
                {formatNumber(totalWeight)} kg
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Used Weight</p>
              <p className="text-lg font-mono font-semibold" data-testid="text-used-weight">
                {formatNumber(usedWeight)} kg
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="text-lg font-mono font-semibold" data-testid="text-remaining-weight">
                {formatNumber(remainingWeight)} kg
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cost/kg</p>
              <p className="text-lg font-mono font-semibold" data-testid="text-cost-per-kg">
                ${costPerKg.toFixed(4)}
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Utilization: <span className="font-mono font-medium text-foreground">{formatNumber(usedWeight)}</span> / {formatNumber(totalWeight)} kg
              </span>
              <span>{usagePercent.toFixed(0)}%</span>
            </div>
            <Progress value={usagePercent} className="h-2" data-testid="progress-utilization" />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-sources">
        <CardHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <Scale className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Sources</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {(sources || []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Scale className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No sources recorded</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Cost/kg</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sources || []).map((source) => (
                    <TableRow key={source.id} data-testid={`row-source-${source.id}`}>
                      <TableCell className="font-medium">
                        {source.containerId
                          ? `Container #${source.containerId}`
                          : source.sourceBatchId
                          ? `Batch #${source.sourceBatchId}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(source.weightKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        ${parseFloat(source.costPerKg).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(parseFloat(source.totalCost), 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-bales">
        <CardHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <Package className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Bales Produced</CardTitle>
            <Badge variant="secondary" data-testid="badge-bales-count">
              {totalBalesCount} bales
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {bales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No bales produced from this batch yet</p>
            </div>
          ) : (
            <>
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bale Code</TableHead>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Article Code</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Cost/kg</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bales.map((row: any) => {
                      const bale = row.bale;
                      const product = row.product;
                      const location = row.location;
                      return (
                        <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                          <TableCell className="font-mono text-xs">
                            {bale.baleCode}
                          </TableCell>
                          <TableCell>{product?.name || "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {product?.articleCode || bale.category || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(parseFloat(bale.weightKg))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            ${parseFloat(bale.costPerKg).toFixed(4)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={(STATUS_COLORS[bale.status] || "secondary") as any}
                              data-testid={`badge-status-${bale.id}`}
                            >
                              {bale.status.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {location?.name || bale.warehouseLocation || "-"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(bale.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center gap-6 flex-wrap mt-4 pt-4 border-t text-sm text-muted-foreground" data-testid="summary-footer">
                <span>
                  Total Bales: <span className="font-mono font-medium text-foreground">{totalBalesCount}</span>
                </span>
                <span>
                  Total Weight: <span className="font-mono font-medium text-foreground">{formatNumber(totalBalesWeight)} kg</span>
                </span>
                <span>
                  Avg Cost/kg: <span className="font-mono font-medium text-foreground">${avgCost.toFixed(4)}</span>
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
