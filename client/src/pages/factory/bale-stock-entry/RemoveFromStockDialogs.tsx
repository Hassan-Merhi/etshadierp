import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFactoryText } from "@/i18n/modules/factory";

interface RemoveBaleAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  supervisorUsername: string;
  onSupervisorUsernameChange: (val: string) => void;
  supervisorPassword: string;
  onSupervisorPasswordChange: (val: string) => void;
  removalReason: string;
  onRemovalReasonChange: (val: string) => void;
  authError: string;
  isPending: boolean;
  onConfirm: () => void;
}

export function RemoveBaleAuthDialog({
  open,
  onOpenChange,
  selectedCount,
  supervisorUsername,
  onSupervisorUsernameChange,
  supervisorPassword,
  onSupervisorPasswordChange,
  removalReason,
  onRemovalReasonChange,
  authError,
  isPending,
  onConfirm,
}: RemoveBaleAuthDialogProps) {
  const tUi = useFactoryText();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Supervisor Authorization Required
          </DialogTitle>
          <DialogDescription>
            Removing {selectedCount} bale(s) from stock requires supervisor approval and a valid reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{tUi("supervisor.username")}</label>
            <Input
              value={supervisorUsername}
              onChange={(e) => onSupervisorUsernameChange(e.target.value)}
              placeholder={tUi("supervisor.username.2")}
              data-testid="input-supervisor-username"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{tUi("supervisor.password")}</label>
            <Input
              type="password"
              value={supervisorPassword}
              onChange={(e) => onSupervisorPasswordChange(e.target.value)}
              placeholder={tUi("supervisor.password.2")}
              data-testid="input-supervisor-password"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{tUi("reason.for.removal")}</label>
            <Input
              value={removalReason}
              onChange={(e) => onRemovalReasonChange(e.target.value)}
              placeholder="e.g. Recycled, Correction, Damage"
              data-testid="input-removal-reason"
            />
          </div>
          {authError && <p className="text-xs font-medium text-destructive">{authError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!supervisorUsername || !supervisorPassword || !removalReason || isPending}
            data-testid="button-auth-remove"
          >
            {isPending ? "Processing..." : "Authorize & Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AssignWorkerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: any[];
  workerIdSelected: string;
  onWorkerIdChange: (val: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function AssignWorkerDialog({
  open,
  onOpenChange,
  workers,
  workerIdSelected,
  onWorkerIdChange,
  isPending,
  onConfirm,
}: AssignWorkerDialogProps) {
  const tUi = useFactoryText();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tUi("assign.worker.to.bale")}</DialogTitle>
          <DialogDescription>
            This bale has no worker assigned. Please select the worker who finalized this bale before printing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{tUi("worker.name")}</label>
            <Select value={workerIdSelected} onValueChange={onWorkerIdChange}>
              <SelectTrigger data-testid="select-print-worker">
                <SelectValue placeholder={tUi("select.worker.2")} />
              </SelectTrigger>
              <SelectContent>
                {workers
                  .filter((w: any) => w.active !== false)
                  .map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.fullName || w.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!workerIdSelected || isPending} data-testid="button-assign-print">
            {isPending ? "Assigning..." : "Assign & Print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
