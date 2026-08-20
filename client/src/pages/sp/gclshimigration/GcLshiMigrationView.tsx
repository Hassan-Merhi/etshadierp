import { GcLshiMigrationAccountPlan, GcLshiMigrationOpeningBalance } from "./GcLshiMigrationAccounts";
import { GcLshiMigrationDialogs } from "./GcLshiMigrationDialogs";
import {
  GcLshiMigrationHistory,
  GcLshiMigrationProfitAndReconciliation,
  GcLshiMigrationStages,
} from "./GcLshiMigrationExecution";
import {
  GcLshiMigrationAccess,
  GcLshiMigrationCompanySelection,
  GcLshiMigrationHeader,
  GcLshiMigrationPreview,
} from "./GcLshiMigrationSetup";
import type { useGcLshiMigrationModel } from "./useGcLshiMigrationModel";

type MigrationModel = ReturnType<typeof useGcLshiMigrationModel>;

export function GcLshiMigrationView({ model }: { model: MigrationModel }) {
  if (model.roleLoading || model.sessionRole?.role !== "Developer") return <GcLshiMigrationAccess model={model} />;
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <GcLshiMigrationHeader />
      <GcLshiMigrationCompanySelection model={model} />
      <GcLshiMigrationPreview model={model} />
      <GcLshiMigrationAccountPlan model={model} />
      <GcLshiMigrationOpeningBalance model={model} />
      <GcLshiMigrationStages model={model} />
      <GcLshiMigrationProfitAndReconciliation model={model} />
      <GcLshiMigrationHistory model={model} />
      <GcLshiMigrationDialogs model={model} />
    </div>
  );
}
