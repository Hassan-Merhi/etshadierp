/**
 * D1 — extracted from FactoryProformas.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function D1({
  renameProformaMutation,
  renameValue,
  renamingProforma,
  setRenameValue,
  setRenamingProforma,
}: {
  renameProformaMutation: any;
  renameValue: any;
  renamingProforma: any;
  setRenameValue: any;
  setRenamingProforma: any;
}) {
  return (
    <Dialog
      open={!!renamingProforma}
      onOpenChange={(open) => {
        if (!open) {
          setRenamingProforma(null);
          setRenameValue("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Proforma</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">New Name</label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="e.g. Summer 2024 Pricing"
              data-testid="input-rename-proforma"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim() && renameValue.trim() !== renamingProforma?.name) {
                  renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() });
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setRenamingProforma(null);
                setRenameValue("");
              }}
              data-testid="button-cancel-rename"
            >
              Cancel
            </Button>
            <Button
              onClick={() => renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() })}
              disabled={
                renameProformaMutation.isPending || !renameValue.trim() || renameValue.trim() === renamingProforma?.name
              }
              data-testid="button-submit-rename"
            >
              {renameProformaMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
