import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatNumber } from "@/lib/formatNumber";
import { Plus, Trash2 } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

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

interface ContainerSelection {
  containerId: number;
  containerNumber: string;
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
  const [selectedContainers, setSelectedContainers] = useState<ContainerSelection[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string>("");
  const [weightInput, setWeightInput] = useState<string>("");
  const [batchName, setBatchName] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rawStock } = useQuery<RawStockRow[]>({
    queryKey: ["/api/production-raw-stock"],
    enabled: open,
  });

  const availableRawStock = rawStock?.filter(
    (r) =>
      parseFloat(r.remainingKg) > 0 &&
      !selectedContainers.some((s) => s.containerId === r.containerId)
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const sources = selectedContainers.map((s) => ({
        containerId: s.containerId,
        weightKg: s.weightKg.toString(),
        costPerKg: s.costPerKg.toString(),
        totalCost: s.totalCost.toString(),
      }));

      const response = await fetch("/api/mix-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: batchName || undefined,
          notes: notes || undefined,
          sources,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create batch");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-raw-stock"] });
      toast({ title: "Success", description: "Mix batch created successfully" });
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleContainerSelect = (containerId: string) => {
    setSelectedContainerId(containerId);
    const stock = rawStock?.find((r) => r.containerId.toString() === containerId);
    if (stock) {
      setWeightInput(stock.remainingKg);
    }
  };

  const handleAddContainer = () => {
    if (!selectedContainerId || !weightInput) {
      toast({ title: "Missing information", description: "Please select a container and enter weight", variant: "destructive" });
      return;
    }

    const stock = rawStock?.find((r) => r.containerId.toString() === selectedContainerId);
    if (!stock) return;

    const weight = parseFloat(weightInput);
    const available = parseFloat(stock.remainingKg);
    const costPerKg = parseFloat(stock.costPerKg);

    if (isNaN(weight) || weight <= 0) {
      toast({ title: "Invalid weight", description: "Please enter a valid weight greater than 0", variant: "destructive" });
      return;
    }

    if (weight > available + 0.001) {
      toast({ title: "Exceeds available", description: `Only ${formatNumber(available)} kg available from this container`, variant: "destructive" });
      return;
    }

    const newSelection: ContainerSelection = {
      containerId: stock.containerId,
      containerNumber: stock.containerNumber,
      weightKg: weight,
      costPerKg,
      totalCost: weight * costPerKg,
      availableKg: available,
    };

    const updated = [...selectedContainers, newSelection];
    setSelectedContainers(updated);
    setSelectedContainerId("");
    setWeightInput("");
  };

  const handleRemoveContainer = (containerId: number) => {
    setSelectedContainers((prev) => prev.filter((s) => s.containerId !== containerId));
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedContainers([]);
    setSelectedContainerId("");
    setWeightInput("");
    setBatchName("");
    setNotes("");
  };

  const totalWeight = selectedContainers.reduce((sum, s) => sum + s.weightKg, 0);
  const totalCost = selectedContainers.reduce((sum, s) => sum + s.totalCost, 0);
  const blendedCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Mix Batch</DialogTitle>
          <DialogDescription>
            Select containers from production raw stock and specify how many kg to use from each.
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
            <h3 className="font-medium">Add Containers from Raw Stock</h3>
            <div className="grid grid-cols-3 gap-2">
              <Select value={selectedContainerId} onValueChange={handleContainerSelect}>
                <SelectTrigger data-testid="select-raw-stock-container">
                  <SelectValue placeholder="Select container" />
                </SelectTrigger>
                <SelectContent>
                  {availableRawStock?.map((stock) => (
                    <SelectItem key={stock.containerId} value={stock.containerId.toString()}>
                      {stock.containerNumber} ({formatNumber(parseFloat(stock.remainingKg))} kg avail @ ${parseFloat(stock.costPerKg).toFixed(4)}/kg)
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
                data-testid="input-container-weight"
              />

              <Button
                type="button"
                onClick={handleAddContainer}
                disabled={!selectedContainerId || !weightInput}
                data-testid="button-add-container"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          {selectedContainers.length > 0 && (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Cost/kg</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedContainers.map((selection) => (
                    <TableRow key={selection.containerId}>
                      <TableCell className="font-medium">{selection.containerNumber}</TableCell>
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
                          onClick={() => handleRemoveContainer(selection.containerId)}
                          data-testid={`button-remove-${selection.containerId}`}
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
              disabled={createMutation.isPending || selectedContainers.length === 0}
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
