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
import type { PendingDelete } from "../types";

interface DeleteConfirmationDialogProps {
  pendingDelete: PendingDelete | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (pending: PendingDelete) => void;
}

export function DeleteConfirmationDialog({ pendingDelete, onOpenChange, onConfirm }: DeleteConfirmationDialogProps) {
  return (
    <AlertDialog open={!!pendingDelete} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {pendingDelete?.type === "row" ? "Row" : pendingDelete?.type === "col" ? "Column" : "Page"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <span className="font-medium">"{pendingDelete?.label}"</span>?
            {pendingDelete?.type === "row"
              ? " All data in this row will be lost."
              : pendingDelete?.type === "col"
                ? " All data in this column will be lost."
                : " This page and all its data will be permanently deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => pendingDelete && onConfirm(pendingDelete)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
