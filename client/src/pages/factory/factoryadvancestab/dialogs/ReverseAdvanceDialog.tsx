/**
 * ReverseAdvanceDialog — extracted from AdvancesView.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { RotateCcw, Loader2 } from "lucide-react";
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
import { useFactoryText } from "@/i18n/modules/factory";

export function ReverseAdvanceDialog({
  reverseMutation,
  reverseTarget,
  setReverseTarget,
}: {
  reverseMutation: any;
  reverseTarget: any;
  setReverseTarget: any;
}) {
  const tUi = useFactoryText();
  return (
    <Dialog open={!!reverseTarget} onOpenChange={(open) => !open && setReverseTarget(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tUi("reverse.advance")}</DialogTitle>
          <DialogDescription>
            This will reverse the advance of <strong>{fmt(reverseTarget?.amount)}</strong> for{" "}
            <strong>{reverseTarget?.workerName}</strong>. All repayments linked to this advance will be removed and the
            balance will be restored to outstanding.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
          Use this only if the advance was recorded by mistake or the repayments need to be undone. The advance record
          itself will remain but be marked outstanding again.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReverseTarget(null)} data-testid="button-cancel-reverse">
            Cancel
          </Button>
          <Button
            variant="default"
            className="bg-amber-600 text-white"
            onClick={() => reverseTarget && reverseMutation.mutate(reverseTarget.id)}
            disabled={reverseMutation.isPending}
            data-testid="button-confirm-reverse"
          >
            {reverseMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Reversing...
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reverse Advance
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
