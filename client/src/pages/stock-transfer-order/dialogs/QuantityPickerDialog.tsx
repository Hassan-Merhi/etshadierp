import type { Dispatch, RefObject, SetStateAction } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/formatNumber";
import type { QuantityPickerState } from "../../stocktransferorder/types";

type QuantityPickerDialogProps = {
  editVoucherId: number | null;
  handleAddToOrder: () => void | Promise<void>;
  pickerQuantity: string;
  quantityInputRef: RefObject<HTMLInputElement | null>;
  quantityPicker: QuantityPickerState;
  setPickerQuantity: Dispatch<SetStateAction<string>>;
  setQuantityPicker: Dispatch<SetStateAction<QuantityPickerState>>;
};

export function QuantityPickerDialog({
  editVoucherId,
  handleAddToOrder,
  pickerQuantity,
  quantityInputRef,
  quantityPicker,
  setPickerQuantity,
  setQuantityPicker,
}: QuantityPickerDialogProps) {
  return (
    <Dialog open={quantityPicker.open} onOpenChange={(open) => setQuantityPicker({ ...quantityPicker, open })}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add to Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-muted rounded-md">
            <p className="font-medium">{quantityPicker.stockItem?.name}</p>
            <p className="text-sm text-muted-foreground">From: {quantityPicker.locationName}</p>
            <p className="text-sm text-muted-foreground">
              Available: <span className="font-mono">{formatNumber(quantityPicker.availableQty, 0)}</span>{" "}
              {quantityPicker.stockItem?.uom}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="picker-quantity">
              Quantity
              {editVoucherId ? (
                <span className="text-muted-foreground font-normal ml-1 text-xs">(negative = reduce, e.g. -1)</span>
              ) : (
                ""
              )}
            </Label>
            <Input
              id="picker-quantity"
              ref={quantityInputRef}
              type="number"
              step="0.001"
              value={pickerQuantity}
              onChange={(event) => setPickerQuantity(event.target.value)}
              placeholder={editVoucherId ? "e.g. -1 to reduce" : "Enter quantity"}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleAddToOrder();
              }}
              data-testid="input-picker-quantity"
            />
            {parseFloat(pickerQuantity) > quantityPicker.availableQty && parseFloat(pickerQuantity) > 0 && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Exceeds available stock
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setQuantityPicker({ ...quantityPicker, open: false })}>
            Cancel
          </Button>
          <Button
            onClick={handleAddToOrder}
            disabled={
              !pickerQuantity ||
              parseFloat(pickerQuantity) === 0 ||
              isNaN(parseFloat(pickerQuantity)) ||
              (parseFloat(pickerQuantity) > 0 && parseFloat(pickerQuantity) > quantityPicker.availableQty)
            }
            data-testid="button-confirm-add"
          >
            {parseFloat(pickerQuantity) < 0 ? "Reduce Qty" : "Add to Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
