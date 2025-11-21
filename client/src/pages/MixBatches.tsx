import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Package, CheckCircle, Clock, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { MixBatch } from "@shared/schema";

export default function MixBatches() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: batches, isLoading } = useQuery<MixBatch[]>({
    queryKey: ["/api/mix-batches"],
  });

  const filteredBatches = batches?.filter((batch) => {
    if (statusFilter === "all") return true;
    return batch.status === statusFilter;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PLANNING":
        return <Clock className="h-4 w-4" />;
      case "IN_PROGRESS":
        return <PlayCircle className="h-4 w-4" />;
      case "COMPLETED":
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "PLANNING":
        return "outline";
      case "IN_PROGRESS":
        return "default";
      case "COMPLETED":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mix Batches</h1>
          <p className="text-muted-foreground mt-1">
            Combine containers into batches for bale production
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
                <SelectItem value="all">All Batches</SelectItem>
                <SelectItem value="PLANNING">Planning</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
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
                  <TableHead>Batch Code</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Planned Weight (kg)</TableHead>
                  <TableHead className="text-right">Actual Weight (kg)</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Cost/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBatches.map((batch) => (
                  <TableRow
                    key={batch.id}
                    className="hover-elevate"
                    data-testid={`row-batch-${batch.id}`}
                  >
                    <TableCell className="font-medium" data-testid={`text-batch-code-${batch.id}`}>
                      {batch.batchCode}
                    </TableCell>
                    <TableCell>{batch.targetCategory ?? "—"}</TableCell>
                    <TableCell>{batch.targetGrade ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {parseFloat(batch.totalPlannedWeight || "0").toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {parseFloat(batch.totalActualWeight || "0").toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${parseFloat(batch.totalCost).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${parseFloat(batch.costPerKg).toFixed(2)}
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
                    <TableCell className="text-muted-foreground">
                      {batch.createdBy}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No batches found</h3>
              <p className="text-muted-foreground mb-4">
                {statusFilter === "all"
                  ? "Create your first mix batch to get started"
                  : `No batches with status: ${statusFilter}`}
              </p>
              {statusFilter === "all" && (
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
