import { Loader2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { useFactoryStockAllocationV5Model } from "../useFactoryStockAllocationV5Model";

type Model = ReturnType<typeof useFactoryStockAllocationV5Model>;
export function FactoryStockAllocationV5Dialog7({ model }: { model: Model }) {
  const { cancelDialog, setCancelDialog, cancelContainerMut } = model;
  return (
    <AlertDialog
      open={cancelDialog?.status === "LOADING"}
      onOpenChange={(open) => {
        if (!open) setCancelDialog(null);
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <X className="h-4 w-4" />
            Cancel Loading Container?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3 pt-1">
              <p>
                You are about to cancel{" "}
                <span className="font-semibold text-foreground">{cancelDialog?.containerName}</span>, which is actively
                loading.
              </p>
              <p className="text-xs bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                All scanned bale links will be removed and bales returned to stock. You can restore this container
                within 30 days using the "Restore Cancelled" button.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel data-testid="button-v5-cancel-ct-dismiss">Keep Container</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => cancelDialog && cancelContainerMut.mutate({ orderId: cancelDialog.orderId })}
            disabled={cancelContainerMut.isPending}
            data-testid="button-v5-cancel-ct-confirm"
          >
            {cancelContainerMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cancelling…
              </>
            ) : (
              "Yes, Cancel It"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
