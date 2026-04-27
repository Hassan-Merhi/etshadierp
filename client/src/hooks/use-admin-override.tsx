import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminOverrideDialog } from "@/components/AdminOverrideDialog";

const ADMIN_ROLES = ["Admin", "Owner", "Developer"];

interface UseAdminOverrideReturn {
  wrapAdminAction: (fn: () => void, label?: string) => void;
  AdminDialog: React.ReactNode;
}

/**
 * useAdminOverride — wraps any destructive factory action with an admin
 * credential check. If the current user is already an admin/owner/developer,
 * the action fires immediately. Otherwise an overlay dialog is shown asking
 * for admin username + password before the action is allowed to proceed.
 *
 * Usage:
 *   const { wrapAdminAction, AdminDialog } = useAdminOverride();
 *   // Somewhere in JSX: {AdminDialog}
 *   // On a button: onClick={() => wrapAdminAction(() => deleteMutation.mutate(id), "Delete Item")}
 */
export function useAdminOverride(): UseAdminOverrideReturn {
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [actionLabel, setActionLabel] = useState<string | undefined>(undefined);

  const isAdmin = ADMIN_ROLES.includes(currentUser?.role || "");

  const wrapAdminAction = useCallback(
    (fn: () => void, label?: string) => {
      if (isAdmin) {
        fn();
      } else {
        setActionLabel(label);
        setPendingAction(() => fn);
      }
    },
    [isAdmin],
  );

  const handleSuccess = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    setActionLabel(undefined);
    if (action) action();
  }, [pendingAction]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    setActionLabel(undefined);
  }, []);

  const AdminDialog = (
    <AdminOverrideDialog
      open={!!pendingAction}
      actionLabel={actionLabel}
      onSuccess={handleSuccess}
      onCancel={handleCancel}
    />
  );

  return { wrapAdminAction, AdminDialog };
}
