/**
 * D4 — extracted from FactoryProformas.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function D4({
  editLineMutation,
  editLineValues,
  editingLine,
  handleEditLine,
  setEditLineValues,
  setEditingLine,
}: {
  editLineMutation: any;
  editLineValues: any;
  editingLine: any;
  handleEditLine: any;
  setEditLineValues: any;
  setEditingLine: any;
}) {
  return (
    <Dialog open={!!editingLine} onOpenChange={(open) => !open && setEditingLine(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Price Line</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted p-3 rounded-md mb-2">
            <p className="text-sm font-semibold">{editingLine?.articleCode}</p>
            <p className="text-xs text-muted-foreground">{editingLine?.productName}</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Product Name</label>
            <Input
              value={editLineValues.productName}
              onChange={(e) => setEditLineValues({ ...editLineValues, productName: e.target.value })}
              data-testid="input-edit-line-product-name"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Quantity</label>
              <Input
                type="number"
                value={editLineValues.quantity}
                onChange={(e) => setEditLineValues({ ...editLineValues, quantity: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                }}
                data-testid="input-edit-line-quantity"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Price per Bale</label>
              <Input
                type="number"
                step="0.01"
                value={editLineValues.pricePerBale}
                onChange={(e) => setEditLineValues({ ...editLineValues, pricePerBale: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                }}
                data-testid="input-edit-line-price"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">KG / Bale</label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 97"
                value={editLineValues.weightPerBaleKg}
                onChange={(e) => setEditLineValues({ ...editLineValues, weightPerBaleKg: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                }}
                data-testid="input-edit-line-weight"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setEditingLine(null)} data-testid="button-cancel-edit-line">
              Cancel
            </Button>
            <Button
              onClick={handleEditLine}
              disabled={!editLineValues.pricePerBale || !editLineValues.quantity || editLineMutation.isPending}
              data-testid="button-confirm-edit-line"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
