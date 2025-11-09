import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  variant = "default",
  doubleConfirm,
}: ConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const [showSecondConfirm, setShowSecondConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleFirstConfirm = () => {
    if (doubleConfirm) {
      setShowSecondConfirm(true);
    } else {
      handleFinalConfirm();
    }
  };

  const handleFinalConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      setOpen(false);
      setShowSecondConfirm(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    setShowSecondConfirm(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      // Reset second confirm state when dialog closes
      setShowSecondConfirm(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        {!showSecondConfirm ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancel} data-testid="button-cancel">
                {cancelText}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleFirstConfirm}
                disabled={isLoading}
                data-testid="button-confirm"
                className={
                  variant === "destructive"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : ""
                }
              >
                {confirmText}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : doubleConfirm ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{doubleConfirm.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {doubleConfirm.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancel} data-testid="button-cancel-second">
                {cancelText}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleFinalConfirm}
                disabled={isLoading}
                data-testid="button-confirm-second"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {doubleConfirm.confirmText || confirmText}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
