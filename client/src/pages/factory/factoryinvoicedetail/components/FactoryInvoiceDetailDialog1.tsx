import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { useFactoryInvoiceDetailModel } from "../useFactoryInvoiceDetailModel";

type Model = ReturnType<typeof useFactoryInvoiceDetailModel>;

export function FactoryInvoiceDetailDialog1({ model }: { model: Model }) {
  const {
    revertDialogOpen,
    setRevertDialogOpen,
    order,
    unfinalizeMutation,
  } = model;
  if (!order) return null;

  return (
    <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revert invoice to Draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will un-finalize {order.invoiceNumber || `Order #${order.id}`} and return it to Draft status. The
                      invoice number will be cleared and bales will be returned to "Reserved" state. Any recorded payments
                      must be reversed first.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-unfinalize">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => unfinalizeMutation.mutate()}
                      disabled={unfinalizeMutation.isPending}
                      data-testid="button-confirm-unfinalize"
                    >
                      {unfinalizeMutation.isPending ? "Reverting…" : "Revert to Draft"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
  );
}
