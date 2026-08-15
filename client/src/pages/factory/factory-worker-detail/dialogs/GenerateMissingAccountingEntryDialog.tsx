/**
 * GenerateMissingAccountingEntryDialog — extracted from FactoryWorkerDetail.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function GenerateMissingAccountingEntryDialog({
  cashAccounts,
  fixAcctCashId,
  fixAcctMutation,
  fixAcctOpen,
  fixAcctTargetId,
  setFixAcctCashId,
  setFixAcctOpen,
  setFixAcctTargetId,
  wrapAdminAction,
}: {
  cashAccounts: unknown;
  fixAcctCashId: unknown;
  fixAcctMutation: unknown;
  fixAcctOpen: unknown;
  fixAcctTargetId: unknown;
  setFixAcctCashId: unknown;
  setFixAcctOpen: unknown;
  setFixAcctTargetId: unknown;
  wrapAdminAction: unknown;
}) {
  return (
    <Dialog
      open={fixAcctOpen}
      onOpenChange={(open) => {
        if (!open) {
          setFixAcctOpen(false);
          setFixAcctTargetId(null);
          setFixAcctCashId("");
        }
      }}
    >
      <DialogContent data-testid="dialog-fix-acct">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-500" />
            Generate Missing Accounting Entry
          </DialogTitle>
          <DialogDescription>
            This payroll was marked paid without a cash account. Select an account to create the missing payment
            voucher.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Cash Account</Label>
            <Select value={fixAcctCashId} onValueChange={setFixAcctCashId}>
              <SelectTrigger data-testid="select-fix-acct-cash">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {cashAccounts?.map((a: unknown) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name} ({a.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFixAcctOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              wrapAdminAction(
                () => fixAcctTargetId && fixAcctMutation.mutate({ id: fixAcctTargetId, cashId: fixAcctCashId }),
                "Generate Entry"
              )
            }
            disabled={fixAcctMutation.isPending || !fixAcctCashId}
            data-testid="button-confirm-fix-acct"
          >
            {fixAcctMutation.isPending ? "Generating..." : "Generate Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
