/**
 * PrintBarcodesDialog — extracted from FactoryLocationInventory.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Printer } from "lucide-react";

export function PrintBarcodesDialog({
  handleDoPrint,
  reprintBales,
  reprintDialogOpen,
  reprintLoading,
  reprintProduct,
  selectedLocation,
  setReprintBales,
  setReprintDialogOpen,
  setReprintProduct,
}: {
  handleDoPrint: unknown;
  reprintBales: unknown;
  reprintDialogOpen: unknown;
  reprintLoading: unknown;
  reprintProduct: unknown;
  selectedLocation: unknown;
  setReprintBales: unknown;
  setReprintDialogOpen: unknown;
  setReprintProduct: unknown;
}) {
  return (
    <Dialog
      open={reprintDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          setReprintDialogOpen(false);
          setReprintBales([]);
          setReprintProduct(null);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle data-testid="text-reprint-dialog-title">
            Print Barcodes{reprintProduct ? ` — ${reprintProduct.productName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {reprintLoading
              ? "Loading bales…"
              : `${reprintBales.length} bale(s) in stock at ${selectedLocation.name}. Click Print to generate labels for all of them.`}
          </DialogDescription>
        </DialogHeader>
        {reprintLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : reprintBales.length > 0 ? (
          <div className="overflow-auto max-h-[260px] rounded-md border">
            <table className="text-sm w-full">
              <thead className="bg-muted/50">
                <tr className="h-9">
                  <th className="text-left px-3 font-medium">Reference No.</th>
                  <th className="text-right px-3 font-medium">KG</th>
                  <th className="text-right px-3 font-medium">Pcs</th>
                </tr>
              </thead>
              <tbody>
                {reprintBales.map((row: unknown) => (
                  <tr key={row.bale.id} className="border-t h-9" data-testid={`row-reprint-bale-${row.bale.id}`}>
                    <td className="px-3 font-mono text-xs text-muted-foreground">
                      {row.bale.referenceNumber || row.bale.baleCode}
                    </td>
                    <td className="px-3 text-right font-mono text-xs">{parseFloat(row.bale.weightKg).toFixed(1)}</td>
                    <td className="px-3 text-right font-mono text-xs">{row.bale.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            No IN_STOCK bales found for this product at this location.
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setReprintDialogOpen(false);
              setReprintBales([]);
              setReprintProduct(null);
            }}
            data-testid="button-reprint-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleDoPrint}
            disabled={reprintLoading || reprintBales.length === 0}
            data-testid="button-reprint-confirm"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print {reprintBales.length > 0 ? `${reprintBales.length} Label(s)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
