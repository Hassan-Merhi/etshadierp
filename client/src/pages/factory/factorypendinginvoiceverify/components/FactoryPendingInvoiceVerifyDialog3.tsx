import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import type { useFactoryPendingInvoiceVerifyModel } from "../useFactoryPendingInvoiceVerifyModel";

type Model = ReturnType<typeof useFactoryPendingInvoiceVerifyModel>;

export function FactoryPendingInvoiceVerifyDialog3({ model }: { model: Model }) {
  const {
    setShowFinalizePreview,
    setFinalizePreview,
    showPriceWarning,
    setShowPriceWarning,
    unpricedItems,
    pendingFinalizeData,
  } = model;
  return (
    <Dialog open={showPriceWarning} onOpenChange={setShowPriceWarning}>
              <DialogContent className="max-w-md flex flex-col max-h-[80vh]">
                <DialogHeader className="shrink-0">
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    {unpricedItems.length} {unpricedItems.length === 1 ? "Item" : "Items"} with No Price
                  </DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground shrink-0">
                  These items have no price — the invoice will be $0 for them. Go back to fix prices, or proceed anyway.
                </p>
                <div className="overflow-y-auto rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 divide-y divide-amber-200 dark:divide-amber-800 min-h-0">
                  {unpricedItems.map((name, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-200">{name}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-2 pt-1 shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => setShowPriceWarning(false)}
                    data-testid="button-price-warning-back"
                  >
                    Go Back &amp; Fix Prices
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setShowPriceWarning(false);
                      setFinalizePreview(pendingFinalizeData);
                      setShowFinalizePreview(true);
                    }}
                    data-testid="button-price-warning-proceed"
                  >
                    Proceed Anyway
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
  );
}
