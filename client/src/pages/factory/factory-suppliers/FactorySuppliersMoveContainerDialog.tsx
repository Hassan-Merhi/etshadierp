import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { useFactorySuppliersModel } from "./useFactorySuppliersModel";

type SuppliersModel = ReturnType<typeof useFactorySuppliersModel>;

export function FactorySuppliersMoveContainerDialog({ model }: { model: SuppliersModel }) {
  return (
    <Dialog
      open={model.moveContainerDialog.open}
      onOpenChange={(open) => {
        if (!open) {
          model.setMoveContainerDialog((previous) => ({ ...previous, open: false }));
          model.setMoveTargetSupplierId("");
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Move Container</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground mb-2">
          Moving <span className="font-semibold text-foreground">{model.moveContainerDialog.containerRef}</span> to a new supplier shifts the outstanding balance immediately. Payments already recorded under the current supplier are not moved automatically.
        </p>
        <Select value={model.moveTargetSupplierId} onValueChange={model.setMoveTargetSupplierId}>
          <SelectTrigger><SelectValue placeholder="Select target supplier…" /></SelectTrigger>
          <SelectContent>
            {model.activeSuppliers.filter((supplier) => supplier.id !== model.statementSupplierId).map((supplier) => <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => { model.setMoveContainerDialog((previous) => ({ ...previous, open: false })); model.setMoveTargetSupplierId(""); }}>Cancel</Button>
          <Button
            disabled={!model.moveTargetSupplierId || model.moveContainerMutation.isPending}
            onClick={() => {
              if (model.moveContainerDialog.containerId && model.moveTargetSupplierId) {
                model.moveContainerMutation.mutate({ containerId: model.moveContainerDialog.containerId, targetSupplierId: parseInt(model.moveTargetSupplierId) });
              }
            }}
          >
            {model.moveContainerMutation.isPending ? "Moving…" : "Move Container"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
