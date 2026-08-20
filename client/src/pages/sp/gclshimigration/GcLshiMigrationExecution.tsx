import { Building2, CheckCircle2, DollarSign, FileText, Layers, Package, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProfitOpeningRunner } from "./components/ProfitOpeningRunner";
import { ReconciliationRunner } from "./components/ReconciliationRunner";
import { Stage2StepRunner } from "./components/Stage2StepRunner";
import { StatusBadge } from "./components/StatusBadge";
import type { useGcLshiMigrationModel } from "./useGcLshiMigrationModel";

type MigrationModel = ReturnType<typeof useGcLshiMigrationModel>;

export function GcLshiMigrationStages({ model }: { model: MigrationModel }) {
  if (!model.sourceCompanyId || !model.targetCompanyId) return null;
  const steps = [
    {
      key: "stockMaster",
      label: "Step 4 — Stock Master (groups, grades, categories, items)",
      icon: Layers,
      endpoint: "/api/sp/migration/gc-stock-master",
      dependsOnAction: null as string | null,
      dependsOnLabel: null as string | null,
    },
    {
      key: "stockOpening",
      label: "Step 5 — Stock Opening by Location",
      icon: Package,
      endpoint: "/api/sp/migration/gc-stock-opening",
      dependsOnAction: "gc_stock_master",
      dependsOnLabel: "Step 4 — Stock Master",
    },
    {
      key: "salesReadonly",
      label: "Step 6 — Historical Sales (read-only)",
      icon: FileText,
      endpoint: "/api/sp/migration/gc-sales-readonly",
      dependsOnAction: "gc_stock_opening",
      dependsOnLabel: "Step 5 — Stock Opening by Location",
    },
    {
      key: "containers",
      label: "Step 7 — Containers (incl. Goods-OTW accounting)",
      icon: Building2,
      endpoint: "/api/sp/migration/gc-containers",
      dependsOnAction: "gc_stock_opening",
      dependsOnLabel: "Step 5 — Stock Opening by Location",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Steps 4–7 — Staged Migration
        </CardTitle>
        <CardDescription>
          Run each step independently, strictly in the order shown. All steps are idempotent and safe to re-run; only
          tracked rows are ever touched on rollback, and the source ERP company is never modified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => {
          const dependencyMet =
            !step.dependsOnAction ||
            model.allRuns.some(
              (run) =>
                run.action === step.dependsOnAction &&
                run.status === "completed" &&
                run.source_company_id === model.sourceCompanyId &&
                run.target_company_id === model.targetCompanyId
            );
          return (
            <Stage2StepRunner
              key={step.key}
              label={step.label}
              Icon={step.icon}
              endpoint={step.endpoint}
              sourceCompanyId={model.sourceCompanyId!}
              targetCompanyId={model.targetCompanyId!}
              sourceCompanyName={model.sourceComp?.name}
              disabled={!dependencyMet}
              disabledReason={dependencyMet ? undefined : `Run ${step.dependsOnLabel} successfully first.`}
              onDone={() => {
                model.refetchRuns();
                model.refetchPreview();
              }}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

export function GcLshiMigrationProfitAndReconciliation({ model }: { model: MigrationModel }) {
  return (
    <>
      {model.targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />
              Step 8 — Profit-share Opening
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProfitOpeningRunner targetCompanyId={model.targetCompanyId} onDone={() => model.refetchRuns()} />
          </CardContent>
        </Card>
      )}
      {model.sourceCompanyId && model.targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" />
              Step 9 — Final Reconciliation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReconciliationRunner sourceCompanyId={model.sourceCompanyId} targetCompanyId={model.targetCompanyId} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function GcLshiMigrationHistory({ model }: { model: MigrationModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCcw className="h-4 w-4" />
          Step 10 — Run History &amp; Rollback
        </CardTitle>
        <CardDescription>All migration runs. You can rollback any non-rolled-back run.</CardDescription>
      </CardHeader>
      <CardContent>
        {model.allRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="border rounded-md overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.allRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {String(run.id).slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {run.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{run.source_name}</TableCell>
                    <TableCell className="text-sm">{run.target_name}</TableCell>
                    <TableCell className="text-right text-sm">{run.rows_created}</TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(run.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {run.status !== "rolled_back" && run.status !== "running" && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => model.setRollbackRunId(run.id)}
                          disabled={model.rollbackMutation.isPending}
                          data-testid={`button-rollback-${run.id}`}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Rollback
                        </Button>
                      )}
                      {run.error_message && (
                        <p className="text-xs text-destructive mt-1">{run.error_message.slice(0, 60)}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
