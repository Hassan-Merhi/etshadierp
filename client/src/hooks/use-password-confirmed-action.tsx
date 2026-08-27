import { useCallback, useState } from "react";
import { ConfirmPasswordDialog } from "@/components/ConfirmPasswordDialog";

interface PendingPasswordAction {
  action: string;
  callback: () => void;
}

export function usePasswordConfirmedAction() {
  const [pending, setPending] = useState<PendingPasswordAction | null>(null);

  const requestPasswordConfirmation = useCallback((callback: () => void, action: string) => {
    setPending({ callback, action });
  }, []);

  const PasswordConfirmationDialog = (
    <ConfirmPasswordDialog
      open={pending !== null}
      onClose={() => setPending(null)}
      onConfirmed={() => {
        const callback = pending?.callback;
        setPending(null);
        callback?.();
      }}
      action={pending?.action ?? "Update User"}
    />
  );

  return { requestPasswordConfirmation, PasswordConfirmationDialog };
}
