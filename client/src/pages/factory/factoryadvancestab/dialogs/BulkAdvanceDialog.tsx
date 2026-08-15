/**
 * BulkAdvanceDialog — extracted from AdvancesView.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt } from "../utils";

export function BulkAdvanceDialog({
  bulkAmounts,
  bulkForm,
  bulkMutation,
  bulkOpen,
  bulkSelected,
  cashAccounts,
  setBulkAmounts,
  setBulkForm,
  setBulkOpen,
  setBulkSelected,
  workers,
}: {
  bulkAmounts: unknown;
  bulkForm: unknown;
  bulkMutation: unknown;
  bulkOpen: unknown;
  bulkSelected: unknown;
  cashAccounts: unknown;
  setBulkAmounts: unknown;
  setBulkForm: unknown;
  setBulkOpen: unknown;
  setBulkSelected: unknown;
  workers: unknown;
}) {
  return (
    <Dialog
      open={bulkOpen}
      onOpenChange={(open) => {
        if (!open) {
          setBulkOpen(false);
          setBulkAmounts({});
          setBulkSelected(new Set());
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Advance</DialogTitle>
          <DialogDescription>Record advances for multiple workers at once</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Shared fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={bulkForm.advanceDate}
                onChange={(e) => setBulkForm((p: unknown) => ({ ...p, advanceDate: e.target.value }))}
                data-testid="input-bulk-advance-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Cash Account</Label>
              <Select
                value={bulkForm.cashAccountId}
                onValueChange={(v) => setBulkForm((p: unknown) => ({ ...p, cashAccountId: v }))}
              >
                <SelectTrigger data-testid="select-bulk-cash-account">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {(cashAccounts || []).map((a: unknown) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Repayment Type</Label>
              <Select
                value={bulkForm.repaymentType}
                onValueChange={(v) => setBulkForm((p: unknown) => ({ ...p, repaymentType: v }))}
              >
                <SelectTrigger data-testid="select-bulk-repayment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary_deduction">Deduct from Salary</SelectItem>
                  <SelectItem value="manual_repayment">Manual Repayment (Loan)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                placeholder="Optional notes for all"
                value={bulkForm.notes}
                onChange={(e) => setBulkForm((p: unknown) => ({ ...p, notes: e.target.value }))}
                data-testid="input-bulk-notes"
              />
            </div>
          </div>

          {/* Worker table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Workers & Amounts</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkSelected(new Set((workers || []).map((w: unknown) => w.id)))}
                  data-testid="button-bulk-select-all"
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkSelected(new Set())}
                  data-testid="button-bulk-deselect-all"
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="w-40">Amount ($)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(workers || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No workers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    (workers || []).map((w: unknown) => {
                      const selected = bulkSelected.has(w.id);
                      return (
                        <TableRow
                          key={w.id}
                          className={`cursor-pointer hover-elevate ${selected ? "bg-primary/5" : ""}`}
                          onClick={() =>
                            setBulkSelected((prev: unknown) => {
                              const next = new Set(prev);
                              if (next.has(w.id)) next.delete(w.id);
                              else next.add(w.id);
                              return next;
                            })
                          }
                          data-testid={`row-bulk-worker-${w.id}`}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() =>
                                setBulkSelected((prev: unknown) => {
                                  const next = new Set(prev);
                                  if (next.has(w.id)) next.delete(w.id);
                                  else next.add(w.id);
                                  return next;
                                })
                              }
                              data-testid={`checkbox-bulk-worker-${w.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{w.fullName}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              className="h-8 text-sm"
                              value={bulkAmounts[w.id] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBulkAmounts((prev: unknown) => ({ ...prev, [w.id]: val }));
                                if (val && parseFloat(val) > 0) {
                                  setBulkSelected((prev: unknown) => {
                                    const n = new Set(prev);
                                    n.add(w.id);
                                    return n;
                                  });
                                }
                              }}
                              data-testid={`input-bulk-amount-${w.id}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {bulkSelected.size > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                {
                  Array.from(bulkSelected as Set<string>).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0)
                    .length
                }{" "}
                worker(s) with valid amounts
                {" — "}Total:{" "}
                {fmt(
                  Array.from(bulkSelected as Set<string>).reduce(
                    (s: number, wid) => s + parseFloat(bulkAmounts[wid] || "0"),
                    0
                  )
                )}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(false)} data-testid="button-cancel-bulk-advance">
            Cancel
          </Button>
          <Button
            onClick={() => bulkMutation.mutate()}
            disabled={
              bulkMutation.isPending ||
              Array.from(bulkSelected as Set<string>).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0)
                .length === 0
            }
            data-testid="button-submit-bulk-advance"
          >
            {bulkMutation.isPending
              ? "Saving..."
              : `Record ${Array.from(bulkSelected as Set<string>).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0).length || ""} Advance(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
