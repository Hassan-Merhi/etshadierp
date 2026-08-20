import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Download, Package } from "lucide-react";
import { BulkRenameTab } from "../BulkRenameTab";
import type { useDataToolsModel } from "./useDataToolsModel";

type Props = {
  model: ReturnType<typeof useDataToolsModel>;
};

export function DataToolsImportDialogs({ model }: Props) {
  const {
    stockImportOpen,
    stockFile,
    stockPreview,
    stockErrors,
    isImportingStock,
    stockImportComplete,
    downloadStockTemplate,
    handleStockFileChange,
    handleStockImport,
    handleStockDialogClose,
    bulkRenameOpen,
    setBulkRenameOpen,
  } = model;

  return (
    <>
      <Dialog open={stockImportOpen} onOpenChange={handleStockDialogClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Stock from Excel</DialogTitle>
            <DialogDescription>Upload an Excel file with Item_barcode, quantity, rate, value columns</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button
              variant="outline"
              onClick={downloadStockTemplate}
              size="sm"
              data-testid="button-download-stock-template"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="stock-file">Select Excel File</Label>
              <Input
                id="stock-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleStockFileChange}
                disabled={isImportingStock || stockImportComplete}
                data-testid="input-stock-file"
              />
              {stockFile && <p className="text-sm text-muted-foreground">Selected: {stockFile.name}</p>}
            </div>
            {stockErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">{stockErrors.length} validation error(s):</div>
                  <ul className="list-disc list-inside space-y-1">
                    {stockErrors.slice(0, 5).map((error, index) => (
                      <li key={index} className="text-sm">
                        {error}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {stockPreview.length > 0 && stockErrors.length === 0 && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>{stockPreview.length} records ready to import</AlertDescription>
              </Alert>
            )}
            {stockImportComplete && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>Stock imported successfully</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleStockDialogClose} disabled={isImportingStock}>
                Close
              </Button>
              <Button
                onClick={handleStockImport}
                disabled={
                  stockPreview.length === 0 || stockErrors.length > 0 || isImportingStock || stockImportComplete
                }
                data-testid="button-submit-stock-import"
              >
                {isImportingStock ? "Importing..." : "Import Stock"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkRenameOpen} onOpenChange={setBulkRenameOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Rename Stock Items</DialogTitle>
            <DialogDescription>Find and replace text across multiple stock item names.</DialogDescription>
          </DialogHeader>
          <BulkRenameTab />
        </DialogContent>
      </Dialog>
    </>
  );
}
