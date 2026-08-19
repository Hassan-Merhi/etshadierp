/**
 * Supplier / proforma picker and export actions on the container verification
 * page, plus the barcode alias-conflict warning shown above the results.
 *
 * Split out of ContainerVerification.tsx unchanged — changing supplier still
 * clears the proforma and any existing result, and the export buttons only
 * appear once a comparison has been generated.
 */
import { AlertTriangle, Download, FileCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContainerVerificationModel } from "./useContainerVerificationModel";

export function ComparisonSetupCard({ model }: { model: ContainerVerificationModel }) {
  const { suppliers, proformas, selectedSupplierId, selectedProformaId, verificationResult } = model;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Generate Comparison</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs font-medium mb-1 block">Supplier</label>
          <Select value={selectedSupplierId} onValueChange={model.selectSupplier}>
            <SelectTrigger data-testid="select-supplier">
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.legalName || s.name || s.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Proforma</label>
          <Select value={selectedProformaId} onValueChange={model.setSelectedProformaId} disabled={!selectedSupplierId}>
            <SelectTrigger data-testid="select-proforma">
              <SelectValue placeholder={selectedSupplierId ? "Select proforma" : "Select a supplier first"} />
            </SelectTrigger>
            <SelectContent>
              {proformas.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  <span className="flex items-center gap-1.5">
                    {p.isStarred && <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />}
                    {p.reference}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {proformas.length > 0 && !proformas.some((p) => p.isStarred) && (
            <p className="text-xs text-muted-foreground mt-1">
              Tip: star a proforma on the supplier page to auto-select it here
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => model.generateComparison()}
            disabled={!selectedSupplierId || !selectedProformaId}
            className="flex-1"
            data-testid="button-generate-comparison"
          >
            <FileCheck className="mr-2 h-4 w-4" />
            Generate Comparison
          </Button>
          {verificationResult && (
            <>
              <Button variant="outline" onClick={model.exportToExcel} data-testid="button-export-excel">
                <Download className="mr-1 h-4 w-4" />
                Excel
              </Button>
              <Button variant="outline" onClick={model.exportSummaryExcel} data-testid="button-export-summary-excel">
                <Download className="mr-1 h-4 w-4" />
                Summary
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AliasConflictAlert({ model }: { model: ContainerVerificationModel }) {
  const conflicts = model.verificationResult?.aliasConflicts;
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <div
      className="mb-4 rounded-md border border-orange-500/50 bg-orange-500/10 p-3"
      data-testid="alert-alias-conflicts"
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
        <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
          {conflicts.length} barcode alias conflict
          {conflicts.length > 1 ? "s" : ""} detected — comparison below skipped these and may be incomplete
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        A barcode is registered as an alias for one item, but that exact barcode is also the item's own primary code for
        a different stock item. This can cause proforma and loaded quantities to be matched to the wrong item. Fix the
        alias in Stock Item Aliases before trusting this report.
      </p>
      <ul className="text-xs font-mono space-y-1">
        {conflicts.map((c, i) => (
          <li key={i}>
            "{c.aliasCode}" is aliased to {c.aliasedToName} ({c.aliasedToCode}), but is also the primary code of{" "}
            {c.ownerName} ({c.ownerCode})
          </li>
        ))}
      </ul>
    </div>
  );
}
