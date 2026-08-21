import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { useFactoryInvoiceDetailModel } from "../useFactoryInvoiceDetailModel";

type Model = ReturnType<typeof useFactoryInvoiceDetailModel>;

export function FactoryInvoiceDetailDialog2({ model }: { model: Model }) {
  const {
    deleteDialogOpen,
    setDeleteDialogOpen,
    order,
    deleteMutation,
  } = model;
  if (!order) return null;

  return (
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Invoice</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete order {order.invoiceNumber || `#${order.id}`} for {order.customerName}. Any
                      bales assigned to this order will be returned to stock. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteMutation.mutate(order.id)} data-testid="button-confirm-delete">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
  );
}
