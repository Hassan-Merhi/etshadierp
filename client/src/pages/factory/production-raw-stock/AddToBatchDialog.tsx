import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/formatNumber";
import { useFactoryText } from "@/i18n/modules/factory";

interface AddToBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addToBatchSource: any;
  setAddToBatchSource: (source: any) => void;
  mixBatches: any[];
  rawStock: any[];
  addToBatchMutation: any;
  wrapAdminAction: (action: () => void, title: string) => void;
}

export function AddToBatchDialog({
  open,
  onOpenChange,
  addToBatchSource,
  setAddToBatchSource,
  mixBatches,
  rawStock,
  addToBatchMutation,
  wrapAdminAction,
}: AddToBatchDialogProps) {
  const tUi = useFactoryText();
  const [addToBatchTargetId, setAddToBatchTargetId] = useState("");
  const [addToBatchKg, setAddToBatchKg] = useState("");
  const [addToBatchCost, setAddToBatchCost] = useState("");

  const activeBatches =
    mixBatches?.filter((b) => b.status === "ACTIVE" || b.status === "OPEN" || b.status === "CARRY_FORWARD") ?? [];
  const supplierOptions = rawStock?.filter((r) => r.supplierId && parseFloat(r.freeKg || "0") > 0.001) ?? [];
  const isNoSourcePreset = addToBatchSource === null;

  const handleSupplierChange = (val: string) => {
    const found = rawStock?.find((r) => r.supplierId?.toString() === val);
    if (found && found.supplierId) {
      setAddToBatchSource({
        supplierId: found.supplierId,
        supplierName: found.supplierName,
        costPerKg: String(parseFloat(found.costPerKgUsd) || parseFloat(found.costPerKg) || 0),
        remainingKg: found.freeKg || found.remainingKg || "0",
      });
      setAddToBatchCost(String(parseFloat(found.costPerKgUsd) || parseFloat(found.costPerKg) || 0));
    }
  };

  const handleSubmit = () => {
    if (!addToBatchSource || !addToBatchTargetId) return;
    addToBatchMutation.mutate({
      batchId: parseInt(addToBatchTargetId),
      supplierId: addToBatchSource.supplierId,
      weightKg: addToBatchKg,
      costPerKg: addToBatchCost,
    });
  };

  const canSubmit =
    !!addToBatchTargetId &&
    addToBatchTargetId !== "__none__" &&
    !!addToBatchKg &&
    !!addToBatchCost &&
    !!addToBatchSource &&
    !addToBatchMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tUi("add.to.batch")}</DialogTitle>
          <DialogDescription>
            {addToBatchSource
              ? `Stock from ${addToBatchSource.supplierName} — ${formatNumber(parseFloat(addToBatchSource.remainingKg))} kg free`
              : "Choose the source supplier and target batch."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {isNoSourcePreset && (
            <div className="space-y-2">
              <Label>{tUi("source.supplier")}</Label>
              <Select value={addToBatchSource?.supplierId?.toString() || ""} onValueChange={handleSupplierChange}>
                <SelectTrigger data-testid="select-add-to-batch-supplier">
                  <SelectValue placeholder={tUi("select.supplier")} />
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map((r) => (
                    <SelectItem key={r.supplierId!} value={r.supplierId!.toString()}>
                      {r.supplierName} — {formatNumber(parseFloat(r.freeKg || "0"))} kg free
                    </SelectItem>
                  ))}
                  {supplierOptions.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No free stock available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>{tUi("target.batch")}</Label>
            <Select value={addToBatchTargetId} onValueChange={setAddToBatchTargetId}>
              <SelectTrigger data-testid="select-add-to-batch-target">
                <SelectValue placeholder={tUi("select.batch")} />
              </SelectTrigger>
              <SelectContent>
                {activeBatches.map((b) => (
                  <SelectItem key={b.id} value={b.id.toString()}>
                    {b.name || b.batchCode} — {formatNumber(parseFloat(b.remainingKg))} kg @ $
                    {parseFloat(b.costPerKg).toFixed(4)}/kg
                  </SelectItem>
                ))}
                {activeBatches.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No active batches
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{tUi("weight.to.add.kg")}</Label>
            <Input
              type="number"
              step="0.001"
              placeholder={
                addToBatchSource ? `Max ${formatNumber(parseFloat(addToBatchSource.remainingKg))} kg` : "Enter kg"
              }
              value={addToBatchKg}
              onChange={(e) => setAddToBatchKg(e.target.value)}
              data-testid="input-add-to-batch-kg"
            />
          </div>
          <div className="space-y-2">
            <Label>{tUi("cost.kg.usd")}</Label>
            <Input
              type="number"
              step="0.0001"
              value={addToBatchCost}
              onChange={(e) => setAddToBatchCost(e.target.value)}
              data-testid="input-add-to-batch-cost"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={() => wrapAdminAction(handleSubmit, "Add to Batch")}
              data-testid="button-confirm-add-to-batch"
            >
              {addToBatchMutation.isPending ? "Adding..." : "Add to Batch"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
