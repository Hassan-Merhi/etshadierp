/**
 * The loaded-items editor of the container verification page.
 *
 * The add row and the inline edit row are drafts: they exist only while a row
 * is being typed into, and nothing outside this card ever reads them. So the
 * card keeps that state and the page keeps the data, and the two meet at four
 * callbacks. The write callbacks are awaited rather than fired and forgotten,
 * because a draft may only be cleared once the server has actually taken it —
 * on failure the row stays open with what was typed still in it.
 *
 * Extracted from ContainerVerification.tsx during the god-file split.
 */
import { useState } from "react";
import { Pencil, Plus, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { LoadedItem, LoadedItemDraft } from "./types";

const EMPTY_DRAFT: LoadedItemDraft = {
  barcode: "",
  itemName: "",
  qty: "0",
  weightPerBale: "0",
  pricePerBale: "0",
};

function draftOf(item: LoadedItem): LoadedItemDraft {
  return {
    barcode: item.barcode,
    itemName: item.itemName || "",
    qty: String(item.qty),
    weightPerBale: item.weightPerBale || "0",
    pricePerBale: item.pricePerBale || "0",
  };
}

export function LoadedItemsCard({
  items,
  autoPopulatePending,
  onAutoPopulate,
  onImportClick,
  onAdd,
  onUpdate,
  onDelete,
}: {
  items: LoadedItem[];
  autoPopulatePending: boolean;
  onAutoPopulate: () => void;
  onImportClick: () => void;
  onAdd: (draft: LoadedItemDraft) => Promise<unknown>;
  onUpdate: (id: number, draft: LoadedItemDraft) => Promise<unknown>;
  onDelete: (id: number) => void;
}) {
  const [addingItem, setAddingItem] = useState(false);
  const [newItem, setNewItem] = useState<LoadedItemDraft>(EMPTY_DRAFT);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editItemData, setEditItemData] = useState<LoadedItemDraft>(EMPTY_DRAFT);

  // The page's mutations already report their own failures; the drafts simply
  // stay put so nothing typed is lost.
  const submitNew = async () => {
    try {
      await onAdd(newItem);
      setAddingItem(false);
      setNewItem(EMPTY_DRAFT);
    } catch {
      /* handled by the caller */
    }
  };

  const submitEdit = async (id: number) => {
    try {
      await onUpdate(id, editItemData);
      setEditingItemId(null);
    } catch {
      /* handled by the caller */
    }
  };

  const startEdit = (item: LoadedItem) => {
    setEditingItemId(item.id);
    setEditItemData(draftOf(item));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Loaded Items ({items.length})</CardTitle>
        <div className="flex items-center gap-2">
          {items.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAutoPopulate}
              disabled={autoPopulatePending}
              data-testid="button-load-from-pos"
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${autoPopulatePending ? "animate-spin" : ""}`} />
              Load from POs
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onImportClick} data-testid="button-import-loaded">
            <Upload className="mr-1 h-3 w-3" />
            Import
          </Button>
          <Button size="sm" onClick={() => setAddingItem(true)} data-testid="button-add-loaded">
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
                  <TableCell>
                    <Input
                      value={newItem.barcode}
                      onChange={(e) => setNewItem({ ...newItem, barcode: e.target.value })}
                      placeholder="Barcode"
                      className="h-8 text-xs"
                      data-testid="input-new-loaded-barcode"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={newItem.itemName}
                      onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                      placeholder="Name"
                      className="h-8 text-xs"
                      data-testid="input-new-loaded-name"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={newItem.qty}
                      onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })}
                      className="h-8 text-xs w-14 text-right"
                      data-testid="input-new-loaded-qty"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.001"
                      value={newItem.weightPerBale}
                      onChange={(e) => setNewItem({ ...newItem, weightPerBale: e.target.value })}
                      className="h-8 text-xs w-16 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={newItem.pricePerBale}
                      onChange={(e) => setNewItem({ ...newItem, pricePerBale: e.target.value })}
                      className="h-8 text-xs w-16 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={submitNew}>
                        <Save className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setAddingItem(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id}>
                  {editingItemId === item.id ? (
                    <>
                      <TableCell>
                        <Input
                          value={editItemData.barcode}
                          onChange={(e) => setEditItemData({ ...editItemData, barcode: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={editItemData.itemName}
                          onChange={(e) => setEditItemData({ ...editItemData, itemName: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={editItemData.qty}
                          onChange={(e) => setEditItemData({ ...editItemData, qty: e.target.value })}
                          className="h-8 text-xs w-14 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.001"
                          value={editItemData.weightPerBale}
                          onChange={(e) => setEditItemData({ ...editItemData, weightPerBale: e.target.value })}
                          className="h-8 text-xs w-16 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={editItemData.pricePerBale}
                          onChange={(e) => setEditItemData({ ...editItemData, pricePerBale: e.target.value })}
                          className="h-8 text-xs w-16 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => submitEdit(item.id)}>
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditingItemId(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
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
                          <Button size="icon" variant="ghost" onClick={() => startEdit(item)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => onDelete(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {items.length === 0 && !addingItem && (
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
