import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Check, CheckCircle, RotateCcw, Wrench } from "lucide-react";
import type { FinalizePreview } from "./types";

interface PendingInvoiceDialogsProps {
  showApproveDialog: boolean;
  setShowApproveDialog: (open: boolean) => void;
  approveNotes: string;
  setApproveNotes: (value: string) => void;
  verifyPending: boolean;
  onVerify: (notes: string) => void;
  showReturnDialog: boolean;
  setShowReturnDialog: (open: boolean) => void;
  returnPending: boolean;
  onReturn: () => void;
  showFinalizePreview: boolean;
  setShowFinalizePreview: (open: boolean) => void;
  finalizePreview: FinalizePreview | null;
  finalizePending: boolean;
  onFinalize: () => void;
  showFixBalesDialog: boolean;
  setShowFixBalesDialog: (open: boolean) => void;
  onFixBales: () => void;
}

export function PendingInvoiceDialogs(props: PendingInvoiceDialogsProps) {
  return (
    <>
      <Dialog open={props.showApproveDialog} onOpenChange={props.setShowApproveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve & Verify Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will mark the order as VERIFIED. You can add optional notes below.
            </p>
            <Textarea
              value={props.approveNotes}
              onChange={(event) => props.setApproveNotes(event.target.value)}
              placeholder="Optional notes..."
              data-testid="input-approve-notes"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => props.setShowApproveDialog(false)}
                data-testid="button-cancel-approve"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  props.onVerify(props.approveNotes);
                  props.setShowApproveDialog(false);
                }}
                disabled={props.verifyPending}
                data-testid="button-confirm-approve"
              >
                <Check className="mr-2 h-4 w-4" />
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.showReturnDialog} onOpenChange={props.setShowReturnDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return to Loading</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will return the order back to the loading stage. Are you sure?
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => props.setShowReturnDialog(false)}
                data-testid="button-cancel-return"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  props.onReturn();
                  props.setShowReturnDialog(false);
                }}
                disabled={props.returnPending}
                data-testid="button-confirm-return"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Confirm Return
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.showFinalizePreview} onOpenChange={props.setShowFinalizePreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finalize Invoice Preview</DialogTitle>
          </DialogHeader>
          {props.finalizePreview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Bales in order:</span>{" "}
                  <span className="font-semibold" data-testid="text-preview-total">
                    {props.finalizePreview.totalBalesInOrder}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Will be removed from stock:</span>{" "}
                  <span className="font-semibold" data-testid="text-preview-removable">
                    {props.finalizePreview.baleCount}
                  </span>
                </div>
              </div>

              {props.finalizePreview.baleCount > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Weight (kg)</TableHead>
                        <TableHead>Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {props.finalizePreview.bales.slice(0, 50).map((bale) => (
                        <TableRow key={bale.id} data-testid={`row-preview-bale-${bale.id}`}>
                          <TableCell className="font-mono text-sm">{bale.baleReference}</TableCell>
                          <TableCell className="text-sm">{bale.productName}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{bale.weightKg.toFixed(2)}</TableCell>
                          <TableCell className="text-sm">{bale.locationName}</TableCell>
                        </TableRow>
                      ))}
                      {props.finalizePreview.bales.length > 50 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                            ...and {props.finalizePreview.bales.length - 50} more bales
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-preview-none">
                  No bales are currently in stock for this order. They may have already been marked as SOLD.
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => props.setShowFinalizePreview(false)}
                  data-testid="button-cancel-finalize"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    props.setShowFinalizePreview(false);
                    props.onFinalize();
                  }}
                  disabled={props.finalizePending}
                  data-testid="button-confirm-finalize"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Confirm & Finalize
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={props.showFixBalesDialog} onOpenChange={props.setShowFixBalesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix Bale Statuses</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all bales attached to this order as SOLD, removing them from inventory. Use this only if
              bales were accidentally returned to stock after a previous finalization. This does not create invoices or
              customer balance entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-fix-bales">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={props.onFixBales} data-testid="button-confirm-fix-bales">
              <Wrench className="mr-2 h-4 w-4" />
              Fix Bale Statuses
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
