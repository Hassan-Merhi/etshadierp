import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatNumber } from "@/lib/formatNumber";
import { Plus, Trash2, Package, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { FactoryMixBatch } from "@shared/schema";

interface RawStockRow {
  id: number;
  containerId: number;
  containerNumber: string;
  receivedKg: string;
  usedKg: string;
  remainingKg: string;
  costPerKg: string;
  supplierName: string | null;
}

interface SourceSelection {
  type: "container" | "batch";
  sourceId: number;
  label: string;
  weightKg: number;
  costPerKg: number;
  totalCost: number;
  availableKg: number;
}

interface CreateMixBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMixBatchDialog({
  open,
  onOpenChange,
}: CreateMixBatchDialogProps) {
  const { toast } = useToast();
  const [selectedSources, setSelectedSources] = useState<SourceSelection[]>([]);
  const [sourceType, setSourceType] = useState<"container" | "batch">("container");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [weightInput, setWeightInput] = useState<string>("");
  const [batchName, setBatchName] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rawStock } = useQuery<RawStockRow[]>({
    queryKey: ["/api/factory/raw-stock/by-container"],
    enabled: open,
  });

  const { data: existingBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
    enabled: open,
  });

  const availableRawStock = rawStock?.filter(
    (r) =>
      parseFloat(r.remainingKg) > 0 &&
      !selectedSources.some((s) => s.type === "container" && s.sourceId === r.containerId)
  );

  const availableBatches = existingBatches?.filter((b) => {
    const remaining = parseFloat(b.totalWeightKg) - parseFloat(b.usedKg);
    return (
      remaining > 0.001 &&
      b.status === "ACTIVE" &&
      !selectedSources.some((s) => s.type === "batch" && s.sourceId === b.id)
    );
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const containerSources = selectedSources
        .filter((s) => s.type === "container")
        .map((s) => ({
          containerId: s.sourceId,
          weightKg: s.weightKg.toString(),
          costPerKg: s.costPerKg.toString(),
          totalCost: s.totalCost.toString(),
        }));

      const batchSourcesList = selectedSources
        .filter((s) => s.type === "batch")
        .map((s) => ({
          sourceBatchId: s.sourceId,
          weightKg: s.weightKg.toString(),
        }));

      const response = await fetch("/api/factory/mix-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: batchName || undefined,
          notes: notes || undefined,
          sources: containerSources.length > 0 ? containerSources : undefined,
          batchSources: batchSourcesList.length > 0 ? batchSourcesList : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create batch");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      toast({ title: "Success", description: "Mix batch created successfully" });
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSourceSelect = (id: string) => {
    setSelectedSourceId(id);
    if (sourceType === "container") {
      const stock = rawStock?.find((r) => r.containerId.toString() === id);
      if (stock) setWeightInput(stock.remainingKg);
    } else {
      const batch = existingBatches?.find((b) => b.id.toString() === id);
      if (batch) {
        const remaining = parseFloat(batch.totalWeightKg) - parseFloat(batch.usedKg);
        setWeightInput(remaining.toFixed(3));
      }
    }
  };

  const handleAddSource = () => {
    if (!selectedSourceId || !weightInput) {
      toast({ title: "Missing information", description: "Please select a source and enter weight", variant: "destructive" });
      return;
    }

    const weight = parseFloat(weightInput);
    if (isNaN(weight) || weight <= 0) {
      toast({ title: "Invalid weight", description: "Please enter a valid weight greater than 0", variant: "destructive" });
      return;
    }

    if (sourceType === "container") {
      const stock = rawStock?.find((r) => r.containerId.toString() === selectedSourceId);
      if (!stock) return;

      const available = parseFloat(stock.remainingKg);
      if (weight > available + 0.001) {
        toast({ title: "Exceeds available", description: `Only ${formatNumber(available)} kg available from this container`, variant: "destructive" });
        return;
      }

      const costPerKg = parseFloat(stock.costPerKg);
      setSelectedSources((prev) => [
        ...prev,
        {
          type: "container",
          sourceId: stock.containerId,
          label: stock.containerNumber,
          weightKg: weight,
          costPerKg,
          totalCost: weight * costPerKg,
          availableKg: available,
        },
      ]);
    } else {
      const batch = existingBatches?.find((b) => b.id.toString() === selectedSourceId);
      if (!batch) return;

      const available = parseFloat(batch.totalWeightKg) - parseFloat(batch.usedKg);
      if (weight > available + 0.001) {
        toast({ title: "Exceeds available", description: `Only ${formatNumber(available)} kg remaining in this batch`, variant: "destructive" });
        return;
      }

      const costPerKg = parseFloat(batch.costPerKg);
      setSelectedSources((prev) => [
        ...prev,
        {
          type: "batch",
          sourceId: batch.id,
          label: batch.name || batch.batchCode,
          weightKg: weight,
          costPerKg,
          totalCost: weight * costPerKg,
          availableKg: available,
        },
      ]);
    }

    setSelectedSourceId("");
    setWeightInput("");
  };

  const handleRemoveSource = (type: string, sourceId: number) => {
    setSelectedSources((prev) => prev.filter((s) => !(s.type === type && s.sourceId === sourceId)));
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedSources([]);
    setSelectedSourceId("");
    setWeightInput("");
    setBatchName("");
    setNotes("");
    setSourceType("container");
  };

  const totalWeight = selectedSources.reduce((sum, s) => sum + s.weightKg, 0);
  const totalCost = selectedSources.reduce((sum, s) => sum + s.totalCost, 0);
  const blendedCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Mix Batch</DialogTitle>
          <DialogDescription>
            Combine raw stock containers and/or existing batch leftovers into a new batch.
            The batch code will be auto-generated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Batch Name (optional)</Label>
            <Input
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="e.g. Cyprus + Australia Mix"
              data-testid="input-batch-name"
            />
          </div>

          <div className="space-y-4">
            <h3 className="font-medium">Add Sources</h3>

            <div className="flex gap-2 mb-2">
              <Button
                type="button"
                variant={sourceType === "container" ? "default" : "outline"}
                size="sm"
                onClick={() => { setSourceType("container"); setSelectedSourceId(""); setWeightInput(""); }}
                data-testid="button-source-type-container"
              >
                <Package className="h-4 w-4 mr-1" />
                Raw Stock Container
              </Button>
              <Button
                type="button"
                variant={sourceType === "batch" ? "default" : "outline"}
                size="sm"
                onClick={() => { setSourceType("batch"); setSelectedSourceId(""); setWeightInput(""); }}
                data-testid="button-source-type-batch"
              >
                <Layers className="h-4 w-4 mr-1" />
                Existing Batch
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {sourceType === "container" ? (
                <Select value={selectedSourceId} onValueChange={handleSourceSelect}>
                  <SelectTrigger data-testid="select-raw-stock-container">
                    <SelectValue placeholder="Select container" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRawStock?.map((stock) => (
                      <SelectItem key={stock.containerId} value={stock.containerId.toString()}>
                        {stock.containerNumber} ({formatNumber(parseFloat(stock.remainingKg))} kg @ ${parseFloat(stock.costPerKg).toFixed(4)}/kg)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={selectedSourceId} onValueChange={handleSourceSelect}>
                  <SelectTrigger data-testid="select-existing-batch">
                    <SelectValue placeholder="Select batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableBatches?.map((batch) => {
                      const remaining = parseFloat(batch.totalWeightKg) - parseFloat(batch.usedKg);
                      return (
                        <SelectItem key={batch.id} value={batch.id.toString()}>
                          {batch.name || batch.batchCode} ({formatNumber(remaining)} kg @ ${parseFloat(batch.costPerKg).toFixed(4)}/kg)
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}

              <Input
                type="number"
                placeholder="Weight (kg)"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                step="0.001"
                data-testid="input-source-weight"
              />

              <Button
                type="button"
                onClick={handleAddSource}
                disabled={!selectedSourceId || !weightInput}
                data-testid="button-add-source"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          {selectedSources.length > 0 && (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Cost/kg</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedSources.map((selection) => (
                    <TableRow key={`${selection.type}-${selection.sourceId}`}>
                      <TableCell className="font-medium">{selection.label}</TableCell>
                      <TableCell>
                        <Badge variant={selection.type === "container" ? "outline" : "secondary"}>
                          {selection.type === "container" ? "Container" : "Batch"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {selection.weightKg.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${selection.costPerKg.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(selection.totalCost)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveSource(selection.type, selection.sourceId)}
                          data-testid={`button-remove-${selection.type}-${selection.sourceId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-md">
            <div>
              <p className="text-sm text-muted-foreground">Total Weight</p>
              <p className="text-2xl font-bold font-mono" data-testid="text-total-weight">
                {formatNumber(totalWeight)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Cost</p>
              <p className="text-2xl font-bold font-mono" data-testid="text-total-cost">
                ${formatNumber(totalCost)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Blended Cost/kg</p>
              <p className="text-2xl font-bold font-mono" data-testid="text-cost-per-kg">
                ${blendedCostPerKg.toFixed(4)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this batch..."
              data-testid="input-notes"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || selectedSources.length === 0}
              data-testid="button-submit"
            >
              {createMutation.isPending ? "Creating..." : "Create Batch"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
