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
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Plus, PlusCircle, Gavel } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { AccountCombobox } from "./ProductionRawStockHelpers";
import { useFactoryText } from "@/i18n/modules/factory";

interface StockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjustingRow: any;
  isNewMaterial: boolean;
  factorySuppliers: any[];
  createAdjustmentMutation: any;
  updateCostMutation: any;
  wrapAdminAction: (action: () => void, title: string) => void;
}

export function StockAdjustmentDialog({
  open,
  onOpenChange,
  adjustingRow,
  isNewMaterial,
  factorySuppliers,
  createAdjustmentMutation,
  updateCostMutation,
  wrapAdminAction,
}: StockAdjustmentDialogProps) {
  const tUi = useFactoryText();
  const [adjType, setAdjType] = useState<"ADD" | "REMOVE" | "COST">("ADD");
  const [adjKg, setAdjKg] = useState("");
  const [adjCostPerKg, setAdjCostPerKg] = useState("");
  const [adjCurrency, setAdjCurrency] = useState("USD");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjReference, setAdjReference] = useState("");
  const [adjDate, setAdjDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [adjMaterialLabel, setAdjMaterialLabel] = useState("");
  const [adjSupplierId, setAdjSupplierId] = useState<string>("");

  const handleSubmit = () => {
    if (adjType === "COST") {
      if (!adjCostPerKg || parseFloat(adjCostPerKg) <= 0) return;
      updateCostMutation.mutate({
        supplierId: adjustingRow.supplierId,
        newCostPerKg: adjCostPerKg,
      });
    } else {
      createAdjustmentMutation.mutate({
        type: adjType === "ADD" ? "ADD" : "REMOVE",
        kg: adjKg,
        costPerKg: adjCostPerKg || "0",
        currencyCode: adjCurrency,
        supplierId: isNewMaterial ? (adjSupplierId ? parseInt(adjSupplierId) : null) : adjustingRow?.supplierId,
        materialLabel: isNewMaterial ? adjMaterialLabel : adjustingRow?.supplierName,
        notes: adjNotes,
        reference: adjReference,
        date: adjDate,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isNewMaterial ? <PlusCircle className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            {isNewMaterial ? "New Manual Material" : `Adjust Stock: ${adjustingRow?.supplierName}`}
          </DialogTitle>
          <DialogDescription>
            {isNewMaterial
              ? "Add a new material source manually."
              : "Manually add or remove stock, or update the cost per kg."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!isNewMaterial && (
            <div className="space-y-1">
              <Label>{tUi("adjustment.type")}</Label>
              <Select value={adjType} onValueChange={(v: any) => setAdjType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADD">{tUi("add.stock.2")}</SelectItem>
                  <SelectItem value="REMOVE">{tUi("remove.stock")}</SelectItem>
                  <SelectItem value="COST">{tUi("update.cost.per.kg")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {isNewMaterial && (
            <>
              <div className="space-y-1">
                <Label>{tUi("material.label.name")}</Label>
                <Input
                  value={adjMaterialLabel}
                  onChange={(e) => setAdjMaterialLabel(e.target.value)}
                  placeholder="e.g. Local Waste, Floor Sweep..."
                />
              </div>
              <div className="space-y-1">
                <Label>{tUi("supplier.optional")}</Label>
                <Select value={adjSupplierId} onValueChange={setAdjSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder={tUi("select.supplier")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{tUi("none.manual")}</SelectItem>
                    {factorySuppliers?.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label>{tUi("date")}</Label>
            <Input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
          </div>

          {adjType !== "COST" && (
            <div className="space-y-1">
              <Label>{tUi("quantity.kg")}</Label>
              <Input
                type="number"
                step="0.001"
                value={adjKg}
                onChange={(e) => setAdjKg(e.target.value)}
                placeholder="0.000"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>{adjType === "COST" ? "New Cost per KG ($)" : "Cost per KG ($)"}</Label>
            <Input
              type="number"
              step="0.0001"
              value={adjCostPerKg}
              onChange={(e) => setAdjCostPerKg(e.target.value)}
              placeholder="0.0000"
            />
          </div>

          {adjType !== "COST" && (
            <>
              <div className="space-y-1">
                <Label>{tUi("reference.optional")}</Label>
                <Input
                  value={adjReference}
                  onChange={(e) => setAdjReference(e.target.value)}
                  placeholder="e.g. Inv #123"
                />
              </div>
              <div className="space-y-1">
                <Label>{tUi("notes.optional")}</Label>
                <Textarea
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  placeholder={tUi("adjustment.reason")}
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(handleSubmit, isNewMaterial ? "Add Material" : "Adjust Stock")}
              disabled={createAdjustmentMutation.isPending || updateCostMutation.isPending}
            >
              {createAdjustmentMutation.isPending || updateCostMutation.isPending ? "Saving..." : "Save Adjustment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
