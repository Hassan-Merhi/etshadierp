/**
 * POS Import page shell.
 *
 * Keeps its route and default export. The parse/validate/import pipeline,
 * CFA→USD conversion and print snapshot live in
 * ./posimport/usePosImportModel; the upload form, validation errors, preview
 * table, print receipt and dialogs are separate views under ./posimport.
 */
import { CreditCard, Download, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePosImportModel } from "./posimport/usePosImportModel";
import { PosImportForm } from "./posimport/PosImportForm";
import { PosImportPreview, PosImportValidationErrors } from "./posimport/PosImportResults";
import { PosImportDialogs } from "./posimport/PosImportDialogs";

export default function POSImport() {
  const model = usePosImportModel();
  const { isCreditSale } = model;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            {isCreditSale ? <CreditCard className="h-8 w-8" /> : <ShoppingCart className="h-8 w-8" />}
            {isCreditSale ? "Credit Sales Import" : "POS Import"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Import {isCreditSale ? "credit" : "cash"} sales transactions from Excel (Barcode, Quantity, Selling Rate)
          </p>
        </div>
        <Button variant="outline" onClick={model.downloadTemplate} data-testid="button-download-template">
          <Download className="h-4 w-4 mr-2" />
          Download Template
        </Button>
      </div>

      <PosImportForm model={model} />
      <PosImportValidationErrors model={model} />
      <PosImportPreview model={model} />
      <PosImportDialogs model={model} />
    </div>
  );
}
