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

interface SupplierRawStock {
  supplierName: string;
  supplierId: number | null;
  receivedKg: string;
  usedKg: string;
  remainingKg: string;
  costPerKg: string;
  valueRemaining: string;
  lastOffloaded: string;
}

interface SourceSelection {
  type: "supplier" | "batch";
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
  const [sourceType, setSourceType] = useState<"supplier" | "batch">("supplier");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [weightInput, setWeightInput] = useState<string>("");
  const [batchName, setBatchName] = useState("");
  const [notes, setNotes] = useState("");
  const [openingBatchId, setOpeningBatchId] = useState<string>("");

  const { data: supplierStock } = useQuery<SupplierRawStock[]>({
    queryKey: ["/api/factory/raw-stock"],
    enabled: open,
  });

  const { data: existingBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
    enabled: open,
  });

  const availableSuppliers = supplierStock?.filter(
    (s) =>
      parseFloat(s.remainingKg) > 0 &&
      s.supplierId !== null &&
      !selectedSources.some((sel) => sel.type === "supplier" && sel.sourceId === s.supplierId!)
  );

  const availableBatchesForOpening = existingBatches?.filter((b) => {
    const remaining = parseFloat(b.totalWeightKg) - parseFloat(b.usedKg);
    return remaining > 0.001 && b.status === "ACTIVE";
  });

  const openingBatch = openingBatchId && openingBatchId !== "none"
    ? existingBatches?.find((b) => b.id.toString() === openingBatchId)
    : null;

  const openingBatchRemaining = openingBatch
    ? parseFloat(openingBatch.totalWeightKg) - parseFloat(openingBatch.usedKg)
    : 0;
  const openingBatchCost = openingBatch ? parseFloat(openingBatch.costPerKg) : 0;
  const openingBatchTotalCost = openingBatchRemaining * openingBatchCost;

  const createMutation = useMutation({
    mutationFn: async () => {
      const supplierSources = selectedSources
        .filter((s) => s.type === "supplier")
        .map((s) => ({
          supplierId: s.sourceId,
          weightKg: s.weightKg.toString(),
          costPerKg: s.costPerKg.toString(),
        }));

      const response = await fetch("/api/factory/mix-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: batchName || undefined,
          notes: notes || undefined,
          supplierSources: supplierSources.length > 0 ? supplierSources : undefined,
          openingBatchId: openingBatchId && openingBatchId !== "none" ? parseInt(openingBatchId) : undefined,
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
    if (sourceType === "supplier") {
      const stock = supplierStock?.find((s) => s.supplierId?.toString() === id);
      if (stock) setWeightInput(stock.remainingKg);
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

    if (sourceType === "supplier") {
      const stock = supplierStock?.find((s) => s.supplierId?.toString() === selectedSourceId);
      if (!stock || !stock.supplierId) return;

      const available = parseFloat(stock.remainingKg);
      if (weight > available + 0.001) {
        toast({ title: "Exceeds available", description: `Only ${formatNumber(available)} kg available from ${stock.supplierName}`, variant: "destructive" });
        return;
      }

      const costPerKg = parseFloat(stock.costPerKg);
      setSelectedSources((prev) => [
        ...prev,
        {
          type: "supplier",
          sourceId: stock.supplierId!,
          label: stock.supplierName,
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
    setSourceType("supplier");
    setOpeningBatchId("");
  };

  const supplierWeight = selectedSources.reduce((sum, s) => sum + s.weightKg, 0);
  const supplierCost = selectedSources.reduce((sum, s) => sum + s.totalCost, 0);
  const totalWeight = supplierWeight + openingBatchRemaining;
  const totalCost = supplierCost + openingBatchTotalCost;
  const blendedCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;
  const hasAnySources = selectedSources.length > 0 || (openingBatchId && openingBatchId !== "none");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Mix Batch</DialogTitle>
          <DialogDescription>
            Combine supplier raw stock and/or an existing batch opening balance into a new batch.
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
            <h3 className="font-medium">Opening Stock (optional)</h3>
            <p className="text-sm text-muted-foreground">
              Select an existing batch to carry its remaining balance into the new batch. The old batch will be closed.
            </p>
            <Select value={openingBatchId} onValueChange={setOpeningBatchId}>
              <SelectTrigger data-testid="select-opening-batch">
                <SelectValue placeholder="No opening stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No opening stock</SelectItem>
                {availableBatchesForOpening?.map((batch) => {
                  const remaining = parseFloat(batch.totalWeightKg) - parseFloat(batch.usedKg);
                  return (
                    <SelectItem key={batch.id} value={batch.id.toString()}>
                      {batch.name || batch.batchCode} ({formatNumber(remaining)} kg @ ${parseFloat(batch.costPerKg).toFixed(4)}/kg)
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {openingBatch && (
              <div className="p-3 border rounded-md bg-muted/50">
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{openingBatch.name || openingBatch.batchCode}</span>
                  <Badge variant="secondary">Opening Stock</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Remaining: <span className="font-mono">{formatNumber(openingBatchRemaining)} kg</span> @ <span className="font-mono">${openingBatchCost.toFixed(4)}/kg</span> = <span className="font-mono">${formatNumber(openingBatchTotalCost)}</span>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="font-medium">Add Supplier Sources</h3>

            <div className="grid grid-cols-3 gap-2">
              <Select value={selectedSourceId} onValueChange={handleSourceSelect}>
                <SelectTrigger data-testid="select-supplier-source">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {availableSuppliers?.map((stock) => (
                    <SelectItem key={stock.supplierId!} value={stock.supplierId!.toString()}>
                      {stock.supplierName} ({formatNumber(parseFloat(stock.remainingKg))} kg @ ${parseFloat(stock.costPerKg).toFixed(4)}/kg)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

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
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Avg Cost/kg</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedSources.map((selection) => (
                    <TableRow key={`${selection.type}-${selection.sourceId}`}>
                      <TableCell className="font-medium">{selection.label}</TableCell>
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
              disabled={createMutation.isPending || !hasAnySources}
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
