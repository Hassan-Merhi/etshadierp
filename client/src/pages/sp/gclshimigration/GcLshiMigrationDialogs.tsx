import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useGcLshiMigrationModel } from "./useGcLshiMigrationModel";

type MigrationModel = ReturnType<typeof useGcLshiMigrationModel>;

export function GcLshiMigrationDialogs({ model }: { model: MigrationModel }) {
  return (
    <>
      <AlertDialog open={model.showCreateDialog} onOpenChange={model.setShowCreateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create New SP Company</AlertDialogTitle>
            <AlertDialogDescription>This creates a new Supplier Partner company in the system.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Company Name</Label>
              <Input
                value={model.createName}
                onChange={(event) => model.setCreateName(event.target.value)}
                placeholder="GC-LSHI"
                data-testid="input-create-company-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Company Code (unique)</Label>
              <Input
                value={model.createCode}
                onChange={(event) => model.setCreateCode(event.target.value)}
                placeholder="GC-LSHI-SP"
                data-testid="input-create-company-code"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-create-company">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => model.createCompanyMutation.mutate({ name: model.createName, code: model.createCode })}
              disabled={!model.createName || !model.createCode || model.createCompanyMutation.isPending}
              data-testid="button-confirm-create-company"
            >
              {model.createCompanyMutation.isPending ? "Creating…" : "Create Company"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!model.rollbackRunId}
        onOpenChange={(open) => {
          if (!open) model.setRollbackRunId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback Run {model.rollbackRunId?.slice(0, 8)}</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all rows created by this migration run from the target company. The source
              ERP company will not be touched. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rollback">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => model.rollbackRunId && model.rollbackMutation.mutate(model.rollbackRunId)}
              disabled={model.rollbackMutation.isPending}
              data-testid="button-confirm-rollback"
            >
              {model.rollbackMutation.isPending ? "Rolling back…" : "Rollback"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
