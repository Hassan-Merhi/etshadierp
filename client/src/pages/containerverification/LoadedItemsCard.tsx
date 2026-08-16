/**
 * Loaded-items editor on the container verification page.
 *
 * Split out of ContainerVerification.tsx unchanged: the inline add row, the
 * per-row edit mode, the "Load from POs" button that only appears while the
 * list is empty, and the Excel import trigger.
 */
import { Pencil, Plus, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContainerVerificationModel } from "./useContainerVerificationModel";

type ItemDraft = { barcode: string; itemName: string; qty: string; weightPerBale: string; pricePerBale: string };

/** The five editable cells shared by the add row and the per-row edit mode. */
function DraftCells({
  draft,
  onChange,
  testIdPrefix,
}: {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  testIdPrefix?: string;
}) {
  const testId = (suffix: string) => (testIdPrefix ? `${testIdPrefix}-${suffix}` : undefined);
  return (
    <>
      <TableCell>
        <Input
          value={draft.barcode}
          onChange={(e) => onChange({ ...draft, barcode: e.target.value })}
          placeholder={testIdPrefix ? "Barcode" : undefined}
          className="h-8 text-xs"
          data-testid={testId("barcode")}
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.itemName}
          onChange={(e) => onChange({ ...draft, itemName: e.target.value })}
          placeholder={testIdPrefix ? "Name" : undefined}
          className="h-8 text-xs"
          data-testid={testId("name")}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={draft.qty}
          onChange={(e) => onChange({ ...draft, qty: e.target.value })}
          className="h-8 text-xs w-14 text-right"
          data-testid={testId("qty")}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.001"
          value={draft.weightPerBale}
          onChange={(e) => onChange({ ...draft, weightPerBale: e.target.value })}
          className="h-8 text-xs w-16 text-right"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          value={draft.pricePerBale}
          onChange={(e) => onChange({ ...draft, pricePerBale: e.target.value })}
          className="h-8 text-xs w-16 text-right"
        />
      </TableCell>
    </>
  );
}

function SaveCancelCell({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <TableCell>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={onSave}>
          <Save className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </TableCell>
  );
}

export function LoadedItemsCard({ model }: { model: ContainerVerificationModel }) {
  const { loadedItems, addingItem, editingItemId } = model;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Loaded Items ({loadedItems.length})</CardTitle>
        <div className="flex items-center gap-2">
          {loadedItems.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={model.runAutoPopulate}
              disabled={model.autoPopulateMutation.isPending}
              data-testid="button-load-from-pos"
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${model.autoPopulateMutation.isPending ? "animate-spin" : ""}`} />
              Load from POs
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => model.fileInputRef.current?.click()}
            data-testid="button-import-loaded"
          >
            <Upload className="mr-1 h-3 w-3" />
            Import
          </Button>
          <Button size="sm" onClick={() => model.setAddingItem(true)} data-testid="button-add-loaded">
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Barcode</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Wt/Bale</TableHead>
                <TableHead className="text-right">Price/Bale</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {addingItem && (
                <TableRow>
                  <DraftCells draft={model.newItem} onChange={model.setNewItem} testIdPrefix="input-new-loaded" />
                  <SaveCancelCell
                    onSave={() => model.addItemMutation.mutate(model.newItem)}
                    onCancel={() => model.setAddingItem(false)}
                  />
                </TableRow>
              )}
              {loadedItems.map((item) => (
                <TableRow key={item.id}>
                  {editingItemId === item.id ? (
                    <>
                      <DraftCells draft={model.editItemData} onChange={model.setEditItemData} />
                      <SaveCancelCell
                        onSave={() => model.updateItemMutation.mutate({ id: item.id, data: model.editItemData })}
                        onCancel={() => model.setEditingItemId(null)}
                      />
                    </>
                  ) : (
                    <>
                      <TableCell className="font-mono text-xs">{item.barcode}</TableCell>
                      <TableCell className="text-xs">{item.itemName || "-"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{item.qty}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {item.weightPerBale ? parseFloat(item.weightPerBale).toFixed(3) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {item.pricePerBale ? parseFloat(item.pricePerBale).toFixed(2) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => model.startEdit(item)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => model.deleteItemMutation.mutate(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {loadedItems.length === 0 && !addingItem && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">
                    No loaded items. Add manually or import from Excel.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
