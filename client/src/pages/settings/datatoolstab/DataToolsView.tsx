import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeftRight,
  Calculator,
  Database,
  Edit,
  Package,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import { MergeStockItemsLauncher } from "./components/MergeStockItemsLauncher";
import { ReconcileOTWNamesCard } from "./components/ReconcileOTWNamesCard";
import { LocationCostPriceOverride } from "./components/LocationCostPriceOverride";
import { DataToolsImportDialogs } from "./DataToolsImportDialogs";
import { SilentProductionDialog } from "./SilentProductionDialog";
import { SilentTransferDialog } from "./SilentTransferDialog";
import type { useDataToolsModel } from "./useDataToolsModel";

type Props = {
  model: ReturnType<typeof useDataToolsModel>;
};

export function DataToolsView({ model }: Props) {
  const {
    selectedCompany,
    appMode,
    stockLocationId,
    setStockLocationId,
    setStockImportOpen,
    dtCurrentUser,
    locations,
    recalculateCostsMutation,
    setSilentStep,
    setSilentValidItems,
    setSilentWarnItems,
    setSilentErrorLines,
    setSilentParseError,
    setSilentFile,
    setSilentAppliedCount,
    setSilentTransferOpen,
    setSilentProdType,
    setSilentProdLocId,
    setSilentProdItems,
    setSilentProdSearchTerm,
    setSilentProdDone,
    setSilentImportMode,
    setSilentImportPreview,
    setSilentProdOpen,
    setBulkRenameOpen,
  } = model;

  if (!selectedCompany) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <h2 className="text-2xl font-semibold">Data Tools</h2>
        </div>
        <p className="text-muted-foreground">Please select a company to access data tools.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">Data Tools</h2>
      </div>
      <p className="text-muted-foreground">Administrative utilities for bulk data operations and maintenance tasks.</p>

      {appMode === "factory" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Data
            </CardTitle>
            <CardDescription>
              Import factory data including bales, raw stock, opening balances, and production records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/factory/import">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                data-testid="button-go-to-import"
              >
                <Upload className="h-4 w-4" />
                Open Import Tool
              </button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Import Stock
            </CardTitle>
            <CardDescription>Bulk import inventory quantities from Excel file</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Location</Label>
              <Select value={stockLocationId} onValueChange={setStockLocationId}>
                <SelectTrigger data-testid="select-location-stock-import">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location: any) => (
                    <SelectItem key={location.id} value={String(location.id)}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setStockImportOpen(true)}
              disabled={!stockLocationId}
              data-testid="button-open-stock-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Stock
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fix Cost Prices
            </CardTitle>
            <CardDescription>Recalculate sales cost prices based on inventory records</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => recalculateCostsMutation.mutate()}
              disabled={recalculateCostsMutation.isPending}
              data-testid="button-fix-cost-prices"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${recalculateCostsMutation.isPending ? "animate-spin" : ""}`} />
              {recalculateCostsMutation.isPending ? "Updating..." : "Fix Cost Prices"}
            </Button>
          </CardContent>
        </Card>

        {dtCurrentUser?.role === "Developer" && appMode !== "factory" && (
          <LocationCostPriceOverride locations={locations} />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Silent Stock Transfer
            </CardTitle>
            <CardDescription>Move stock between locations via Excel upload — no daybook entry created</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSilentStep("setup");
                setSilentValidItems([]);
                setSilentWarnItems([]);
                setSilentErrorLines([]);
                setSilentParseError("");
                setSilentFile(null);
                setSilentAppliedCount(0);
                setSilentTransferOpen(true);
              }}
              data-testid="button-open-silent-transfer"
            >
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Open Silent Transfer
            </Button>
          </CardContent>
        </Card>

        {dtCurrentUser?.role === "Developer" && appMode !== "factory" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Silent Production / Consumption
              </CardTitle>
              <CardDescription>
                Directly adjust inventory up (Production) or down (Consumption) — no daybook entry, developer only
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSilentProdType("Production");
                  setSilentProdLocId("");
                  setSilentProdItems([{ stockItemId: "", stockItemName: "", quantity: "", rate: "", currentQty: 0 }]);
                  setSilentProdSearchTerm("");
                  setSilentProdDone(0);
                  setSilentImportMode(false);
                  setSilentImportPreview([]);
                  setSilentProdOpen(true);
                }}
                data-testid="button-open-silent-production"
              >
                <Package className="h-4 w-4 mr-2" />
                Open Silent Production / Consumption
              </Button>
            </CardContent>
          </Card>
        )}

        {appMode !== "factory" &&
          ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") &&
          selectedCompany && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Edit className="h-4 w-4" />
                  Bulk Rename Stock Items
                </CardTitle>
                <CardDescription className="text-xs">
                  Find and replace text across multiple stock item names at once.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setBulkRenameOpen(true)}
                  data-testid="button-open-bulk-rename"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Open Bulk Rename
                </Button>
              </CardContent>
            </Card>
          )}

        {appMode !== "factory" &&
          ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") &&
          selectedCompany && <MergeStockItemsLauncher />}

        {appMode !== "factory" &&
          ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") &&
          selectedCompany && <ReconcileOTWNamesCard />}

        {appMode === "factory" && ["Admin", "Owner", "Developer"].includes(dtCurrentUser?.role || "") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4" />
                Merge Bale Products
              </CardTitle>
              <CardDescription>
                Combine duplicate bale product entries — all bales from the selected items move to the one you keep, and
                the duplicates are deactivated
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/factory/merge-bale-products">
                <Button variant="outline" className="w-full" data-testid="button-open-merge-products">
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Open Merge Tool
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <SilentProductionDialog model={model} />
      <SilentTransferDialog model={model} />
      <DataToolsImportDialogs model={model} />
    </div>
  );
}
