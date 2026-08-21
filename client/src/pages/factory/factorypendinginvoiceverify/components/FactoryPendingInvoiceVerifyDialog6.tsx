import { Wrench } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { useFactoryPendingInvoiceVerifyModel } from "../useFactoryPendingInvoiceVerifyModel";

type Model = ReturnType<typeof useFactoryPendingInvoiceVerifyModel>;

export function FactoryPendingInvoiceVerifyDialog6({ model }: { model: Model }) {
  const {
    showFixBalesDialog,
    setShowFixBalesDialog,
    forceSyncMutation,
  } = model;
  return (
    <AlertDialog open={showFixBalesDialog} onOpenChange={setShowFixBalesDialog}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Fix Bale Statuses</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will mark all bales attached to this order as SOLD, removing them from inventory. Use this only if
                    bales were accidentally returned to stock after a previous finalization. This does not create invoices or
                    customer balance entries.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-fix-bales">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => forceSyncMutation.mutate()} data-testid="button-confirm-fix-bales">
                    <Wrench className="mr-2 h-4 w-4" />
                    Fix Bale Statuses
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
  );
}
