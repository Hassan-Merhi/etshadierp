import { CreateAccountModal } from "@/components/vouchers/CreateAccountModal";
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
import type { useJournalFormModel } from "./useJournalFormModel";

type Model = ReturnType<typeof useJournalFormModel>;

export function JournalFormDialogs({ model }: { model: Model }) {
  const {
    showCreateAccountModal,
    setShowCreateAccountModal,
    setCreateAccountContext,
    selectedCompany,
    handleAccountCreated,
    modeApiRequest,
    waPendingPrompt,
    setWaPendingPrompt,
    sendWaStatementMutation,
  } = model;

  return (
    <>
      <CreateAccountModal
        open={showCreateAccountModal}
        onClose={() => {
          setShowCreateAccountModal(false);
          setCreateAccountContext(null);
        }}
        companyId={selectedCompany?.id || 0}
        onAccountCreated={handleAccountCreated}
        apiRequestFn={modeApiRequest}
      />

      <AlertDialog
        open={!!waPendingPrompt}
        onOpenChange={(open) => {
          if (!open) setWaPendingPrompt(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-whatsapp-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle>Send Statement via WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              A WhatsApp statement is configured for this account. Would you like to send the{" "}
              <strong>{waPendingPrompt?.month}</strong> statement now, or skip and send it manually later?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-whatsapp-skip" onClick={() => setWaPendingPrompt(null)}>
              Skip for Now
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-whatsapp-send"
              disabled={sendWaStatementMutation.isPending}
              onClick={() => waPendingPrompt && sendWaStatementMutation.mutate(waPendingPrompt)}
            >
              {sendWaStatementMutation.isPending ? "Sending..." : "Send Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
