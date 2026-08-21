import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { useBalesHistoryModel } from "../useBalesHistoryModel";

type Model = ReturnType<typeof useBalesHistoryModel>;

export function BalesHistoryDialog2({ model }: { model: Model }) {
  const {
    wrapAdminAction,
    repackConfirm,
    setRepackConfirm,
    repackBale,
  } = model;
  return (
    <Dialog open={repackConfirm !== null} onOpenChange={() => setRepackConfirm(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Repack Bale</DialogTitle>
                  <DialogDescription>
                    {repackConfirm && (
                      <>
                        Repack bale <span className="font-mono font-semibold">{repackConfirm.bale.referenceNumber}</span> (
                        {repackConfirm.product?.name || repackConfirm.bale.productName || "Unknown"})? This will mark the
                        original bale as REPACKED and create a new bale with a new reference code. Labels will be printed for
                        the new bale.
                      </>
                    )}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRepackConfirm(null)} data-testid="button-cancel-repack">
                    Cancel
                  </Button>
                  <Button
                    onClick={() =>
                      wrapAdminAction(() => repackConfirm && repackBale.mutate(repackConfirm.bale.id), "Repack Bale")
                    }
                    disabled={repackBale.isPending}
                    data-testid="button-confirm-repack"
                  >
                    {repackBale.isPending ? "Repacking..." : "Repack"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
  );
}
