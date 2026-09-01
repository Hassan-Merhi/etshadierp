import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { useBalesHistoryModel } from "../useBalesHistoryModel";

type Model = ReturnType<typeof useBalesHistoryModel>;

export function BalesHistoryDialog1({ model }: { model: Model }) {
  const {
    deleteConfirm,
    setDeleteConfirm,
    deleteBale,
  } = model;
  return (
    <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Bale</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete this bale? This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteConfirm(null)} data-testid="button-cancel-delete">
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => deleteConfirm && deleteBale.mutate(deleteConfirm)}
                    disabled={deleteBale.isPending}
                    data-testid="button-confirm-delete"
                  >
                    {deleteBale.isPending ? "Deleting..." : "Delete"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
  );
}
