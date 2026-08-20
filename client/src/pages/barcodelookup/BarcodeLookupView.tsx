import { ChevronDown, ScanLine, Search } from "lucide-react";
import { BaleWeightEditDialog } from "@/components/BaleWeightEditDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BarcodeAdminDialogs } from "./BarcodeAdminDialogs";
import { BarcodeArticleResults } from "./BarcodeArticleResults";
import { BarcodeReferenceResults } from "./BarcodeReferenceResults";
import type { useBarcodeLookupModel } from "./useBarcodeLookupModel";

type BarcodeLookupModel = ReturnType<typeof useBarcodeLookupModel>;

export function BarcodeLookupView({ model }: { model: BarcodeLookupModel }) {
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500/30 to-blue-600/10 border border-blue-500/25 shrink-0">
            <ScanLine className="h-4.5 w-4.5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Bale Lookup</h1>
            <p className="text-xs text-muted-foreground leading-tight">Search by reference number or article code</p>
          </div>
        </div>
        <div className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="Scan or type a reference (REF…) or article code…"
                value={model.searchValue}
                onChange={(event) => model.setSearchValue(event.target.value)}
                onKeyDown={model.handleKeyDown}
                className="pr-24"
                autoFocus
                data-testid="input-lookup-search"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 flex items-center gap-1 px-2 rounded-md bg-muted text-xs font-medium text-muted-foreground hover-elevate"
                onClick={() => model.setSearchMode(model.searchMode === "reference" ? "article" : "reference")}
                data-testid="button-toggle-search-mode"
                title="Click to switch between Ref # and Article Code mode"
              >
                {model.searchMode === "reference" ? "Ref #" : "Article"}
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <Button
              onClick={model.handleSearch}
              disabled={model.isLoading || !model.searchValue.trim()}
              data-testid="button-lookup-search"
            >
              <Search className="h-4 w-4 mr-1.5" />
              {model.isLoading ? "Searching…" : "Search"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Mode auto-detects: inputs starting with <span className="font-mono font-medium">REF</span> search by
            reference number, everything else by article code. Click the badge to override.
          </p>
        </div>
      </div>

      {model.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {model.articleResult && (
        <BarcodeArticleResults
          articleResult={model.articleResult}
          searchValue={model.searchValue}
          setSearchMode={model.setSearchMode}
          setSearchValue={model.setSearchValue}
          lookupReference={(referenceNumber) => model.referenceLookup.mutate(referenceNumber)}
          smartNum={model.smartNum}
        />
      )}

      {model.referenceResult && <BarcodeReferenceResults model={model} />}

      <BarcodeAdminDialogs model={model} />
      {model.AdminDialog}
      <BaleWeightEditDialog
        bale={model.weightEditBale}
        onClose={() => model.setWeightEditBale(null)}
        onSuccess={() => {
          model.setWeightEditBale(null);
          const referenceNumber = model.referenceResult?.labelPrint?.referenceNumber;
          if (referenceNumber) model.referenceLookup.mutate(referenceNumber);
        }}
      />
    </div>
  );
}
