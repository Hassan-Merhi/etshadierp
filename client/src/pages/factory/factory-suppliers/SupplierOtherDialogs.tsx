import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UseMutationResult } from "@tanstack/react-query";
import { Package } from "lucide-react";

interface SupplierOtherDialogsProps {
  obEditSupplier: { id: number; name: string; currentBalance: string } | null;
  setObEditSupplier: (val: any) => void;
  obEditValue: string;
  setObEditValue: (val: string) => void;
  obEditMutation: UseMutationResult<any, any, any>;
  
  dueDialogSupplier: { name: string; containers: any[] } | null;
  setDueDialogSupplier: (val: any) => void;
  formatDate: (val: string) => string;

  editObComm: null | { rawStockId: number; amount: string; currencyCode: string; personName: string; notes: string };
  setEditObComm: (val: any) => void;
  updateObCommissionMutation: UseMutationResult<any, any, any>;
  wrapAdminAction: (fn: () => void, title: string) => void;
}

export function SupplierOtherDialogs({
  obEditSupplier, setObEditSupplier, obEditValue, setObEditValue, obEditMutation,
  dueDialogSupplier, setDueDialogSupplier,
  formatDate,
  editObComm, setEditObComm, updateObCommissionMutation,
  wrapAdminAction,
}: SupplierOtherDialogsProps) {
  return (
    <>
      <Dialog open={!!editObComm} onOpenChange={(open) => { if (!open) setEditObComm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Edit OB Commission
            </DialogTitle>
          </DialogHeader>
          {editObComm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={editObComm.amount} onChange={e => setEditObComm((p: any) => p ? { ...p, amount: e.target.value } : null)} />
                </div>
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Input value={editObComm.currencyCode} onChange={e => setEditObComm((p: any) => p ? { ...p, currencyCode: e.target.value.toUpperCase() } : null)} maxLength={10} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Person / Broker</Label>
                <Input value={editObComm.personName} onChange={e => setEditObComm((p: any) => p ? { ...p, personName: e.target.value } : null)} placeholder="Name (optional)" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={editObComm.notes} onChange={e => setEditObComm((p: any) => p ? { ...p, notes: e.target.value } : null)} placeholder="Notes (optional)" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditObComm(null)}>Cancel</Button>
            <Button
              disabled={updateObCommissionMutation.isPending || !editObComm?.amount}
              onClick={() => wrapAdminAction(() => editObComm && updateObCommissionMutation.mutate({
                rawStockId: editObComm.rawStockId,
                commissionAmount: editObComm.amount,
                commissionCurrencyCode: editObComm.currencyCode,
                commissionPersonName: editObComm.personName,
                commissionNotes: editObComm.notes,
              }), "Save Commission")}
            >
              {updateObCommissionMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!obEditSupplier} onOpenChange={(open) => { if (!open) { setObEditSupplier(null); setObEditValue(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Opening Balance</DialogTitle>
            <DialogDescription>
              Overwrite the opening balance for <span className="font-semibold">{obEditSupplier?.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Opening Balance (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={obEditValue}
                onChange={(e) => setObEditValue(e.target.value)}
                data-testid="input-ob-edit-value"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setObEditSupplier(null); setObEditValue(""); }}>Cancel</Button>
            <Button
              onClick={() => wrapAdminAction(() => obEditSupplier && obEditMutation.mutate({ id: obEditSupplier.id, openingBalance: obEditValue }), "Save Opening Balance")}
              disabled={obEditMutation.isPending || !obEditValue}
            >
              {obEditMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dueDialogSupplier} onOpenChange={(open) => { if (!open) setDueDialogSupplier(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              Payment Due — {dueDialogSupplier?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {dueDialogSupplier?.containers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No due containers</p>
            ) : (
              <div className="rounded-md border divide-y text-sm">
                {(dueDialogSupplier?.containers || [])
                  .slice()
                  .sort((a: any, b: any) => new Date(a.offloadDate).getTime() - new Date(b.offloadDate).getTime())
                  .map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
                      <div>
                        <div className="font-medium">{c.containerNumber}</div>
                        <div className="text-xs text-muted-foreground">Offloaded: {formatDate(c.offloadDate)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="tabular-nums font-medium">{c.currencyCode} {parseFloat(c.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                          {c.daysPastDue > 0 ? `${c.daysPastDue}d overdue` : "Due today"}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setDueDialogSupplier(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
