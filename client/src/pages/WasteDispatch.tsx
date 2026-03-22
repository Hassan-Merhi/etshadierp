import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Trash2,
  Search,
  Printer,
  ChevronRight,
  Loader2,
  Package,
  Weight,
  DollarSign,
  History,
  CheckSquare,
} from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function fmtKg(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

function today() {
  return new Date().toISOString().split("T")[0];
}

export default function WasteDispatch() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const [dispatchDate, setDispatchDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [printData, setPrintData] = useState<any | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const { data, isLoading } = useQuery<{ bales: any[]; categories: any[] }>({
    queryKey: ["/api/factory/waste-dispatch/bales", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      const r = await fetch(`/api/factory/waste-dispatch/bales?${params}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/waste-dispatch/history"],
    enabled: showHistory,
    queryFn: async () => {
      const r = await fetch("/api/factory/waste-dispatch/history", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const bales = data?.bales || [];

  const toggleBale = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === bales.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(bales.map((b) => b.id)));
    }
  };

  const selectedBales = bales.filter((b) => selected.has(b.id));
  const totalWeight = selectedBales.reduce((s, b) => s + b.weightKg, 0);
  const totalCost = selectedBales.reduce((s, b) => s + b.totalCost, 0);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/waste-dispatch/submit", {
        baleIds: [...selected],
        dispatchDate,
        notes: notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/waste-dispatch/bales"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/waste-dispatch/history"],
      });
      setSelected(new Set());
      setNotes("");
      setConfirming(false);
      setPrintData(result);
      toast({
        title: "Waste disposed",
        description: `${result.totalBales} bale(s) marked as disposed (${result.dispatch.dispatchNumber})`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setConfirming(false);
    },
  });

  const handlePrint = () => {
    if (!printRef.current) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Waste Disposal — ${printData?.dispatch?.dispatchNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            .sub { color: #555; font-size: 11px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
            th { background: #f3f4f6; font-weight: bold; }
            .footer { margin-top: 24px; font-size: 10px; color: #777; }
          </style>
        </head>
        <body>${printRef.current.innerHTML}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-destructive" />
            Waste Dispatch
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Select Garbage or Wiper bales to write off as waste
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowHistory((v) => !v)}
          data-testid="button-toggle-history"
          className="gap-2"
        >
          <History className="w-4 h-4" />
          {showHistory ? "Hide History" : "View History"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* History Panel */}
        {showHistory && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dispatch History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4">No dispatches yet.</p>
              ) : (
                <div className="divide-y">
                  {history.map((d: any) => (
                    <Collapsible key={d.id}>
                      <CollapsibleTrigger asChild>
                        <div
                          className="flex items-center justify-between px-4 py-3 hover-elevate cursor-pointer"
                          data-testid={`row-dispatch-${d.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium text-sm">{d.dispatchNumber}</p>
                              <p className="text-xs text-muted-foreground">{d.dispatchDate}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-muted-foreground">{d.totalBales} bales</span>
                            <span className="text-muted-foreground">
                              {fmtKg(parseFloat(d.totalWeightKg || "0"))} kg
                            </span>
                            <Badge variant="outline" className="text-destructive border-destructive/30">
                              {fmt(parseFloat(d.totalCostWrittenOff || "0"))}
                            </Badge>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="bg-muted/30 px-4 pb-3">
                          {d.notes && (
                            <p className="text-xs text-muted-foreground mb-2 pt-2">
                              Note: {d.notes}
                            </p>
                          )}
                          {d.bales && d.bales.length > 0 ? (
                            <table className="w-full text-xs mt-2">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-left py-1 font-medium">Reference</th>
                                  <th className="text-left py-1 font-medium">Product</th>
                                  <th className="text-right py-1 font-medium">Weight (kg)</th>
                                  <th className="text-right py-1 font-medium">Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.bales.map((b: any) => (
                                  <tr key={b.id}>
                                    <td className="py-0.5 font-mono">{b.referenceNumber}</td>
                                    <td className="py-0.5">{b.productName}</td>
                                    <td className="py-0.5 text-right">
                                      {fmtKg(parseFloat(b.weightKg || "0"))}
                                    </td>
                                    <td className="py-0.5 text-right">
                                      {fmt(parseFloat(b.totalCost || "0"))}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-xs text-muted-foreground pt-2">
                              No bale details available.
                            </p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dispatch Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dispatch Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Dispatch Date
                </label>
                <Input
                  type="date"
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  className="w-44"
                  data-testid="input-dispatch-date"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-48">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Notes (optional)
                </label>
                <Textarea
                  placeholder="Reason for disposal..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={1}
                  className="resize-none"
                  data-testid="input-notes"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bale Selection Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">Available Waste Bales</CardTitle>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search bales..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 w-56"
                  data-testid="input-search-bales"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : bales.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Trash2 className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="text-sm">No Garbage or Wiper bales in stock.</p>
                <p className="text-xs mt-1">
                  Only bales with Garbage or Wiper category are eligible for waste disposal.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={bales.length > 0 && selected.size === bales.length}
                        onCheckedChange={toggleAll}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bales.map((b) => (
                    <TableRow
                      key={b.id}
                      className={`cursor-pointer ${selected.has(b.id) ? "bg-destructive/5" : ""}`}
                      onClick={() => toggleBale(b.id)}
                      data-testid={`row-bale-${b.id}`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(b.id)}
                          onCheckedChange={() => toggleBale(b.id)}
                          data-testid={`checkbox-bale-${b.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.referenceNumber}</TableCell>
                      <TableCell className="text-sm">{b.productName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {b.categoryName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.locationName}
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmtKg(b.weightKg)}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(b.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Selection Summary + Dispatch Button */}
        {selected.size > 0 && (
          <Card className="border-destructive/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium" data-testid="text-selected-count">
                      {selected.size} bale{selected.size !== 1 ? "s" : ""} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Weight className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm" data-testid="text-total-weight">
                      {fmtKg(totalWeight)} kg
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <span
                      className="text-sm text-destructive font-medium"
                      data-testid="text-total-cost"
                    >
                      {fmt(totalCost)} write-off
                    </span>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                  data-testid="button-dispatch-waste"
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Dispatch Waste
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirm Dialog */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Confirm Waste Disposal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              You are about to permanently remove the following from stock as waste:
            </p>
            <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Bales</span>
                <span className="font-medium">{selected.size}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Weight</span>
                <span className="font-medium">{fmtKg(totalWeight)} kg</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cost Written Off</span>
                <span className="font-medium text-destructive">{fmt(totalCost)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">{dispatchDate}</span>
              </div>
              {notes && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Notes</span>
                  <span className="font-medium max-w-xs text-right">{notes}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              This will remove these bales from inventory and log a waste disposal expense in the
              factory daybook. This action cannot be undone.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={submitMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              data-testid="button-confirm-dispatch"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Confirm Disposal
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Receipt Dialog */}
      {printData && (
        <Dialog open={!!printData} onOpenChange={() => setPrintData(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-green-600" />
                Disposal Complete — {printData.dispatch.dispatchNumber}
              </DialogTitle>
            </DialogHeader>

            {/* Printable region */}
            <div ref={printRef} className="space-y-3">
              <div>
                <h1 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 4 }}>
                  Waste Disposal Record
                </h1>
                <p style={{ color: "#555", fontSize: 11, marginBottom: 16 }}>
                  Dispatch No: {printData.dispatch.dispatchNumber}&nbsp;|&nbsp;Date:{" "}
                  {printData.dispatch.dispatchDate}
                  {printData.dispatch.notes && <>&nbsp;|&nbsp;Note: {printData.dispatch.notes}</>}
                </p>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Reference", "Weight (kg)", "Cost Written Off"].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          border: "1px solid #ccc",
                          padding: "6px 8px",
                          background: "#f3f4f6",
                          textAlign: i === 0 ? "left" : "right",
                          fontWeight: "bold",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {printData.bales.map((b: any) => (
                    <tr key={b.id}>
                      <td style={{ border: "1px solid #ccc", padding: "5px 8px", fontFamily: "monospace" }}>
                        {b.referenceNumber}
                      </td>
                      <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>
                        {fmtKg(b.weightKg)}
                      </td>
                      <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>
                        {fmt(b.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontWeight: "bold" }}>
                      TOTAL — {printData.totalBales} bale(s)
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>
                      {fmtKg(printData.totalWeightKg)}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: "bold", color: "#dc2626" }}>
                      {fmt(printData.totalCostWrittenOff)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p style={{ marginTop: 24, fontSize: 10, color: "#777" }}>
                This document confirms the waste disposal of factory bales. A daybook expense entry has
                been created automatically.
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPrintData(null)}>
                Close
              </Button>
              <Button
                onClick={handlePrint}
                data-testid="button-print-receipt"
                className="gap-2"
              >
                <Printer className="w-4 h-4" />
                Print Receipt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
