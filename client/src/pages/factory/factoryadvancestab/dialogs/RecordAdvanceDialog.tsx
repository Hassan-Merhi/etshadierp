/**
 * RecordAdvanceDialog — extracted from AdvancesView.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFactoryText } from "@/i18n/modules/factory";

export function RecordAdvanceDialog({
  addOpen,
  cashAccounts,
  createMutation,
  form,
  setAddOpen,
  setForm,
  workers,
}: {
  addOpen: any;
  cashAccounts: any;
  createMutation: any;
  form: any;
  setAddOpen: any;
  setForm: any;
  workers: any;
}) {
  const tUi = useFactoryText();
  return (
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tUi("record.advance")}</DialogTitle>
          <DialogDescription>{tUi("give.a.cash.advance.to.a.factory.worker")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{tUi("worker")}</Label>
            <Select value={form.workerId} onValueChange={(v) => setForm({ ...form, workerId: v })}>
              <SelectTrigger data-testid="select-advance-worker">
                <SelectValue placeholder={tUi("select.worker")} />
              </SelectTrigger>
              <SelectContent>
                {(workers || []).map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{tUi("date")}</Label>
              <Input
                type="date"
                value={form.advanceDate}
                onChange={(e) => setForm({ ...form, advanceDate: e.target.value })}
                data-testid="input-advance-date"
              />
            </div>
            <div className="space-y-2">
              <Label>{tUi("amount.4")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                data-testid="input-advance-amount"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{tUi("cash.account.2")}</Label>
            <Select value={form.cashAccountId} onValueChange={(v) => setForm({ ...form, cashAccountId: v })}>
              <SelectTrigger data-testid="select-advance-cash-account">
                <SelectValue placeholder={tUi("select.cash.account.optional")} />
              </SelectTrigger>
              <SelectContent>
                {(cashAccounts || []).map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{tUi("repayment.type")}</Label>
            <Select value={form.repaymentType} onValueChange={(v) => setForm({ ...form, repaymentType: v })}>
              <SelectTrigger data-testid="select-advance-repayment-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="salary_deduction">{tUi("deduct.from.salary")}</SelectItem>
                <SelectItem value="manual_repayment">{tUi("manual.repayment.loan")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{tUi("notes")}</Label>
            <Textarea
              placeholder={tUi("optional.notes")}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="resize-none"
              data-testid="input-advance-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-advance">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.workerId || !form.amount || parseFloat(form.amount) <= 0 || createMutation.isPending}
            data-testid="button-submit-advance"
          >
            {createMutation.isPending ? "Saving..." : "Record Advance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
