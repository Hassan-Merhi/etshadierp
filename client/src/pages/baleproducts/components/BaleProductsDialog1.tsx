import { Trash2, AlertTriangle, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { useBaleProductsModel } from "../useBaleProductsModel";

type Model = ReturnType<typeof useBaleProductsModel>;
export function BaleProductsDialog1({ model }: { model: Model }) {
  const {
    designColors,
    editingProduct,
    setEditingProduct,
    editForm,
    setEditForm,
    setPendingDelete,
    hideAvgRate,
    hideSellingPriceBP,
    categories,
    editProductMutation,
    deleteProductMutation,
    handleEditSubmit,
  } = model;
  return (
    <Dialog
      open={!!editingProduct}
      onOpenChange={(open) => {
        if (!open) setEditingProduct(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
          <DialogDescription>Update product details. Changes will cascade to related bales.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name *</Label>
            <Input
              id="edit-name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              required
              data-testid="input-edit-product-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-articleCode">Article Code</Label>
            <Input
              id="edit-articleCode"
              value={editForm.articleCode}
              onChange={(e) => setEditForm({ ...editForm, articleCode: e.target.value })}
              className="font-mono"
              data-testid="input-edit-product-articleCode"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-weight">Weight per Bale (KG)</Label>
            <Input
              id="edit-weight"
              type="number"
              value={editForm.weightPerBaleKg}
              onChange={(e) => setEditForm({ ...editForm, weightPerBaleKg: e.target.value })}
              data-testid="input-edit-product-weight"
            />
          </div>
          {(!hideAvgRate || !hideSellingPriceBP) && (
            <div className="grid grid-cols-2 gap-3">
              {!hideAvgRate && (
                <div className="space-y-2">
                  <Label htmlFor="edit-productionPrice">Cost Price</Label>
                  <Input
                    id="edit-productionPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={editForm.productionPrice}
                    onChange={(e) => setEditForm({ ...editForm, productionPrice: e.target.value })}
                    data-testid="input-edit-product-production-price"
                  />
                </div>
              )}
              {!hideSellingPriceBP && (
                <div className="space-y-2">
                  <Label htmlFor="edit-sellingPrice">Sell Price</Label>
                  <Input
                    id="edit-sellingPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={editForm.sellingPrice}
                    onChange={(e) => setEditForm({ ...editForm, sellingPrice: e.target.value })}
                    data-testid="input-edit-product-selling-price"
                  />
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={editForm.categoryId} onValueChange={(val) => setEditForm({ ...editForm, categoryId: val })}>
              <SelectTrigger data-testid="select-edit-product-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories?.map((cat) => (
                  <SelectItem key={cat.id} value={String(cat.id)}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              data-testid="input-edit-product-description"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" />
              Label Design Color
            </Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="button-label-color-none"
                onClick={() => setEditForm({ ...editForm, labelDesignColor: "" })}
                className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${!editForm.labelDesignColor ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover-elevate"}`}
              >
                No Design
              </button>
              {designColors.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`button-label-color-${opt.value}`}
                  onClick={() => setEditForm({ ...editForm, labelDesignColor: opt.value })}
                  className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${editForm.labelDesignColor === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover-elevate"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {editForm.labelDesignColor && (
              <p className="text-xs text-muted-foreground">
                Labels for this product will print with the{" "}
                <span className="font-medium">
                  {designColors.find((o) => o.value === editForm.labelDesignColor)?.label}
                </span>{" "}
                design automatically.
              </p>
            )}
            {!editForm.labelDesignColor && (
              <p className="text-xs text-muted-foreground">Labels will print with no design banner.</p>
            )}
          </div>
          <div className="flex items-start gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Changes to name, weight, and article code will also update all existing bales using this product.
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                setPendingDelete(() => () => deleteProductMutation.mutate(editingProduct!.id));
              }}
              disabled={deleteProductMutation.isPending}
              data-testid="button-delete-edit-product"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {deleteProductMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditingProduct(null)}
                data-testid="button-cancel-edit-product"
              >
                Cancel
              </Button>
              <Button
                onClick={handleEditSubmit}
                disabled={!editForm.name.trim() || editProductMutation.isPending}
                data-testid="button-save-edit-product"
              >
                {editProductMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
