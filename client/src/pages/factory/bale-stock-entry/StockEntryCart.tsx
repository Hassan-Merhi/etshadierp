import { Trash2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/formatNumber";
import { BaleLogoPickerPopover } from "./BaleLogoPickerPopover";

interface CartItem {
  productId: number;
  product: any;
  qty: number;
  weightPerBaleKg: number;
  finalizedBy: number | null;
  overrideLogoId: number | null;
}

export function StockEntryCart({
  cart,
  workers,
  workerCategoryFilter,
  onUpdateQty,
  onSetQty,
  onUpdateWeight,
  onRemoveItem,
  onAssignWorker,
  onSetLogoOverride,
  allCustomers,
  logoPickerOpen,
  onLogoPickerOpenChange,
  filteredWorkers,
}: {
  cart: CartItem[];
  workers: any[];
  workerCategoryFilter: string;
  onUpdateQty: (productId: number, delta: number) => void;
  onSetQty: (productId: number, qty: number) => void;
  onUpdateWeight: (productId: number, weight: number) => void;
  onRemoveItem: (productId: number) => void;
  onAssignWorker: (productId: number, workerId: number | null) => void;
  onSetLogoOverride: (productId: number, logoId: number | null) => void;
  allCustomers: any[];
  logoPickerOpen: number | null;
  onLogoPickerOpenChange: (productId: number | null) => void;
  filteredWorkers: any[];
}) {
  return (
    <div className="rounded-xl border bg-card/50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-[40%]">Product</TableHead>
            <TableHead className="w-[15%] text-center">Bale Qty</TableHead>
            <TableHead className="w-[15%] text-right">Kg / Bale</TableHead>
            <TableHead className="w-[20%]">Finalized By</TableHead>
            <TableHead className="w-[10%] text-right"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cart.map((item) => (
            <TableRow
              key={item.productId}
              className="hover:bg-muted/30 transition-colors"
              data-testid={`row-cart-${item.productId}`}
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-primary">{item.product?.grade || "STK"}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate" data-testid={`text-cart-name-${item.productId}`}>
                      {item.product?.name}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded font-mono">
                        {item.product?.articleCode || item.product?.code}
                      </code>
                      {item.product?.categoryName && (
                        <Badge variant="outline" className="text-[9px] py-0 h-3.5 px-1 font-medium">
                          {item.product.categoryName}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    onClick={() => onUpdateQty(item.productId, -1)}
                    data-testid={`button-qty-minus-${item.productId}`}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Input
                    type="number"
                    value={item.qty}
                    onChange={(e) => onSetQty(item.productId, parseInt(e.target.value) || 0)}
                    className="h-7 w-12 text-center p-0 font-bold"
                    data-testid={`input-qty-${item.productId}`}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    onClick={() => onUpdateQty(item.productId, 1)}
                    data-testid={`button-qty-plus-${item.productId}`}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1.5">
                  <Input
                    type="number"
                    value={item.weightPerBaleKg}
                    onChange={(e) => onUpdateWeight(item.productId, parseFloat(e.target.value) || 0)}
                    className="h-7 w-16 text-right font-medium"
                    step="0.1"
                    data-testid={`input-weight-${item.productId}`}
                  />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">kg</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Select
                    value={item.finalizedBy ? String(item.finalizedBy) : "none"}
                    onValueChange={(val) => onAssignWorker(item.productId, val === "none" ? null : parseInt(val))}
                  >
                    <SelectTrigger className="h-7 text-xs py-0" data-testid={`select-worker-${item.productId}`}>
                      <SelectValue placeholder="Select worker..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {filteredWorkers.map((w: any) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.fullName || w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <BaleLogoPickerPopover
                    productId={item.productId}
                    overrideLogoId={item.overrideLogoId}
                    allCustomers={allCustomers}
                    onSelect={(logoId) => onSetLogoOverride(item.productId, logoId)}
                    open={logoPickerOpen === item.productId}
                    onOpenChange={(open) => onLogoPickerOpenChange(open ? item.productId : null)}
                  />
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => onRemoveItem(item.productId)}
                  data-testid={`button-remove-item-${item.productId}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {cart.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                No items added yet. Scan a code or type to search.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
