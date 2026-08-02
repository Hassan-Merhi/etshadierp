/**
 * RenameLocationDialog — extracted from FactoryLocationInventory.tsx during the Phase 4 split.
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
import { useFactoryText } from "@/i18n/modules/factory";

export function RenameLocationDialog({
  renameDialogOpen,
  renameInput,
  renameLocationMutation,
  renamingLocation,
  setRenameDialogOpen,
  setRenameInput,
}: {
  renameDialogOpen: any;
  renameInput: any;
  renameLocationMutation: any;
  renamingLocation: any;
  setRenameDialogOpen: any;
  setRenameInput: any;
}) {
  const tUi = useFactoryText();
  return (
    <Dialog
      open={renameDialogOpen}
      onOpenChange={(open) => {
        if (!open) setRenameDialogOpen(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tUi("rename.location.2")}</DialogTitle>
          <DialogDescription>
            Enter a new name for <strong>{renamingLocation?.name}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            placeholder={tUi("location.name")}
            data-testid="input-rename-location"
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameInput.trim() && renamingLocation) {
                renameLocationMutation.mutate({ id: renamingLocation.id, name: renameInput.trim() });
              }
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameDialogOpen(false)} data-testid="button-rename-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (renameInput.trim() && renamingLocation) {
                renameLocationMutation.mutate({ id: renamingLocation.id, name: renameInput.trim() });
              }
            }}
            disabled={!renameInput.trim() || renameLocationMutation.isPending}
            data-testid="button-rename-confirm"
          >
            {renameLocationMutation.isPending ? "Saving..." : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
