/**
 * Excel import preview dialog for the container loading scanner.
 *
 * Split out of FactoryContainerLoadingScan.tsx unchanged: the mode is decided
 * by the uploaded sheet (ref-number vs article-code) and the confirm button
 * keeps its per-mode label and disabled rule.
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FactoryContainerLoadingScanModel } from "./useFactoryContainerLoadingScanModel";

function RefNumberPreview({ refNumbers }: { refNumbers: string[] }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Each bale will be looked up by its ref number or bale code and added individually.
      </p>
      <div className="border rounded-md overflow-auto max-h-[320px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Ref / Code</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refNumbers.map((ref, i) => (
              <TableRow key={i} data-testid={`row-import-ref-${i}`}>
                <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                <TableCell className="font-mono text-sm">{ref}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {refNumbers.length} bale{refNumbers.length !== 1 ? "s" : ""} by ref / bale code
      </p>
    </>
  );
}

function ArticleCodePreview({ rows }: { rows: Array<{ articleCode: string; qty: number }> }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Bales will be added oldest-first (by production date) for each article code.
      </p>
      {rows.length > 0 && (
        <div className="border rounded-md overflow-auto max-h-[320px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Article Code</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i} data-testid={`row-import-preview-${i}`}>
                  <TableCell className="font-mono text-sm">{row.articleCode}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{row.qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {rows.reduce((s, r) => s + r.qty, 0)} total bales across {rows.length} article code
        {rows.length !== 1 ? "s" : ""}
      </p>
    </>
  );
}

export function ImportBalesDialog({ model }: { model: FactoryContainerLoadingScanModel }) {
  const { importMode, importPreview, importRefNumbers, bulkImportMutation } = model;
  const isRefMode = importMode === "refNumber";
  const nothingToImport = isRefMode ? importRefNumbers.length === 0 : importPreview.length === 0;
  return (
    <Dialog
      open={model.showImportDialog}
      onOpenChange={(open) => {
        model.setShowImportDialog(open);
        if (!open) model.closeImportDialog();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Bales from Excel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Download template:</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => model.downloadTemplate("ref")}
              data-testid="button-download-ref-template"
            >
              <Download className="h-3 w-3 mr-1" />
              Ref Number
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => model.downloadTemplate("articleCode")}
              data-testid="button-download-article-template"
            >
              <Download className="h-3 w-3 mr-1" />
              Article Code
            </Button>
          </div>
          {isRefMode ? <RefNumberPreview refNumbers={importRefNumbers} /> : <ArticleCodePreview rows={importPreview} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={model.closeImportDialog} data-testid="button-cancel-import">
            Cancel
          </Button>
          <Button
            onClick={model.submitImport}
            disabled={bulkImportMutation.isPending || nothingToImport}
            data-testid="button-confirm-import"
          >
            {bulkImportMutation.isPending
              ? "Importing…"
              : isRefMode
                ? `Add ${importRefNumbers.length} Bale${importRefNumbers.length !== 1 ? "s" : ""}`
                : `Add ${importPreview.reduce((s, r) => s + r.qty, 0)} Bales`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
