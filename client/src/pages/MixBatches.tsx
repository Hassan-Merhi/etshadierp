import { useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Package, CheckCircle, PlayCircle } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateMixBatchDialog } from "../components/CreateMixBatchDialog";
import { formatNumber } from "@/lib/formatNumber";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import type { FactoryMixBatch } from "@shared/schema";
import { useEscapeBack } from "@/hooks/use-escape-back";

const BatchDetail = lazy(() => import("./BatchDetail"));

export default function MixBatches() {
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  useEscapeBack(selectedBatchId !== null ? () => setSelectedBatchId(null) : null);
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: batches, isLoading } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
  });

  const filteredBatches = batches?.filter((batch) => {
    if (statusFilter === "all") return true;
    return batch.status === statusFilter;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <PlayCircle className="h-4 w-4" />;
      case "COMPLETED":
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

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

  if (selectedBatchId !== null) {
    return (
      <Suspense fallback={<div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>}>
        <BatchDetail batchId={selectedBatchId} onBack={() => setSelectedBatchId(null)} />
      </Suspense>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mix Batches</h1>
          <p className="text-muted-foreground mt-1">
            Combine raw stock containers and existing batches for bale production
          </p>
        </div>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          data-testid="button-create-mix-batch"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Batch
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Batch List</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48" data-testid="select-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="all">All Batches</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredBatches && filteredBatches.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Total (kg)</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead className="text-right">Cost/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBatches.map((batch) => {
                  const total = parseFloat(batch.totalWeightKg || "0");
                  const used = parseFloat(batch.usedKg || "0");
                  const remaining = total - used;
                  const usagePercent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
                  return (
                    <TableRow
                      key={batch.id}
                      className="hover-elevate cursor-pointer"
                      onClick={() => setSelectedBatchId(batch.id)}
                      data-testid={`row-batch-${batch.id}`}
                    >
                      <TableCell className="font-medium" data-testid={`text-batch-name-${batch.id}`}>
                        {batch.name || batch.batchCode}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(total)}
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Used: <span className="font-mono font-medium text-foreground">{formatNumber(used)}</span> kg</span>
                            <span>Left: <span className="font-mono font-medium text-foreground">{formatNumber(remaining)}</span> kg</span>
                          </div>
                          <Progress value={usagePercent} className="h-2" />
                          <div className="text-xs text-muted-foreground text-right">
                            {usagePercent.toFixed(0)}% used
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(batch.costPerKg).toFixed(4)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusVariant(batch.status)}
                          className="gap-1"
                          data-testid={`badge-status-${batch.id}`}
                        >
                          {getStatusIcon(batch.status)}
                          {batch.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(batch.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No batches found</h3>
              <p className="text-muted-foreground mb-4">
                {statusFilter === "all" || statusFilter === "ACTIVE"
                  ? "Create your first mix batch to get started"
                  : `No batches with status: ${statusFilter}`}
              </p>
              {(statusFilter === "all" || statusFilter === "ACTIVE") && (
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Batch
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateMixBatchDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
