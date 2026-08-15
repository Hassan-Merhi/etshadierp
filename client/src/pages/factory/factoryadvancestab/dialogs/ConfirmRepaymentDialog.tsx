/**
 * ConfirmRepaymentDialog — extracted from AdvancesView.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { fmt } from "../utils";

export function ConfirmRepaymentDialog({
  cashAccounts,
  confirmRepay,
  repayByMonthForm,
  repayByMonthMutation,
  setConfirmRepay,
  setRepayingMonth,
}: {
  cashAccounts: unknown;
  confirmRepay: unknown;
  repayByMonthForm: unknown;
  repayByMonthMutation: unknown;
  setConfirmRepay: unknown;
  setRepayingMonth: unknown;
}) {
  return (
    <Dialog
      open={!!confirmRepay}
      onOpenChange={(open) => {
        if (!open) setConfirmRepay(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm Repayment — {confirmRepay?.monthLabel}</DialogTitle>
          <DialogDescription>
            Review the advances below. Clicking Confirm will mark all of them as fully paid and post the accounting
            entries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          {/* Summary line */}
          <div className="flex justify-between items-center py-2 px-3 rounded-md bg-muted/40 font-medium">
            <span>Repayment date</span>
            <span className="font-mono">{repayByMonthForm.repaymentDate}</span>
          </div>
          <div className="flex justify-between items-center py-2 px-3 rounded-md bg-muted/40 font-medium">
            <span>Cash account</span>
            <span>
              {(cashAccounts || []).find((a: unknown) => String(a.id) === repayByMonthForm.cashAccountId)?.name ?? "—"}
            </span>
          </div>
        </div>

        {/* Per-advance breakdown */}
        <div className="border rounded-md overflow-hidden mt-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1 text-xs font-medium text-muted-foreground bg-muted/20">
            <span>Worker</span>
            <span className="text-right">Original</span>
            <span className="text-right">Will repay</span>
          </div>
          <div className="divide-y">
            {(confirmRepay?.items || []).map((adv: unknown) => (
              <div key={adv.id} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-sm">
                <span className="font-medium">{adv.workerName}</span>
                <span className="font-mono text-right text-muted-foreground">{fmt(adv.amount)}</span>
                <span className="font-mono text-right font-semibold text-amber-700 dark:text-amber-400">
                  {fmt(adv.remainingBalance)}
                </span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-sm font-bold bg-muted/20">
              <span>Total</span>
              <span></span>
              <span className="font-mono text-right">{fmt(confirmRepay?.total ?? 0)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => setConfirmRepay(null)}
            disabled={repayByMonthMutation.isPending}
            data-testid="button-confirm-repay-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!confirmRepay) return;
              setRepayingMonth(confirmRepay.monthKey);
              setConfirmRepay(null);
              repayByMonthMutation.mutate(confirmRepay.monthKey);
            }}
            disabled={repayByMonthMutation.isPending}
            data-testid="button-confirm-repay-ok"
          >
            {repayByMonthMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              `Confirm — Pay ${fmt(confirmRepay?.total ?? 0)}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
