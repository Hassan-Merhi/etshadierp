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
import { useErpText } from "@/i18n/modules/erp";

interface ContainerConfirmDialogsProps {
  syncAllConfirmOpen: boolean;
  onSyncAllConfirmOpenChange: (open: boolean) => void;
  onSyncAllConfirm: () => void;
}

export function ContainerConfirmDialogs({
  syncAllConfirmOpen,
  onSyncAllConfirmOpenChange,
  onSyncAllConfirm,
}: ContainerConfirmDialogsProps) {
  const tUi = useErpText();
  return (
    <AlertDialog open={syncAllConfirmOpen} onOpenChange={onSyncAllConfirmOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tUi("fix.all.po.and.parent.jv.sync")}</AlertDialogTitle>
          <AlertDialogDescription>
            This will scan all purchase orders and update only vouchers and totals that are out of sync. It is safe to
            run multiple times.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-sync-all-cancel">{tUi("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-sync-all-confirm"
            onClick={() => {
              onSyncAllConfirmOpenChange(false);
              onSyncAllConfirm();
            }}
          >
            Run Sync
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
