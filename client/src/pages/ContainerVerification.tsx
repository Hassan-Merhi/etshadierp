import { ArrowLeft, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useContainerVerificationModel } from "./containerverification/useContainerVerificationModel";
import { LoadedItemsCard } from "./containerverification/LoadedItemsCard";
import { AliasConflictAlert, ComparisonSetupCard } from "./containerverification/ComparisonSetupCard";
import { ComparisonCards } from "./containerverification/ComparisonCards";
import { ComparisonSummaryCards } from "./containerverification/ComparisonSummaryCards";

export default function ContainerVerification() {
  const model = useContainerVerificationModel();
  return (
    <div className="flex flex-col h-full p-4 lg:p-6 overflow-y-auto">
      <input ref={model.fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={model.handleFileImport} />
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => model.navigate(`/containers/${model.containerId}`)} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <PageHeader
            title="Container Verification"
            subtitle={`${model.container?.containerNumber || `Container #${model.containerId}`} - Proforma vs Loaded Items`}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <LoadedItemsCard model={model} />
        <ComparisonSetupCard model={model} />
      </div>
      {model.verificationResult && (
        <>
          <AliasConflictAlert model={model} />
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant={model.viewMode === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => model.setViewMode(model.viewMode === "summary" ? "detailed" : "summary")}
              className="toggle-elevate"
              data-testid="button-toggle-summary"
            >
              <List className="mr-1.5 h-3.5 w-3.5" />
              {model.viewMode === "summary" ? "Hide Summary" : "Show Summary"}
            </Button>
          </div>
          <ComparisonCards model={model} />
          {model.viewMode === "summary" && <ComparisonSummaryCards model={model} />}
        </>
      )}
    </div>
  );
}
