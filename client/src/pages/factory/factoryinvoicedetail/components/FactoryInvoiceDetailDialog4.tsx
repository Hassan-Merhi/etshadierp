import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { useFactoryInvoiceDetailModel } from "../useFactoryInvoiceDetailModel";

type Model = ReturnType<typeof useFactoryInvoiceDetailModel>;

export function FactoryInvoiceDetailDialog4({ model }: { model: Model }) {
  const {
    removeBaleState,
    setRemoveBaleState,
    removeBaleMutation,
  } = model;
  return (
    <AlertDialog
              open={removeBaleState !== null}
              onOpenChange={(open) => {
                if (!open) setRemoveBaleState(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove bale from invoice?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bale <span className="font-mono font-medium">{removeBaleState?.reference}</span> will be removed from this
                    invoice and returned to stock. The invoice totals will update automatically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-remove-bale">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => removeBaleState && removeBaleMutation.mutate(removeBaleState.orderBaleId)}
                    disabled={removeBaleMutation.isPending}
                    data-testid="button-confirm-remove-bale"
                    className="bg-destructive text-destructive-foreground"
                  >
                    {removeBaleMutation.isPending ? "Removing…" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
  );
}
