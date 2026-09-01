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
  return (
    <AlertDialog open={syncAllConfirmOpen} onOpenChange={onSyncAllConfirmOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fix all PO and Parent JV sync?</AlertDialogTitle>
          <AlertDialogDescription>
            This will scan all purchase orders and update only vouchers and totals that are out of sync. It is safe to
            run multiple times.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-sync-all-cancel">Cancel</AlertDialogCancel>
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
