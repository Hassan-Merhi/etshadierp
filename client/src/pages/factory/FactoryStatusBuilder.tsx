import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Plus, Save, Eye, Settings2, Edit3, Trash2, AlertTriangle, Clock, Link2, Calculator, GripVertical, Beaker } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "view" | "edit" | "manual";

interface Template  { id: number; companyId: number; name: string; }
interface Metric {
  id: number; templateId: number; name: string;
  beforeSourceType: string; sourceType: string; sourceField: string;
  operation: string; filtersJson: Record<string, unknown>; sortOrder: number;
}
interface MetricValue {
  id: number; runId: number; metricId: number;
  beforeValue: string; linkedValue: string; manualAdjustment: string;
  difference: string; finalTotal: string; warningsJson: string[];
  lastRefreshed: string | null;
}
interface Run { id: number; templateId: number; companyId: number; runDate: string; }

// ─── Label maps ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  production: "Production Sheet",
  stock_in:   "Stock In",
  gate:       "In / Out Gate",
  manual:     "Manual Only",
};
const OP_LABELS: Record<string, string> = {
  sum: "Sum", count: "Count", average: "Average", in_minus_out: "In minus Out",
};
const FIELD_LABELS: Record<string, string> = {
  quantity: "Quantity", total: "Total", amount: "Amount",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? "0")) || 0;
}

function fmtVal(v: string | number | null | undefined): string {
  const num = n(v);
  const abs = formatNumber(Math.abs(num), 2);
  return num < 0 ? `(${abs})` : abs;
}

function relTime(ts: string | null): string {
  if (!ts) return "Never";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60)   return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Add / Edit Metric Dialog ─────────────────────────────────────────────────

interface MetricDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  metric?: Metric | null;
  templateId: number;
  onSave: (data: Partial<Metric>) => void;
  saving: boolean;
}

function MetricDialog({ open, onOpenChange, metric, templateId, onSave, saving }: MetricDialogProps) {
  const blank = { name: "", beforeSourceType: "manual", sourceType: "production", sourceField: "quantity", operation: "sum" };
  const [form, setForm] = useState(blank);

  useEffect(() => {
    setForm(metric
      ? { name: metric.name, beforeSourceType: metric.beforeSourceType, sourceType: metric.sourceType, sourceField: metric.sourceField, operation: metric.operation }
      : blank
    );
  }, [metric, open]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{metric ? "Edit Metric" : "Add Metric"}</DialogTitle>
          <DialogDescription>
            {metric ? "Update the configuration for this metric." : "Configure a new metric for this status report."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Metric Name</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Production, Stock In…" data-testid="input-metric-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Before Value Source</Label>
            <Select value={form.beforeSourceType} onValueChange={v => set("beforeSourceType", v)}>
              <SelectTrigger data-testid="select-before-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Entry</SelectItem>
                <SelectItem value="previous_closing">Previous Status Closing Total</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Source Page / Sheet</Label>
            <Select value={form.sourceType} onValueChange={v => set("sourceType", v)}>
              <SelectTrigger data-testid="select-source-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="stock_in">Stock In</SelectItem>
                <SelectItem value="gate">In / Out Gate</SelectItem>
                <SelectItem value="manual">Manual Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.sourceType !== "manual" && (
            <>
              <div className="space-y-1.5">
                <Label>Field to Pull</Label>
                <Select value={form.sourceField} onValueChange={v => set("sourceField", v)}>
                  <SelectTrigger data-testid="select-source-field"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quantity">Quantity</SelectItem>
                    <SelectItem value="total">Total</SelectItem>
                    <SelectItem value="amount">Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Operation</Label>
                <Select value={form.operation} onValueChange={v => set("operation", v)}>
                  <SelectTrigger data-testid="select-operation"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sum">Sum</SelectItem>
                    <SelectItem value="count">Count</SelectItem>
                    <SelectItem value="average">Average</SelectItem>
                    <SelectItem value="in_minus_out">In minus Out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-metric">Cancel</Button>
          <Button onClick={() => onSave({ ...form, templateId })} disabled={saving || !form.name.trim()} data-testid="button-save-metric">
            {saving ? "Saving…" : metric ? "Update Metric" : "Add Metric"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Metric Card (View Mode) ──────────────────────────────────────────────────

interface MetricCardProps {
  metric: Metric;
  value: MetricValue | undefined;
  manualEdit: string;
  beforeEdit: string;
  onManualChange: (v: string) => void;
  onBeforeChange: (v: string) => void;
  readOnly?: boolean;
}

function MetricCard({ metric, value, manualEdit, beforeEdit, onManualChange, onBeforeChange, readOnly }: MetricCardProps) {
  const beforeVal  = beforeEdit  !== "" ? (parseFloat(beforeEdit)  || 0) : n(value?.beforeValue);
  const linkedVal  = n(value?.linkedValue);
  const manualVal  = manualEdit  !== "" ? (parseFloat(manualEdit)  || 0) : n(value?.manualAdjustment);
  const difference = linkedVal + manualVal;
  const finalTotal = beforeVal + difference;
  const isManualOnly = metric.sourceType === "manual";
  const warnings = value?.warningsJson ?? [];

  return (
    <Card className={warnings.length > 0 ? "border-amber-500/40" : ""} data-testid={`card-metric-${metric.id}`}>
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="text-base">{metric.name}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Link2 className="h-3 w-3 shrink-0" />
            {isManualOnly
              ? "Manual only — no linked source"
              : `${SOURCE_LABELS[metric.sourceType]} · ${OP_LABELS[metric.operation]} of ${FIELD_LABELS[metric.sourceField]}`
            }
          </p>
        </div>
        {warnings.length > 0 && (
          <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/40 gap-1 shrink-0">
            <AlertTriangle className="h-3 w-3" /> Warning
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {/* Before */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Before</p>
            {readOnly
              ? <p className="font-medium tabular-nums" data-testid={`text-before-${metric.id}`}>{fmtVal(value?.beforeValue)}</p>
              : <Input type="number" value={beforeEdit !== "" ? beforeEdit : (value?.beforeValue ?? "0")} onChange={e => onBeforeChange(e.target.value)} className="h-8 text-sm" data-testid={`input-before-${metric.id}`} />
            }
          </div>
          {/* Linked */}
          {!isManualOnly && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Linked Value</p>
              <p className="font-medium tabular-nums text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded text-xs" data-testid={`text-linked-${metric.id}`}>
                {fmtVal(linkedVal)} <span className="opacity-60">(auto)</span>
              </p>
            </div>
          )}
          {/* Manual Adjustment */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Manual Adjustment</p>
            {readOnly
              ? <p className="font-medium tabular-nums" data-testid={`text-manual-${metric.id}`}>{fmtVal(value?.manualAdjustment)}</p>
              : <Input type="number" value={manualEdit} onChange={e => onManualChange(e.target.value)} placeholder="0" className="h-8 text-sm" data-testid={`input-manual-${metric.id}`} />
            }
          </div>
          {/* Difference */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Difference</p>
            <p className={`font-semibold tabular-nums ${difference >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`} data-testid={`text-diff-${metric.id}`}>
              {difference >= 0 ? "+" : ""}{fmtVal(difference)}
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Final Total</p>
            <p className="text-xl font-bold tabular-nums" data-testid={`text-final-${metric.id}`}>{fmtVal(finalTotal)}</p>
          </div>
          {value?.lastRefreshed && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              <Clock className="h-3 w-3" /> Refreshed {relTime(value.lastRefreshed)}
            </p>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2 space-y-0.5">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{w}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Empty state placeholder ──────────────────────────────────────────────────

function EmptyMetrics({ onAdd }: { onAdd?: () => void }) {
  return (
    <Card>
      <CardContent className="py-14 text-center text-muted-foreground">
        <Calculator className="h-10 w-10 mx-auto mb-3 opacity-25" />
        <p className="font-medium">No metrics configured</p>
        <p className="text-sm mt-1">Switch to Edit Links mode to add metrics.</p>
        {onAdd && (
          <Button variant="outline" className="mt-4" onClick={onAdd} data-testid="button-go-to-edit">
            <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Edit Links
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FactoryStatusBuilder() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const companyId = selectedCompany?.id;

  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [mode, setMode]                 = useState<Mode>("view");
  const [showAdd, setShowAdd]           = useState(false);
  const [editingMetric, setEditingMetric]   = useState<Metric | null>(null);
  const [deleteTarget, setDeleteTarget]     = useState<Metric | null>(null);

  // Local edits: metricId → string
  const [manualEdits, setManualEdits] = useState<Record<number, string>>({});
  const [beforeEdits, setBeforeEdits] = useState<Record<number, string>>({});

  // Reset local edits when date changes
  useEffect(() => { setManualEdits({}); setBeforeEdits({}); }, [selectedDate]);

  // ── Template ──────────────────────────────────────────────────────────────
  const templateQ = useQuery<Template>({
    queryKey: ["/api/factory/status-builder/template", companyId],
    queryFn: async () => {
      const r = await fetch(`/api/factory/status-builder/template?companyId=${companyId}`);
      if (!r.ok) throw new Error("Failed to load template");
      return r.json();
    },
    enabled: !!companyId,
  });
  const template = templateQ.data;

  // ── Metrics ───────────────────────────────────────────────────────────────
  const metricsQ = useQuery<Metric[]>({
    queryKey: ["/api/factory/status-builder/metrics", template?.id],
    queryFn: async () => {
      const r = await fetch(`/api/factory/status-builder/templates/${template!.id}/metrics`);
      if (!r.ok) throw new Error("Failed to load metrics");
      return r.json();
    },
    enabled: !!template?.id,
  });
  const metrics = metricsQ.data ?? [];

  // ── Run + values ──────────────────────────────────────────────────────────
  const runQ = useQuery<{ run: Run; values: MetricValue[] }>({
    queryKey: ["/api/factory/status-builder/run", template?.id, selectedDate],
    queryFn: async () => {
      const r = await fetch(`/api/factory/status-builder/run?templateId=${template!.id}&date=${selectedDate}`);
      if (!r.ok) throw new Error("Failed to load run");
      return r.json();
    },
    enabled: !!template?.id,
  });
  const run    = runQ.data?.run;
  const values = runQ.data?.values ?? [];

  const valueFor = (metricId: number) => values.find(v => v.metricId === metricId);

  const invalidateRun     = () => queryClient.invalidateQueries({ queryKey: ["/api/factory/status-builder/run"] });
  const invalidateMetrics = () => queryClient.invalidateQueries({ queryKey: ["/api/factory/status-builder/metrics"] });

  // ── Refresh mutation ──────────────────────────────────────────────────────
  const refreshM = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/factory/status-builder/runs/${run!.id}/refresh`, {});
      return r.json();
    },
    onSuccess: () => { invalidateRun(); toast({ title: "Linked data refreshed" }); },
    onError:   (e: any) => toast({ title: "Refresh failed", description: e?.message, variant: "destructive" }),
  });

  // ── Save manual entries mutation ──────────────────────────────────────────
  const saveM = useMutation({
    mutationFn: async () => {
      const entries = metrics.map(m => ({
        metricId:         m.id,
        manualAdjustment: parseFloat(manualEdits[m.id] ?? String(valueFor(m.id)?.manualAdjustment ?? "0")) || 0,
        beforeValue:      parseFloat(beforeEdits[m.id] ?? String(valueFor(m.id)?.beforeValue      ?? "0")) || 0,
      }));
      const r = await apiRequest("PATCH", `/api/factory/status-builder/runs/${run!.id}/values`, { entries });
      return r.json();
    },
    onSuccess: () => {
      invalidateRun();
      setManualEdits({});
      setBeforeEdits({});
      toast({ title: "Saved", description: "Manual entries saved successfully." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  // ── Add metric mutation ───────────────────────────────────────────────────
  const addM = useMutation({
    mutationFn: async (data: Partial<Metric>) => {
      const r = await apiRequest("POST", "/api/factory/status-builder/metrics", { ...data, sortOrder: metrics.length });
      return r.json();
    },
    onSuccess: () => { invalidateMetrics(); invalidateRun(); setShowAdd(false); toast({ title: "Metric added" }); },
    onError:   (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  // ── Edit metric mutation ──────────────────────────────────────────────────
  const editM = useMutation({
    mutationFn: async (data: Partial<Metric>) => {
      const r = await apiRequest("PATCH", `/api/factory/status-builder/metrics/${editingMetric!.id}`, data);
      return r.json();
    },
    onSuccess: () => { invalidateMetrics(); invalidateRun(); setEditingMetric(null); toast({ title: "Metric updated" }); },
    onError:   (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  // ── Delete metric mutation ────────────────────────────────────────────────
  const deleteM = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/factory/status-builder/metrics/${id}`, {}); },
    onSuccess: () => { invalidateMetrics(); invalidateRun(); setDeleteTarget(null); toast({ title: "Metric deleted" }); },
    onError:   (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const hasEdits = Object.keys(manualEdits).length > 0 || Object.keys(beforeEdits).length > 0;
  const isLoading = templateQ.isLoading || metricsQ.isLoading || runQ.isLoading;

  if (!companyId) {
    return <div className="p-8 text-center text-muted-foreground">Select a company to use the Status Builder.</div>;
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Page header */}
      <div>
        <div className="flex items-center gap-2.5">
          <Beaker className="h-5 w-5 text-orange-500" />
          <h1 className="text-2xl font-bold">Factory Status Builder</h1>
          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
            <Beaker className="h-3 w-3" /> Experimental
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Build custom status reports with linked data sources. Old Factory Sheets are unchanged.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground shrink-0">Date</Label>
          <Input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="w-44"
            data-testid="input-status-date"
          />
        </div>

        <Tabs value={mode} onValueChange={v => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="view"   className="gap-1.5" data-testid="tab-view-mode">  <Eye       className="h-3.5 w-3.5" /> View         </TabsTrigger>
            <TabsTrigger value="edit"   className="gap-1.5" data-testid="tab-edit-mode">  <Settings2 className="h-3.5 w-3.5" /> Edit Links   </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5" data-testid="tab-manual-mode"><Edit3     className="h-3.5 w-3.5" /> Manual Entry </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshM.mutate()}
            disabled={!run || refreshM.isPending}
            data-testid="button-refresh-linked"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshM.isPending ? "animate-spin" : ""}`} />
            {refreshM.isPending ? "Refreshing…" : "Refresh Linked Data"}
          </Button>

          {mode !== "edit" && (
            <Button
              size="sm"
              onClick={() => saveM.mutate()}
              disabled={!run || saveM.isPending}
              data-testid="button-save-entries"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {saveM.isPending ? "Saving…" : hasEdits ? "Save Changes" : "Save Manual Entries"}
            </Button>
          )}

          {mode === "edit" && (
            <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-metric">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Metric
            </Button>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="h-52 flex items-center justify-center">
                <div className="animate-pulse space-y-3 w-full px-4">
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                  <div className="h-8 bg-muted rounded" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── VIEW MODE ─────────────────────────────────────────────────── */}
      {!isLoading && mode === "view" && (
        metrics.length === 0
          ? <EmptyMetrics onAdd={() => setMode("edit")} />
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map(m => (
                <MetricCard
                  key={m.id}
                  metric={m}
                  value={valueFor(m.id)}
                  manualEdit={manualEdits[m.id] ?? ""}
                  beforeEdit={beforeEdits[m.id] ?? ""}
                  onManualChange={v => setManualEdits(p => ({ ...p, [m.id]: v }))}
                  onBeforeChange={v => setBeforeEdits(p => ({ ...p, [m.id]: v }))}
                />
              ))}
            </div>
      )}

      {/* ── EDIT LINKS MODE ───────────────────────────────────────────── */}
      {!isLoading && mode === "edit" && (
        <div className="space-y-3">
          {metrics.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center text-muted-foreground">
                <Link2 className="h-10 w-10 mx-auto mb-3 opacity-25" />
                <p className="font-medium">No metrics yet</p>
                <p className="text-sm mt-1">Click "Add Metric" to create your first metric.</p>
              </CardContent>
            </Card>
          ) : (
            metrics.map(m => {
              const v = valueFor(m.id);
              return (
                <Card key={m.id} data-testid={`card-edit-metric-${m.id}`}>
                  <CardHeader className="pb-2 flex flex-row items-start gap-3 flex-wrap">
                    <GripVertical className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base">{m.name}</CardTitle>
                      <CardDescription className="text-sm mt-0.5">
                        Before: {m.beforeSourceType === "manual" ? "Manual entry" : "Previous closing total"}
                        {" · "}Source: {SOURCE_LABELS[m.sourceType]}
                        {m.sourceType !== "manual" && ` · ${FIELD_LABELS[m.sourceField]} · ${OP_LABELS[m.operation]}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs gap-1">
                        <Link2 className="h-3 w-3" /> {SOURCE_LABELS[m.sourceType]}
                      </Badge>
                      <Button size="icon" variant="ghost" onClick={() => setEditingMetric(m)} data-testid={`button-edit-metric-${m.id}`}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(m)} data-testid={`button-delete-metric-${m.id}`}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-4 gap-3 text-xs bg-muted/30 rounded-md px-3 py-2">
                      {[
                        { label: "Before",     val: v?.beforeValue,      cls: "" },
                        { label: "Linked",     val: v?.linkedValue,      cls: "text-blue-600 dark:text-blue-400" },
                        { label: "Difference", val: v?.difference,       cls: "" },
                        { label: "Final Total",val: v?.finalTotal,       cls: "font-semibold" },
                      ].map(({ label, val, cls }) => (
                        <div key={label}>
                          <p className="font-medium text-foreground mb-0.5">{label}</p>
                          <p className={`tabular-nums text-muted-foreground ${cls}`}>{fmtVal(val)}</p>
                        </div>
                      ))}
                    </div>
                    {(v?.warningsJson ?? []).length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-2">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {v!.warningsJson[0]}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ── MANUAL ENTRY MODE ─────────────────────────────────────────── */}
      {!isLoading && mode === "manual" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the Before value and any Manual Adjustment below. Linked values and calculations are read-only.
          </p>
          {metrics.length === 0
            ? <EmptyMetrics />
            : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {metrics.map(m => {
                    const v          = valueFor(m.id);
                    const linkedVal  = n(v?.linkedValue);
                    const beforeVal  = beforeEdits[m.id] !== undefined ? (parseFloat(beforeEdits[m.id]) || 0) : n(v?.beforeValue);
                    const manualVal  = manualEdits[m.id] !== undefined ? (parseFloat(manualEdits[m.id]) || 0) : n(v?.manualAdjustment);
                    const difference = linkedVal + manualVal;
                    const finalTotal = beforeVal + difference;
                    const warnings   = v?.warningsJson ?? [];

                    return (
                      <Card key={m.id} data-testid={`card-manual-metric-${m.id}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{m.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-muted-foreground text-sm shrink-0">Before Value</Label>
                              <Input
                                type="number"
                                value={beforeEdits[m.id] ?? String(v?.beforeValue ?? "0")}
                                onChange={e => setBeforeEdits(p => ({ ...p, [m.id]: e.target.value }))}
                                className="h-8 w-32 text-sm text-right"
                                data-testid={`input-before-manual-${m.id}`}
                              />
                            </div>
                            {m.sourceType !== "manual" && (
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-muted-foreground text-sm shrink-0">Linked Value</Label>
                                <span className="text-xs tabular-nums font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded" data-testid={`text-linked-manual-${m.id}`}>
                                  {fmtVal(linkedVal)} <span className="opacity-60">(auto)</span>
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-muted-foreground text-sm shrink-0">Manual Adjustment</Label>
                              <Input
                                type="number"
                                value={manualEdits[m.id] ?? String(v?.manualAdjustment ?? "0")}
                                onChange={e => setManualEdits(p => ({ ...p, [m.id]: e.target.value }))}
                                className="h-8 w-32 text-sm text-right"
                                data-testid={`input-manual-entry-${m.id}`}
                              />
                            </div>
                          </div>

                          <Separator />

                          <div className="flex items-end justify-between">
                            <div>
                              <p className="text-xs text-muted-foreground">Difference</p>
                              <p className={`text-sm font-medium tabular-nums ${difference >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                                {difference >= 0 ? "+" : ""}{fmtVal(difference)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Final Total</p>
                              <p className="text-xl font-bold tabular-nums" data-testid={`text-final-manual-${m.id}`}>{fmtVal(finalTotal)}</p>
                            </div>
                          </div>

                          {warnings.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0" /> Source data warning
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <div className="flex justify-end pt-2">
                  <Button onClick={() => saveM.mutate()} disabled={!run || saveM.isPending} data-testid="button-save-manual-bottom">
                    <Save className="h-4 w-4 mr-2" />
                    {saveM.isPending ? "Saving…" : "Save Manual Entries"}
                  </Button>
                </div>
              </>
            )
          }
        </div>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────────── */}
      <MetricDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        templateId={template?.id ?? 0}
        onSave={data => addM.mutate(data)}
        saving={addM.isPending}
      />
      <MetricDialog
        open={!!editingMetric}
        onOpenChange={o => { if (!o) setEditingMetric(null); }}
        metric={editingMetric}
        templateId={template?.id ?? 0}
        onSave={data => editM.mutate(data)}
        saving={editM.isPending}
      />
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Metric</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteTarget?.name}"? All saved values for this metric will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteM.mutate(deleteTarget.id)} data-testid="button-confirm-delete">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
