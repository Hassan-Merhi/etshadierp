/**
 * L3 — extracted from FactoryLocationInventory.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function L3({ overloadWarning, setOverloadWarning }: { overloadWarning: any; setOverloadWarning: any }) {
  return (
    <Dialog
      open={overloadWarning.open}
      onOpenChange={(open) => {
        if (!open) setOverloadWarning({ open: false, items: [], pendingFn: null });
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle data-testid="text-overload-warning-title">Stock Overload Warning</DialogTitle>
          <DialogDescription>
            The following items exceed available stock. You can still proceed, but the proforma will contain more bales
            than currently in stock.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto max-h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overloadWarning.items.map((item: any) => (
                <TableRow key={item.articleCode} data-testid={`row-overload-${item.articleCode}`}>
                  <TableCell className="font-mono text-xs">{item.articleCode}</TableCell>
                  <TableCell className="text-sm">{item.productName}</TableCell>
                  <TableCell className="text-right font-mono font-semibold text-destructive">
                    {item.requested}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{item.available}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => setOverloadWarning({ open: false, items: [], pendingFn: null })}
            data-testid="button-overload-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const fn = overloadWarning.pendingFn;
              setOverloadWarning({ open: false, items: [], pendingFn: null });
              fn?.();
            }}
            data-testid="button-overload-proceed"
          >
            Proceed Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
