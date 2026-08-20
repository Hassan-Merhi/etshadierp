/**
 * Import preview dialog for the POS Price List bulk price upload.
 *
 * Split out of POSPriceList.tsx unchanged: the dialog stays locked while an
 * upload is in flight, item rows still span their per-location changes, and
 * only the first 200 items are rendered with the same overflow note.
 */
import { AlertCircle, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PosPriceListModel } from "./usePosPriceListModel";

export function PriceListImportDialog({ model }: { model: PosPriceListModel }) {
  const { importPreview, importError, importing } = model;
  return (
    <Dialog
      open={model.importDialogOpen}
      onOpenChange={(open) => {
        if (!importing) {
          model.setImportDialogOpen(open);
          if (!open) model.closeImportDialog();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Import Price List Preview
          </DialogTitle>
        </DialogHeader>

        {importError && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{importError}</AlertDescription>
          </Alert>
        )}

        {importPreview.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              Ready to update <span className="font-semibold text-foreground">{importPreview.length} items</span> across{" "}
              <span className="font-semibold text-foreground">
                {new Set(importPreview.flatMap((r) => r.changes.map((c) => c.locationId))).size} location(s)
              </span>
              . Review the changes below before confirming.
            </p>
            <ScrollArea className="h-72 rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">New Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importPreview.slice(0, 200).flatMap((item) =>
                    item.changes.map((c, i) => (
                      <TableRow key={`${item.barcode}-${c.locationId}`}>
                        {i === 0 ? (
                          <>
                            <TableCell className="font-mono text-xs" rowSpan={item.changes.length}>
                              {item.barcode}
                            </TableCell>
                            <TableCell className="text-sm" rowSpan={item.changes.length}>
                              {item.name}
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {c.locationName}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{c.price}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {importPreview.length > 200 && (
                <p className="text-xs text-muted-foreground text-center py-2">Showing first 200 items…</p>
              )}
            </ScrollArea>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={model.closeImportDialog}
            disabled={importing}
            data-testid="button-import-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={model.handleImportSubmit}
            disabled={importing || importPreview.length === 0}
            data-testid="button-import-confirm"
          >
            {importing ? "Uploading…" : `Confirm Upload (${importPreview.length} items)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
