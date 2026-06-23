import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatNumber } from "@/lib/formatNumber";
import { Plus, Trash2, Layers, Package } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

type SourceType = "supplier" | "batch";

interface SourceSelection {
  type: SourceType;
  sourceId: number;
  label: string;
  weightKg: number;
  costPerKg: number;
  totalCost: number;
  availableKg: number;
}

interface EditMixBatchDialogProps {
  batch: FactoryMixBatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditMixBatchDialog({ batch, open, onOpenChange }: EditMixBatchDialogProps) {
  const { toast } = useToast();
  const [selectedSources, setSelectedSources] = useState<SourceSelection[]>([]);
  const [addSourceType, setAddSourceType] = useState<SourceType>("supplier");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [weightInput, setWeightInput] = useState<string>("");
  const [batchName, setBatchName] = useState("");
  const [notes, setNotes] = useState("");
  const [batchDate, setBatchDate] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  const { data: supplierStock } = useQuery<SupplierRawStock[]>({
    queryKey: ["/api/factory/raw-stock"],
    enabled: open,
  });

  const { data: existingBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
    enabled: open,
  });

  // Fetch current sources for this batch
  const { data: currentSources, isLoading: sourcesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/mix-batches", batch?.id, "sources"],
    queryFn: () =>
      fetch(`/api/factory/mix-batches/${batch!.id}/sources`, { credentials: "include" }).then((r) => r.json()),
    enabled: open && !!batch,
  });

  // Pre-load fields when batch + sources are ready
  useEffect(() => {
    if (!open || !batch || !currentSources || !supplierStock || initialized) return;

    setBatchName(batch.name || "");
    setNotes((batch as any).notes || "");
    setBatchDate((batch as any).batchDate || new Date().toLocaleDateString("en-CA"));

    // Aggregate supplier sources by supplierId
    const supplierMap = new Map<number, { weightKg: number; costPerKg: number; label: string; availableKg: number }>();
    const batchSourceList: SourceSelection[] = [];

    for (const src of currentSources) {
      if (src.sourceBatchId) {
        // Batch source
        const srcBatch = existingBatches?.find((b) => b.id === src.sourceBatchId);
        const existingRemaining = srcBatch ? parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg) : 0;
        batchSourceList.push({
          type: "batch",
          sourceId: src.sourceBatchId,
          label: src.sourceBatchCode || `Batch #${src.sourceBatchId}`,
          weightKg: parseFloat(src.weightKg),
          costPerKg: parseFloat(src.costPerKg),
          totalCost: parseFloat(src.totalCost),
          // Available = what's currently available + what this batch is using (returns on edit)
          availableKg: existingRemaining + parseFloat(src.weightKg),
        });
      } else if (src.supplierId) {
        // Supplier source (may span multiple containers — aggregate by supplierId)
        const existing = supplierMap.get(src.supplierId);
        const stockRow = supplierStock.find((s) => s.supplierId === src.supplierId);
        // Available = current remaining + what was consumed (returns on edit)
        const currentRemaining = stockRow ? parseFloat(stockRow.remainingKg) : 0;
        const srcWeight = parseFloat(src.weightKg);
        if (existing) {
          existing.weightKg += srcWeight;
          existing.totalCost = existing.weightKg * existing.costPerKg;
          existing.availableKg = currentRemaining + existing.weightKg;
        } else {
          supplierMap.set(src.supplierId, {
            weightKg: srcWeight,
            costPerKg: parseFloat(src.costPerKg),
            label: src.supplierName || `Supplier #${src.supplierId}`,
            availableKg: currentRemaining + srcWeight,
          });
        }
      }
    }

    const supplierSources: SourceSelection[] = Array.from(supplierMap.entries()).map(([supplierId, val]) => ({
      type: "supplier",
      sourceId: supplierId,
      label: val.label,
      weightKg: val.weightKg,
      costPerKg: val.costPerKg,
      totalCost: val.weightKg * val.costPerKg,
      availableKg: val.availableKg,
    }));

    setSelectedSources([...supplierSources, ...batchSourceList]);
    setInitialized(true);
  }, [open, batch, currentSources, supplierStock, existingBatches, initialized]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedSources([]);
      setSelectedSourceId("");
      setWeightInput("");
      setBatchName("");
      setNotes("");
      setBatchDate("");
      setInitialized(false);
      setAddSourceType("supplier");
    }
  }, [open]);

  const availableSuppliers = supplierStock?.filter(
    (s) =>
      s.supplierId !== null && !selectedSources.some((sel) => sel.type === "supplier" && sel.sourceId === s.supplierId!)
  );

  const availableBatchesForSource = existingBatches?.filter((b) => {
    if (b.id === batch?.id) return false; // can't use self as source
    const remaining = parseFloat(b.totalWeightKg) - parseFloat(b.usedKg);
    return (
      remaining > 0.001 &&
      (b.status === "ACTIVE" || b.status === "OPEN" || b.status === "CARRY_FORWARD") &&
      !selectedSources.some((sel) => sel.type === "batch" && sel.sourceId === b.id)
    );
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const supplierSourcesPayload = selectedSources
        .filter((s) => s.type === "supplier")
        .map((s) => ({ supplierId: s.sourceId, weightKg: s.weightKg.toString(), costPerKg: s.costPerKg.toString() }));

      const batchSourcesPayload = selectedSources
        .filter((s) => s.type === "batch")
        .map((s) => ({ sourceBatchId: s.sourceId, weightKg: s.weightKg.toString() }));

      const res = await fetch(`/api/factory/mix-batches/${batch!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: batchName || undefined,
          notes: notes || undefined,
          batchDate: batchDate || undefined,
          supplierSources: supplierSourcesPayload,
          batchSources: batchSourcesPayload,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches", batch?.id, "sources"] });
      onOpenChange(false);
      toast({ title: "Batch updated", description: "Sources and totals have been recalculated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSourceIdChange = (id: string) => {
    setSelectedSourceId(id);
    if (addSourceType === "supplier") {
      const stock = supplierStock?.find((s) => s.supplierId?.toString() === id);
      if (stock) {
        // Only prefill if remaining is positive; leave blank for over-use scenarios
        const rem = parseFloat(stock.remainingKg);
        setWeightInput(rem > 0 ? stock.remainingKg : "");
      }
    } else {
      const b = existingBatches?.find((b) => b.id.toString() === id);
      if (b) {
        const remaining = parseFloat(b.totalWeightKg) - parseFloat(b.usedKg);
        setWeightInput(remaining > 0 ? remaining.toFixed(3) : "");
      }
    }
  };

  const handleAddSource = () => {
    if (!selectedSourceId || !weightInput) {
      toast({
        title: "Missing information",
        description: "Please select a source and enter weight",
        variant: "destructive",
      });
      return;
    }
    const weight = parseFloat(weightInput);
    if (isNaN(weight) || weight <= 0) {
      toast({
        title: "Invalid weight",
        description: "Please enter a valid weight greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (addSourceType === "supplier") {
      const stock = supplierStock?.find((s) => s.supplierId?.toString() === selectedSourceId);
      if (!stock || !stock.supplierId) return;
      const available = parseFloat(stock.remainingKg);
      // Over-use allowed: no guard on weight > available
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
    } else {
      const b = existingBatches?.find((b) => b.id.toString() === selectedSourceId);
      if (!b) return;
      const available = parseFloat(b.totalWeightKg) - parseFloat(b.usedKg);
      if (weight > available + 0.001) {
        toast({
          title: "Exceeds available",
          description: `Only ${formatNumber(available)} kg available in this batch`,
          variant: "destructive",
        });
        return;
      }
      const costPerKg = parseFloat(b.costPerKg);
      setSelectedSources((prev) => [
        ...prev,
        {
          type: "batch",
          sourceId: b.id,
          label: b.name || b.batchCode,
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

  const handleUpdateSourceWeight = (type: string, sourceId: number, newWeight: string) => {
    const weight = parseFloat(newWeight);
    if (isNaN(weight) || weight <= 0) return;
    setSelectedSources((prev) =>
      prev.map((s) => {
        if (s.type === type && s.sourceId === sourceId) {
          return { ...s, weightKg: weight, totalCost: weight * s.costPerKg };
        }
        return s;
      })
    );
  };

  const handleRemoveSource = (type: string, sourceId: number) => {
    setSelectedSources((prev) => prev.filter((s) => !(s.type === type && s.sourceId === sourceId)));
  };

  const totalWeight = selectedSources.reduce((s, x) => s + x.weightKg, 0);
  const totalCost = selectedSources.reduce((s, x) => s + x.totalCost, 0);
  const blendedCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;
  const currentUsedKg = batch ? parseFloat((batch as any).usedKg || "0") : 0;
  // Warn if clearly below used (>1 kg gap). Backend enforces the strict check.
  const belowUsed = totalWeight < currentUsedKg - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Mix Batch — {batch?.batchCode}</DialogTitle>
          <DialogDescription>
            Change the raw material sources. Old consumption will be reversed and new amounts will be consumed.
            Already-produced bales ({formatNumber(currentUsedKg)} kg used) must remain covered.
          </DialogDescription>
        </DialogHeader>

        {sourcesLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Name / Date row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Batch Name</Label>
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder={batch?.batchCode || ""}
                  data-testid="input-edit-batch-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Batch Date</Label>
                <Input
                  type="date"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  data-testid="input-edit-batch-date"
                />
              </div>
            </div>

            {/* Add source controls */}
            <div className="space-y-3">
              <h3 className="font-medium">Sources</h3>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant={addSourceType === "supplier" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setAddSourceType("supplier");
                    setSelectedSourceId("");
                    setWeightInput("");
                  }}
                  data-testid="button-source-type-supplier"
                >
                  <Package className="h-3 w-3 mr-1" /> Supplier Stock
                </Button>
                <Button
                  type="button"
                  variant={addSourceType === "batch" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setAddSourceType("batch");
                    setSelectedSourceId("");
                    setWeightInput("");
                  }}
                  data-testid="button-source-type-batch"
                >
                  <Layers className="h-3 w-3 mr-1" /> Existing Batch
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {addSourceType === "supplier" ? (
                  <Select value={selectedSourceId} onValueChange={handleSourceIdChange}>
                    <SelectTrigger data-testid="select-supplier-source">
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSuppliers?.map((stock) => (
                        <SelectItem key={stock.supplierId!} value={stock.supplierId!.toString()}>
                          {stock.supplierName} ({formatNumber(parseFloat(stock.remainingKg))} kg @ $
                          {parseFloat(stock.costPerKg).toFixed(4)}/kg)
                        </SelectItem>
                      ))}
                      {(!availableSuppliers || availableSuppliers.length === 0) && (
                        <SelectItem value="__none__" disabled>
                          No supplier stock available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={selectedSourceId} onValueChange={handleSourceIdChange}>
                    <SelectTrigger data-testid="select-batch-source">
                      <SelectValue placeholder="Select batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableBatchesForSource?.map((b) => {
                        const remaining = parseFloat(b.totalWeightKg) - parseFloat(b.usedKg);
                        return (
                          <SelectItem key={b.id} value={b.id.toString()}>
                            {b.name || b.batchCode} ({formatNumber(remaining)} kg @ $
                            {parseFloat(b.costPerKg).toFixed(4)}/kg)
                          </SelectItem>
                        );
                      })}
                      {(!availableBatchesForSource || availableBatchesForSource.length === 0) && (
                        <SelectItem value="__none__" disabled>
                          No active batches available
                        </SelectItem>
                      )}
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
                  disabled={!selectedSourceId || !weightInput || selectedSourceId === "__none__"}
                  data-testid="button-add-source"
                >
                  <Plus className="h-4 w-4 mr-2" /> Add
                </Button>
              </div>
            </div>

            {/* Sources table */}
            {selectedSources.length > 0 && (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Cost/kg</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSources.map((sel) => (
                      <TableRow key={`${sel.type}-${sel.sourceId}`}>
                        <TableCell>
                          <Badge variant={sel.type === "batch" ? "secondary" : "outline"}>
                            {sel.type === "batch" ? "Batch" : "Supplier"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{sel.label}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="h-7 w-28 text-right font-mono text-xs ml-auto"
                            value={sel.weightKg}
                            step="0.001"
                            min="0.001"
                            onChange={(e) => handleUpdateSourceWeight(sel.type, sel.sourceId, e.target.value)}
                            data-testid={`input-weight-${sel.type}-${sel.sourceId}`}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">${sel.costPerKg.toFixed(4)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">${formatNumber(sel.totalCost)}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveSource(sel.type, sel.sourceId)}
                            data-testid={`button-remove-${sel.type}-${sel.sourceId}`}
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

            {/* Totals */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-md">
              <div>
                <p className="text-sm text-muted-foreground">Total Weight</p>
                <p className={`text-2xl font-bold font-mono ${belowUsed ? "text-destructive" : ""}`}>
                  {formatNumber(totalWeight)} kg
                </p>
                {belowUsed && (
                  <p className="text-xs text-destructive mt-1">Below already-used {formatNumber(currentUsedKg)} kg</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Cost</p>
                <p className="text-2xl font-bold font-mono">${formatNumber(totalCost)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Blended Cost/kg</p>
                <p className="text-2xl font-bold font-mono">${blendedCostPerKg.toFixed(4)}</p>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={2}
                data-testid="input-edit-batch-notes"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || selectedSources.length === 0}
                data-testid="button-save-edit"
              >
                {saveMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
