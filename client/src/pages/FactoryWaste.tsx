import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface WasteEntry {
  id: number;
  date: string;
  kgWaste: number;
  reason: string | null;
  mixBatchId: number | null;
  supplierId: number | null;
  containerId: number | null;
}

function getDefaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

export default function FactoryWaste() {
  const defaults = getDefaultDateRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formKg, setFormKg] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formMixBatchId, setFormMixBatchId] = useState("");
  const [formSupplierId, setFormSupplierId] = useState("");
  const [formContainerId, setFormContainerId] = useState("");

  const wasteQuery = useQuery<WasteEntry[]>({
    queryKey: ["/api/factory/waste", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/factory/waste?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to load waste entries");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      date: string;
      kgWaste: number;
      reason?: string;
      mixBatchId?: number;
      supplierId?: number;
      containerId?: number;
    }) => {
      const res = await apiRequest("POST", "/api/factory/waste", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/waste", from, to] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/factory/waste/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/waste", from, to] });
    },
  });

  function resetForm() {
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormKg("");
    setFormReason("");
    setFormMixBatchId("");
    setFormSupplierId("");
    setFormContainerId("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      date: formDate,
      kgWaste: parseFloat(formKg),
    };
    if (formReason.trim()) payload.reason = formReason.trim();
    if (formMixBatchId) payload.mixBatchId = parseInt(formMixBatchId, 10);
    if (formSupplierId) payload.supplierId = parseInt(formSupplierId, 10);
    if (formContainerId) payload.containerId = parseInt(formContainerId, 10);
    createMutation.mutate(payload);
  }

  const totalWasteKg = wasteQuery.data
    ? wasteQuery.data.reduce((sum, entry) => sum + (entry.kgWaste || 0), 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Waste</h1>
          <p className="text-muted-foreground mt-1">Track and manage waste entries</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-44"
              data-testid="input-date-from"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-44"
              data-testid="input-date-to"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <Card className="min-w-[200px]">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Waste KG</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-total-waste-kg">
              {wasteQuery.isLoading ? "..." : totalWasteKg.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">in selected period</p>
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-waste">
              <Plus className="mr-2 h-4 w-4" />
              Add Waste Entry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Waste Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="waste-date">Date</Label>
                <Input
                  id="waste-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  data-testid="input-waste-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waste-kg">KG Waste *</Label>
                <Input
                  id="waste-kg"
                  type="number"
                  step="0.01"
                  required
                  value={formKg}
                  onChange={(e) => setFormKg(e.target.value)}
                  data-testid="input-waste-kg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waste-reason">Reason</Label>
                <Textarea
                  id="waste-reason"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  data-testid="input-waste-reason"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waste-mix-batch">Mix Batch ID (optional)</Label>
                <Input
                  id="waste-mix-batch"
                  type="number"
                  value={formMixBatchId}
                  onChange={(e) => setFormMixBatchId(e.target.value)}
                  data-testid="input-waste-mix-batch-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waste-supplier">Supplier ID (optional)</Label>
                <Input
                  id="waste-supplier"
                  type="number"
                  value={formSupplierId}
                  onChange={(e) => setFormSupplierId(e.target.value)}
                  data-testid="input-waste-supplier-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waste-container">Container ID (optional)</Label>
                <Input
                  id="waste-container"
                  type="number"
                  value={formContainerId}
                  onChange={(e) => setFormContainerId(e.target.value)}
                  data-testid="input-waste-container-id"
                />
              </div>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-waste">
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Waste Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {wasteQuery.isLoading ? (
            <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading waste entries...</span>
            </div>
          ) : !wasteQuery.data || wasteQuery.data.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground" data-testid="text-no-data">No waste entries for selected range</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>KG</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Mix Batch</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wasteQuery.data.map((entry, idx) => (
                    <TableRow key={entry.id ?? idx} data-testid={`row-waste-${entry.id}`}>
                      <TableCell className="font-mono text-sm">{entry.date}</TableCell>
                      <TableCell className="font-mono">{entry.kgWaste}</TableCell>
                      <TableCell>{entry.reason || "—"}</TableCell>
                      <TableCell className="font-mono">{entry.mixBatchId ?? "—"}</TableCell>
                      <TableCell className="font-mono">{entry.supplierId ?? "—"}</TableCell>
                      <TableCell className="font-mono">{entry.containerId ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(entry.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-waste-${entry.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
