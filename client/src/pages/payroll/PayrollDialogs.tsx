import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { Employee } from "@shared/schema";

interface WorkerDeductionDialogProps {
  target: Employee | null;
  onClose: () => void;
  amount: string;
  setAmount: (val: string) => void;
  reason: string;
  setReason: (val: string) => void;
  date: string;
  setDate: (val: string) => void;
  mutation: any;
}

export function WorkerDeductionDialog({
  target,
  onClose,
  amount,
  setAmount,
  reason,
  setReason,
  date,
  setDate,
  mutation
}: WorkerDeductionDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="dialog-worker-deduction">
        <DialogHeader>
          <DialogTitle>Add Deduction</DialogTitle>
          <DialogDescription>
            {target
              ? `Deduction for ${[target.firstName, (target as any).lastName].filter(Boolean).join(" ")}. Pending deductions are applied automatically at the next payroll run.`
              : "Add a pending deduction for this worker."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="ded-amount">Amount</Label>
            <Input
              id="ded-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-worker-deduction-amount"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ded-reason">Reason (optional)</Label>
            <Input
              id="ded-reason"
              placeholder="e.g. Uniform, Damage, etc."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-worker-deduction-reason"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ded-date">Date</Label>
            <Input
              id="ded-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="input-worker-deduction-date"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-worker-deduction">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount}
            data-testid="button-submit-worker-deduction"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Deduction
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// We can add other specific large dialogs here if needed
