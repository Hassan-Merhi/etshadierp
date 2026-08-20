/**
 * The two destructive confirmations on the Accounts Overview page: deleting a
 * ledger account and bulk-deleting selected statement vouchers.
 *
 * Split out of AccountsLegacy.tsx unchanged, wording and test ids included.
 */
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
import type { AccountsLegacyModel } from "./useAccountsLegacyModel";

export function AccountsConfirmDialogs({ model }: { model: AccountsLegacyModel }) {
  const { alterSelectedAccount, selectedVoucherIds } = model;
  return (
    <>
      <AlertDialog open={model.showDeleteAccountConfirm} onOpenChange={model.setShowDeleteAccountConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{alterSelectedAccount?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this ledger account. This cannot be undone. Accounts with existing
              transactions or child accounts cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (alterSelectedAccount?.accountId) {
                  model.deleteLedgerMutation.mutate(alterSelectedAccount.accountId);
                }
                model.setShowDeleteAccountConfirm(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={model.showBulkDeleteConfirm} onOpenChange={model.setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedVoucherIds.size} voucher(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected vouchers and reverse any associated inventory or balance
              changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-bulk-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => model.bulkDeleteMutation.mutate(Array.from(selectedVoucherIds))}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
