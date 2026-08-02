/**
 * RemoveBalesDialog — extracted from FactoryLocationInventory.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useFactoryText } from "@/i18n/modules/factory";

export function RemoveBalesDialog({
  deleteDialogOpen,
  deleteProduct,
  deleteQty,
  deleteReason,
  deleteSupervisorPass,
  deleteSupervisorUser,
  removeBalesMutation,
  selectedLocation,
  setDeleteDialogOpen,
  setDeleteProduct,
  setDeleteQty,
  setDeleteReason,
  setDeleteSupervisorPass,
  setDeleteSupervisorUser,
}: {
  deleteDialogOpen: any;
  deleteProduct: any;
  deleteQty: any;
  deleteReason: any;
  deleteSupervisorPass: any;
  deleteSupervisorUser: any;
  removeBalesMutation: any;
  selectedLocation: any;
  setDeleteDialogOpen: any;
  setDeleteProduct: any;
  setDeleteQty: any;
  setDeleteReason: any;
  setDeleteSupervisorPass: any;
  setDeleteSupervisorUser: any;
}) {
  const tUi = useFactoryText();
  return (
    <Dialog
      open={deleteDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          setDeleteDialogOpen(false);
          setDeleteProduct(null);
          setDeleteSupervisorUser("");
          setDeleteSupervisorPass("");
          setDeleteReason("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tUi("remove.bales.from.stock")}</DialogTitle>
          <DialogDescription>
            {deleteProduct && (
              <>
                Remove bales of <strong>{deleteProduct.productName}</strong> from{" "}
                <strong>{selectedLocation.name}</strong>. Current stock: <strong>{deleteProduct.baleCount}</strong>{" "}
                bale(s).
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {!navigator.onLine && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            You are offline. This removal will be queued and processed when back online.
          </div>
        )}
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="delete-qty">{tUi("quantity.to.remove")}</Label>
            <Input
              id="delete-qty"
              type="number"
              min={1}
              max={deleteProduct?.baleCount ?? 1}
              value={deleteQty}
              onChange={(e) =>
                setDeleteQty(Math.max(1, Math.min(deleteProduct?.baleCount ?? 1, parseInt(e.target.value) || 1)))
              }
              data-testid="input-delete-qty"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delete-reason">{tUi("reason")}</Label>
            <Input
              id="delete-reason"
              placeholder="e.g. damaged, lost, correction"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              data-testid="input-delete-reason"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delete-supervisor-user">{tUi("supervisor.username")}</Label>
            <Input
              id="delete-supervisor-user"
              placeholder={tUi("admin.owner.manager.username")}
              value={deleteSupervisorUser}
              onChange={(e) => setDeleteSupervisorUser(e.target.value)}
              data-testid="input-delete-supervisor-user"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delete-supervisor-pass">{tUi("supervisor.password")}</Label>
            <Input
              id="delete-supervisor-pass"
              type="password"
              placeholder={tUi("password")}
              value={deleteSupervisorPass}
              onChange={(e) => setDeleteSupervisorPass(e.target.value)}
              data-testid="input-delete-supervisor-pass"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDeleteDialogOpen(false);
              setDeleteProduct(null);
              setDeleteSupervisorUser("");
              setDeleteSupervisorPass("");
              setDeleteReason("");
            }}
            data-testid="button-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={removeBalesMutation.isPending || !deleteSupervisorUser || !deleteSupervisorPass || deleteQty < 1}
            onClick={() => {
              if (!deleteProduct || !selectedLocation) return;
              removeBalesMutation.mutate({
                productId: deleteProduct.productId,
                locationId: selectedLocation.id,
                qty: deleteQty,
                supervisorUsername: deleteSupervisorUser,
                supervisorPassword: deleteSupervisorPass,
                reason: deleteReason,
              });
            }}
            data-testid="button-delete-confirm"
          >
            {removeBalesMutation.isPending ? "Removing..." : `Remove ${deleteQty} Bale(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
