/**
 * W3 — extracted from FactoryWorkerDetail.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
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

export function W3({
  cashAccounts,
  markPaidMutation,
  payCashAccountId,
  payOpen,
  payTargetId,
  setPayCashAccountId,
  setPayOpen,
  setPayTargetId,
  wrapAdminAction,
}: {
  cashAccounts: any;
  markPaidMutation: any;
  payCashAccountId: any;
  payOpen: any;
  payTargetId: any;
  setPayCashAccountId: any;
  setPayOpen: any;
  setPayTargetId: any;
  wrapAdminAction: any;
}) {
  return (
    <Dialog
      open={payOpen}
      onOpenChange={(open) => {
        if (!open) {
          setPayOpen(false);
          setPayTargetId(null);
        }
      }}
    >
      <DialogContent data-testid="dialog-pay-payroll">
        <DialogHeader>
          <DialogTitle>Mark Payroll as Paid</DialogTitle>
          <DialogDescription>Select a cash account to record this payment.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Cash Account</Label>
            <Select value={payCashAccountId} onValueChange={setPayCashAccountId}>
              <SelectTrigger data-testid="select-pay-cash">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {cashAccounts?.map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name} ({a.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPayOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              wrapAdminAction(
                () => payTargetId && markPaidMutation.mutate({ id: payTargetId, cashId: payCashAccountId }),
                "Confirm Payment"
              )
            }
            disabled={markPaidMutation.isPending}
            data-testid="button-confirm-pay"
          >
            {markPaidMutation.isPending ? "Saving..." : "Confirm Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
