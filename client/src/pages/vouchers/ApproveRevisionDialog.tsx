import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ApproveRevisionDialogProps {
  approveRevisionTarget: any;
  setApproveRevisionTarget: (target: any) => void;
  approveRevisionMutation: any;
  formatNumber: (num: any, decimals?: number) => string;
}

export function ApproveRevisionDialog({
  approveRevisionTarget,
  setApproveRevisionTarget,
  approveRevisionMutation,
  formatNumber,
}: ApproveRevisionDialogProps) {
  return (
    <Dialog
      open={!!approveRevisionTarget}
      onOpenChange={(open) => {
        if (!open) setApproveRevisionTarget(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve Revision</DialogTitle>
          <DialogDescription>
            The following quantity changes will be applied to the transfer. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {approveRevisionTarget && (
          <div className="table-responsive rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2 font-medium">Item</th>
                  <th className="text-right p-2 font-medium">Was</th>
                  <th className="text-right p-2 font-medium">Change</th>
                  <th className="text-right p-2 font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {(approveRevisionTarget.items ?? [])
                  .filter((item: any) => parseFloat(item.delta) !== 0)
                  .map((item: any, idx: number) => {
                    const delta = parseFloat(item.delta);
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-2 font-medium">{item.stockItemName}</td>
                        <td className="p-2 text-right font-mono text-muted-foreground">
                          {formatNumber(parseFloat(item.originalQuantity), 0)}
                        </td>
                        <td
                          className={`p-2 text-right font-mono font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                        >
                          {delta > 0 ? "+" : ""}
                          {formatNumber(delta, 0)}
                        </td>
                        <td className="p-2 text-right font-mono font-semibold">
                          {formatNumber(parseFloat(item.newQuantity), 0)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => setApproveRevisionTarget(null)}
            data-testid="button-approve-revision-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={approveRevisionMutation.isPending}
            onClick={() => approveRevisionTarget && approveRevisionMutation.mutate(approveRevisionTarget.id)}
            data-testid="button-approve-revision-confirm"
          >
            {approveRevisionMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Applying…
              </>
            ) : (
              "Approve & Apply"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
