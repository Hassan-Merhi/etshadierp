import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { useFactoryStockAllocationV5Model } from "../useFactoryStockAllocationV5Model";

type Model = ReturnType<typeof useFactoryStockAllocationV5Model>;
export function FactoryStockAllocationV5Dialog3({ model }: { model: Model }) {
  const { closeDialog, setCloseDialog, closeProformaMut } = model;
  return (
    <Dialog
      open={!!closeDialog}
      onOpenChange={(open) => {
        if (!open) setCloseDialog(null);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Close Proforma
          </DialogTitle>
        </DialogHeader>

        {closeDialog && (
          <div className="flex flex-col gap-3 py-1">
            <p className="text-sm text-muted-foreground">
              Close <span className="font-semibold text-foreground">{closeDialog.proformaName}</span>?
            </p>
            <p className="text-sm text-muted-foreground">
              It will stop counting in Expected to Load. Existing containers and history will remain.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setCloseDialog(null)} data-testid="button-v5-close-pf-cancel">
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => closeDialog && closeProformaMut.mutate(closeDialog.proformaId)}
            disabled={closeProformaMut.isPending}
            data-testid="button-v5-close-pf-confirm"
          >
            {closeProformaMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Closing…
              </>
            ) : (
              "Close Proforma"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
