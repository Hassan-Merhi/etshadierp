/**
 * Back-compat shim — `ConfirmationDialog` and `DeleteConfirmDialog` now
 * delegate to the canonical {@link ConfirmDialog} primitive so every
 * confirm/auth/override/draft dialog in the app shares one implementation,
 * one footer layout, one loading state, and one set of test-ids.
 */
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface ConfirmationDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  variant?: "default" | "destructive";
  doubleConfirm?: {
    title: string;
    description: string;
    confirmText?: string;
  };
}

export function ConfirmationDialog({
  trigger,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  variant = "default",
  doubleConfirm,
}: ConfirmationDialogProps) {
  return (
    <ConfirmDialog
      trigger={trigger}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText={cancelText}
      tone={variant}
      doubleConfirm={doubleConfirm}
      onConfirm={onConfirm}
    />
  );
}

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "ARE YOU SURE YOU WANT TO DELETE THIS?",
  description = "This action cannot be undone.",
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmText="Delete"
      tone="destructive"
      onConfirm={onConfirm}
    />
  );
}
