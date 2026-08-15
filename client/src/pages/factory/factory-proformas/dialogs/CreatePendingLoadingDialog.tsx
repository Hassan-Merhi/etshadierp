/**
 * CreatePendingLoadingDialog — extracted from FactoryProformas.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export function CreatePendingLoadingDialog({
  createLoadingLocationId,
  createLoadingMutation,
  createLoadingProforma,
  locations,
  setCreateLoadingLocationId,
  setCreateLoadingProforma,
}: {
  createLoadingLocationId: unknown;
  createLoadingMutation: unknown;
  createLoadingProforma: unknown;
  locations: unknown;
  setCreateLoadingLocationId: unknown;
  setCreateLoadingProforma: unknown;
}) {
  return (
    <Dialog
      open={!!createLoadingProforma}
      onOpenChange={(open) => {
        if (!open) {
          setCreateLoadingProforma(null);
          setCreateLoadingLocationId("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Pending Loading</DialogTitle>
          <DialogDescription>
            A new loading will be created from <strong>{createLoadingProforma?.name}</strong>. Bales matching each
            proforma line will be automatically reserved from the selected location.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm font-medium mb-1 block">Warehouse Location</Label>
            <Select value={createLoadingLocationId} onValueChange={setCreateLoadingLocationId}>
              <SelectTrigger data-testid="select-loading-location">
                <SelectValue placeholder="Select a location..." />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc: any) => (
                  <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`select-location-option-${loc.id}`}>
                    {loc.name} {loc.code ? `(${loc.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setCreateLoadingProforma(null);
              setCreateLoadingLocationId("");
            }}
            data-testid="button-cancel-create-loading"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!createLoadingProforma || !createLoadingLocationId) return;
              createLoadingMutation.mutate({
                proformaId: createLoadingProforma.id,
                locationId: createLoadingLocationId,
              });
            }}
            disabled={!createLoadingLocationId || createLoadingMutation.isPending}
            data-testid="button-confirm-create-loading"
          >
            {createLoadingMutation.isPending ? "Creating..." : "Create Loading"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
