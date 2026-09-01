/**
 * POS Import dialogs: the inventory-warning confirmation that gates an import
 * with negative-stock warnings, and the post-import print prompt carrying the
 * hidden receipt.
 *
 * Split out of POSImport.tsx unchanged, including the "Skip" path that closes
 * the prompt and navigates to /vouchers.
 */
import { AlertTriangle, Printer } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PosImportPrintTemplate } from "./PosImportPrintTemplate";
import type { PosImportModel } from "./usePosImportModel";

export function PosImportDialogs({ model }: { model: PosImportModel }) {
  return (
    <>
      <AlertDialog open={model.showWarningDialog} onOpenChange={model.setShowWarningDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Inventory Warnings
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>The following items will have inventory issues after this import:</p>
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-md border border-amber-200 dark:border-amber-800 max-h-60 overflow-y-auto">
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {model.validationResult?.warnings?.map((warning: string, index: number) => (
                    <li key={index} className="text-amber-900 dark:text-amber-100">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 font-semibold">Are you sure you want to proceed with the import?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-import">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={model.handleConfirmImport}
              data-testid="button-confirm-import"
              className="bg-amber-600 hover:bg-amber-700"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Dialog */}
      <AlertDialog open={model.showPrintDialog} onOpenChange={model.setShowPrintDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Import Successful</AlertDialogTitle>
            <AlertDialogDescription>
              Sale has been imported successfully. Would you like to print the invoice?
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Hidden Print Template - matches POS invoice style */}
          <PosImportPrintTemplate
            printRef={model.printRef}
            importedSale={model.importedSale}
            printUserName={model.printUserName}
            printCurrPrefix={model.printCurrPrefix}
            selectedCompany={model.selectedCompany}
            exchangeRate={model.exchangeRate}
            fmtPrint={model.fmtPrint}
          />

          <AlertDialogFooter>
            <Button variant="outline" onClick={model.skipPrint} data-testid="button-skip-print">
              Skip
            </Button>
            <Button onClick={model.handlePrint} className="gap-2" data-testid="button-print-imported-invoice">
              <Printer className="h-4 w-4" />
              Print Invoice
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
