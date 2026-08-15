import { getErrorDetails } from "@shared/errorUtils";
/**
 * MergeStockItemsCard — extracted sub-component.
 *
 * Extracted from DataToolsTab.tsx during the Phase 4 god-file split.
 */
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { StockItemAutocomplete } from "@/components/StockItemAutocomplete";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Loader2, AlertTriangle, Eye, ArrowLeftRight } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";

import type { MergePreviewResult } from "../types";

export function MergeStockItemsCard({ embedded }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [keptItem, setKeptItem] = useState<{ id: number; name: string } | null>(null);
  const [dupItem, setDupItem] = useState<{ id: number; name: string } | null>(null);
  const [preview, setPreview] = useState<MergePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isMerging, setIsMerging] = useState(false);

  const { data: allStockItems = [] } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/stock-items/light", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  async function handlePreview() {
    if (!keptItem || !dupItem) return;
    setPreview(null);
    setPreviewError(null);
    setConfirmText("");
    setIsLoadingPreview(true);
    try {
      const res = await fetch(`/api/stock-items/${keptItem.id}/merge-preview?duplicateId=${dupItem.id}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Preview failed");
      setPreview(data);
    } catch (err) {
      setPreviewError(getErrorDetails(err).message);
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleMerge() {
    if (!keptItem || !dupItem || confirmText !== "MERGE") return;
    setIsMerging(true);
    try {
      const res = await apiRequest("POST", `/api/stock-items/${keptItem.id}/merge`, {
        duplicateId: dupItem.id,
        confirm: "MERGE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Merge failed");
      }
      toast({ title: "Merge complete", description: `"${dupItem.name}" has been merged into "${keptItem.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items/light"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      setKeptItem(null);
      setDupItem(null);
      setPreview(null);
      setConfirmText("");
      setPreviewError(null);
    } catch (err) {
      toast({ title: "Merge failed", description: getErrorDetails(err).message, variant: "destructive" });
    } finally {
      setIsMerging(false);
    }
  }

  return (
    <Card className="col-span-1 md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          Merge Duplicate Stock Items
        </CardTitle>
        <CardDescription>
          Combine two stock items into one. Inventory quantities and values are preserved exactly to the cent.
          Historical transaction rows are not rewritten in this phase.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Item to keep</Label>
            <StockItemAutocomplete
              value={keptItem}
              onChange={(id, name) => {
                setKeptItem({ id, name });
                setPreview(null);
                setPreviewError(null);
                setConfirmText("");
              }}
              stockItems={allStockItems}
              placeholder="Search item to keep..."
              testId="merge-keep-item"
            />
          </div>
          <div className="space-y-2">
            <Label>Duplicate to merge away</Label>
            <StockItemAutocomplete
              value={dupItem}
              onChange={(id, name) => {
                setDupItem({ id, name });
                setPreview(null);
                setPreviewError(null);
                setConfirmText("");
              }}
              stockItems={allStockItems}
              placeholder="Search duplicate item..."
              testId="merge-dup-item"
            />
          </div>
        </div>

        <Button
          variant="outline"
          onClick={handlePreview}
          disabled={!keptItem || !dupItem || isLoadingPreview}
          data-testid="button-merge-preview"
        >
          {isLoadingPreview ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
          Preview Merge
        </Button>

        {previewError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-3">
            {preview.uomMismatch && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  UOM mismatch — kept item is <strong>{preview.keptItem.uom}</strong>, duplicate is{" "}
                  <strong>{preview.duplicateItem.uom}</strong>. This merge is blocked in Phase 1.
                </AlertDescription>
              </Alert>
            )}
            {preview.warnings.map((w, i) => (
              <Alert key={i}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Keep Qty</TableHead>
                    <TableHead className="text-right">Dup Qty</TableHead>
                    <TableHead className="text-right">Combined Qty</TableHead>
                    <TableHead className="text-right">Combined Rate</TableHead>
                    <TableHead className="text-right">Combined Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.inventoryImpact.map((row) => (
                    <TableRow key={row.locationId} data-testid={`row-merge-impact-${row.locationId}`}>
                      <TableCell>{row.locationName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.keptQty, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.dupQty, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatNumber(row.combinedQty, 3)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.combinedRate, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.combinedValue, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>
                Total value before:{" "}
                <strong className="text-foreground tabular-nums">{formatNumber(preview.totalValueBefore, 2)}</strong>
              </span>
              <span>
                Total value after:{" "}
                <strong className="text-foreground tabular-nums">{formatNumber(preview.totalValueAfter, 2)}</strong>
              </span>
            </div>

            {!preview.uomMismatch && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm text-muted-foreground">
                  This action cannot be undone. Type <strong>MERGE</strong> to confirm.
                </p>
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type MERGE"
                    className="max-w-[160px]"
                    data-testid="input-merge-confirm"
                  />
                  <Button
                    onClick={handleMerge}
                    disabled={confirmText !== "MERGE" || isMerging}
                    data-testid="button-confirm-merge"
                  >
                    {isMerging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Confirm Merge
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bulk Merge Stock Items Card ───────────────────────────────────────────────
