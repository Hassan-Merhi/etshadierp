import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COLUMN_OPTIONS, type ColumnKey } from "./customerLoadingTypes";

interface CustomerLoadingColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visibleColumns: ReadonlySet<ColumnKey>;
  onToggleColumn: (key: ColumnKey, checked: boolean) => void;
  onShowAll: () => void;
}

export function CustomerLoadingColumnsDialog({
  open,
  onOpenChange,
  visibleColumns,
  onToggleColumn,
  onShowAll,
}: CustomerLoadingColumnsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Visible Columns</DialogTitle>
          <DialogDescription>Turn columns on or off for the Customer Loading table.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2 sm:grid-cols-2">
          {COLUMN_OPTIONS.map((column) => (
            <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={visibleColumns.has(column.key)}
                onCheckedChange={(checked) => onToggleColumn(column.key, Boolean(checked))}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onShowAll}>
            Show All
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
