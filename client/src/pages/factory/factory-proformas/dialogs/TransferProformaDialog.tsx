/**
 * TransferProformaDialog — extracted from FactoryProformas.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DialogDescription } from "@/components/ui/dialog";
import type { Customer } from "../../factoryproformas/types";

export function TransferProformaDialog({
  customers,
  setTransferProforma,
  setTransferTargetCustomerId,
  transferProforma,
  transferProformaMutation,
  transferTargetCustomerId,
}: {
  customers: unknown;
  setTransferProforma: unknown;
  setTransferTargetCustomerId: unknown;
  transferProforma: unknown;
  transferProformaMutation: unknown;
  transferTargetCustomerId: unknown;
}) {
  return (
    <Dialog
      open={!!transferProforma}
      onOpenChange={(open) => {
        if (!open) {
          setTransferProforma(null);
          setTransferTargetCustomerId("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Proforma</DialogTitle>
          <DialogDescription>
            Move <strong>{transferProforma?.name}</strong> to a different customer. All lines and reservations will be
            moved with it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Current Customer</label>
            <p className="text-sm text-muted-foreground">
              {customers.find((c: Customer) => c.id === transferProforma?.customerId)?.legalName ?? "—"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Transfer To</label>
            <Select value={transferTargetCustomerId} onValueChange={setTransferTargetCustomerId}>
              <SelectTrigger data-testid="select-transfer-customer">
                <SelectValue placeholder="Select customer..." />
              </SelectTrigger>
              <SelectContent>
                {customers
                  .filter((c: Customer) => c.id !== transferProforma?.customerId)
                  .map((c: Customer) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.legalName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setTransferProforma(null);
                setTransferTargetCustomerId("");
              }}
              data-testid="button-cancel-transfer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!transferProforma || !transferTargetCustomerId) return;
                transferProformaMutation.mutate({
                  id: transferProforma.id,
                  targetCustomerId: parseInt(transferTargetCustomerId),
                });
              }}
              disabled={!transferTargetCustomerId || transferProformaMutation.isPending}
              data-testid="button-confirm-transfer"
            >
              {transferProformaMutation.isPending ? "Transferring..." : "Transfer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
