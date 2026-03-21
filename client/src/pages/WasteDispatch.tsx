import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Trash2, Printer, AlertTriangle, Package, X, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useReactToPrint } from "react-to-print";

interface Location {
  id: number;
  name: string;
  code: string;
}

interface StockItem {
  id: number;
  name: string;
  unit: string | null;
}

interface WasteDispatchItem {
  stockItemId: number;
  quantity: string;
  stockItemName?: string;
  stockItemUnit?: string;
}

interface WasteDispatch {
  id: number;
  dispatchNumber: string;
  dispatchDate: string;
  locationId: number;
  locationName: string | null;
  notes: string | null;
  totalAmount: string;
  createdAt: string;
  items?: Array<{
    id: number;
    stockItemId: number;
    stockItemName: string | null;
    stockItemUnit: string | null;
    quantity: string;
    rate: string;
    totalAmount: string;
  }>;
}

interface PrintSlipProps {
  dispatch: WasteDispatch;
}

function PrintSlip({ dispatch }: PrintSlipProps) {
  const today = format(new Date(), "dd MMM yyyy");
  const dispatchDate = dispatch.dispatchDate
    ? format(new Date(dispatch.dispatchDate), "dd MMM yyyy")
    : "";
  const total = parseFloat(dispatch.totalAmount || "0");

  return (
    <div className="p-8 font-mono text-sm text-black bg-white min-h-screen">
      <div className="text-center border-b border-black pb-3 mb-4">
        <div className="text-xl font-bold uppercase tracking-widest">Waste Dispatch Slip</div>
        <div className="text-xs mt-1">Printed: {today}</div>
      </div>

      <div className="flex justify-between mb-4">
        <div>
          <div><span className="font-bold">Dispatch #:</span> {dispatch.dispatchNumber}</div>
          <div><span className="font-bold">Date:</span> {dispatchDate}</div>
        </div>
        <div className="text-right">
          <div><span className="font-bold">Location:</span> {dispatch.locationName || "-"}</div>
        </div>
      </div>

      {dispatch.notes && (
        <div className="mb-4 border border-black p-2">
          <span className="font-bold">Notes: </span>{dispatch.notes}
        </div>
      )}

      <table className="w-full border-collapse border border-black text-xs mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-black p-2 text-left">#</th>
            <th className="border border-black p-2 text-left">Item</th>
            <th className="border border-black p-2 text-center">Unit</th>
            <th className="border border-black p-2 text-right">Qty</th>
            <th className="border border-black p-2 text-right">Rate</th>
            <th className="border border-black p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(dispatch.items || []).map((item, idx) => (
            <tr key={item.id}>
              <td className="border border-black p-2">{idx + 1}</td>
              <td className="border border-black p-2">{item.stockItemName || "-"}</td>
              <td className="border border-black p-2 text-center">{item.stockItemUnit || "-"}</td>
              <td className="border border-black p-2 text-right">{parseFloat(item.quantity).toFixed(3)}</td>
              <td className="border border-black p-2 text-right">{parseFloat(item.rate).toFixed(2)}</td>
              <td className="border border-black p-2 text-right">{parseFloat(item.totalAmount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="border border-black p-2 text-right font-bold">Total</td>
            <td className="border border-black p-2 text-right font-bold">{total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="flex justify-between mt-12 pt-8">
        <div className="text-center">
          <div className="border-t border-black w-36 pt-1">Prepared By</div>
        </div>
        <div className="text-center">
          <div className="border-t border-black w-36 pt-1">Authorized By</div>
        </div>
      </div>
    </div>
  );
}

export default function WasteDispatch() {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [dispatchDate, setDispatchDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [locationId, setLocationId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [formItems, setFormItems] = useState<WasteDispatchItem[]>([
    { stockItemId: 0, quantity: "" },
  ]);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [printDispatch, setPrintDispatch] = useState<WasteDispatch | null>(null);

  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: stockItemsList = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: dispatches = [], isLoading: dispatchesLoading } = useQuery<WasteDispatch[]>({
    queryKey: ["/api/waste-dispatches"],
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
  });

  const openPrint = useCallback(async (dispatch: WasteDispatch) => {
    if (!dispatch.items) {
      const res = await fetch(`/api/waste-dispatches/${dispatch.id}`, { credentials: "include" });
      if (res.ok) {
        const full = await res.json();
        setPrintDispatch(full);
      } else {
        setPrintDispatch(dispatch);
      }
    } else {
      setPrintDispatch(dispatch);
    }
    setTimeout(() => handlePrint(), 200);
  }, [handlePrint]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const validItems = formItems.filter(
        (it) => it.stockItemId > 0 && parseFloat(it.quantity) > 0
      );
      if (!locationId) throw new Error("Please select a location");
      if (validItems.length === 0) throw new Error("Add at least one item with quantity");

      const res = await apiRequest("POST", "/api/waste-dispatches", {
        locationId: parseInt(locationId),
        dispatchDate,
        notes: notes.trim() || undefined,
        items: validItems.map((it) => ({
          stockItemId: it.stockItemId,
          quantity: it.quantity,
        })),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create dispatch");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste-dispatches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Waste dispatch created successfully" });
      setShowForm(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/waste-dispatches/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete dispatch");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste-dispatches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Dispatch deleted and inventory reversed" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setDeleteId(null);
    },
  });

  function resetForm() {
    setLocationId("");
    setDispatchDate(format(new Date(), "yyyy-MM-dd"));
    setNotes("");
    setFormItems([{ stockItemId: 0, quantity: "" }]);
  }

  function addRow() {
    setFormItems((prev) => [...prev, { stockItemId: 0, quantity: "" }]);
  }

  function removeRow(idx: number) {
    setFormItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof WasteDispatchItem, value: string | number) {
    setFormItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it))
    );
  }

  const totalQty = formItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0), 0);

  return (
    <div className="flex flex-col gap-4 p-4 max-w-5xl mx-auto">
      {/* Hidden print area */}
      <div className="hidden print:block" ref={printRef}>
        {printDispatch && <PrintSlip dispatch={printDispatch} />}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Waste Bale Dispatch</h1>
          <p className="text-sm text-muted-foreground">
            Record waste bale dispatches with automatic inventory deduction and expense accounting
          </p>
        </div>
        <Button
          data-testid="button-new-dispatch"
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
          variant={showForm ? "outline" : "default"}
        >
          {showForm ? (
            <><X className="w-4 h-4 mr-1" />Cancel</>
          ) : (
            <><Plus className="w-4 h-4 mr-1" />New Dispatch</>
          )}
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Waste Dispatch</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dispatch-location">Location</Label>
                {locationsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select
                    value={locationId}
                    onValueChange={setLocationId}
                  >
                    <SelectTrigger id="dispatch-location" data-testid="select-dispatch-location">
                      <SelectValue placeholder="Select location..." />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dispatch-date">Date</Label>
                <Input
                  id="dispatch-date"
                  data-testid="input-dispatch-date"
                  type="date"
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                <Label htmlFor="dispatch-notes">Notes (optional)</Label>
                <Input
                  id="dispatch-notes"
                  data-testid="input-dispatch-notes"
                  placeholder="e.g. Yard waste bales"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Items */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <Button size="sm" variant="outline" onClick={addRow} data-testid="button-add-item">
                  <Plus className="w-3 h-3 mr-1" />Add Item
                </Button>
              </div>

              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Stock Item</TableHead>
                      <TableHead className="w-36">Quantity</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formItems.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell>
                          <Select
                            value={item.stockItemId > 0 ? String(item.stockItemId) : ""}
                            onValueChange={(v) => updateRow(idx, "stockItemId", parseInt(v))}
                          >
                            <SelectTrigger data-testid={`select-item-stock-${idx}`}>
                              <SelectValue placeholder="Select item..." />
                            </SelectTrigger>
                            <SelectContent>
                              {stockItemsList.map((si) => (
                                <SelectItem key={si.id} value={String(si.id)}>
                                  {si.name}{si.unit ? ` (${si.unit})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            placeholder="0.000"
                            value={item.quantity}
                            onChange={(e) => updateRow(idx, "quantity", e.target.value)}
                            data-testid={`input-item-qty-${idx}`}
                          />
                        </TableCell>
                        <TableCell>
                          {formItems.length > 1 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeRow(idx)}
                              data-testid={`button-remove-item-${idx}`}
                            >
                              <X className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="text-sm text-muted-foreground text-right">
                Total items: {formItems.filter((it) => it.stockItemId > 0).length} &nbsp;|&nbsp; Total qty: {totalQty.toFixed(3)}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowForm(false); resetForm(); }}
              >
                Cancel
              </Button>
              <Button
                data-testid="button-submit-dispatch"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Saving..." : "Create Dispatch"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Dispatch History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dispatchesLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : dispatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Package className="w-8 h-8 opacity-40" />
              <p className="text-sm">No waste dispatches yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dispatch #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatches.map((d) => (
                  <TableRow key={d.id} data-testid={`row-dispatch-${d.id}`}>
                    <TableCell className="font-mono text-sm font-medium">{d.dispatchNumber}</TableCell>
                    <TableCell className="text-sm">
                      {d.dispatchDate ? format(new Date(d.dispatchDate), "dd MMM yyyy") : "-"}
                    </TableCell>
                    <TableCell className="text-sm">{d.locationName || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.notes || "-"}</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {parseFloat(d.totalAmount || "0").toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openPrint(d)}
                          title="Print dispatch slip"
                          data-testid={`button-print-${d.id}`}
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteId(d.id)}
                          title="Delete & reverse dispatch"
                          data-testid={`button-delete-${d.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Delete Waste Dispatch
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the dispatch and reverse the inventory changes.
              The waste expense accounting entry will also be reversed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete & Reverse"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
