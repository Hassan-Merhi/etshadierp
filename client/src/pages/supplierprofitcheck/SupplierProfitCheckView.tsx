import { BarChart2, Loader2 } from "lucide-react";
import { SupplierProfitCheckDialogs } from "./SupplierProfitCheckDialogs";
import { SupplierProfitCheckFilters } from "./SupplierProfitCheckFilters";
import { SupplierProfitCheckSetup } from "./SupplierProfitCheckSetup";
import { SupplierProfitCheckTable } from "./SupplierProfitCheckTable";
import type { useSupplierProfitCheckModel } from "./useSupplierProfitCheckModel";

type ProfitModel = ReturnType<typeof useSupplierProfitCheckModel>;

export function SupplierProfitCheckView({ model }: { model: ProfitModel }) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-full p-4 space-y-3">
        <SupplierProfitCheckSetup model={model} />
        <SupplierProfitCheckFilters model={model} />
        <SupplierProfitCheckTable model={model} />
        {!model.supplierId && (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="p-5 rounded-2xl bg-muted/60"><BarChart2 className="w-10 h-10 text-muted-foreground opacity-50" /></div>
            <div><p className="font-semibold text-base">Select a supplier to begin</p><p className="text-sm text-muted-foreground mt-1">Choose a supplier from the panel above to load its items</p></div>
          </div>
        )}
        {model.isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /><p className="text-sm text-muted-foreground">Calculating profitability…</p></div>
        )}
      </div>
      <SupplierProfitCheckDialogs model={model} />
    </div>
  );
}
