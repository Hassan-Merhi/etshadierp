import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ClipboardCheck, Save, Search, Target, UserPlus, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { factoryApiRequest } from "@/lib/factoryApi";
import { queryClient } from "@/lib/queryClient";

type TrackingMode = "production" | "attendance";
type PeriodType = "daily" | "weekly" | "monthly";
type TrackingStatus = "Present" | "Absent" | "New";
type PersonType = "worker" | "employee";

interface TrackingRow {
  personType: PersonType;
  personId: number;
  name: string;
  code: string | null;
  category: string;
  targetBales: number | null;
  producedBales: number | null;
  status: TrackingStatus;
  notes: string;
  active: boolean;
}

interface TrackingResponse {
  page: TrackingMode;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  rows: TrackingRow[];
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function periodFor(type: PeriodType, referenceDate: string) {
  const d = parseLocalDate(referenceDate);
  if (type === "daily") return { start: referenceDate, end: referenceDate };
  if (type === "monthly") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: localDateStr(start), end: localDateStr(end) };
  }
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: localDateStr(start), end: localDateStr(end) };
}

function statusClass(status: TrackingStatus) {
  if (status === "Absent") return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300";
  if (status === "New") return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
}

function differenceText(target: number | null, produced: number | null) {
  if (target === null || produced === null) return "—";
  const diff = produced - target;
  return diff > 0 ? `+${diff}` : String(diff);
}

function differenceClass(target: number | null, produced: number | null) {
  if (target === null || produced === null) return "text-muted-foreground";
  const diff = produced - target;
  if (diff > 0) return "text-emerald-600 dark:text-emerald-400";
  if (diff < 0) return "text-red-600 dark:text-red-400";
  return "text-foreground";
}

function SummaryTile({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

export function FactoryStaffTracking({ mode }: { mode: TrackingMode }) {
  const { toast } = useToast();
  const [periodType, setPeriodType] = useState<PeriodType>("daily");
  const [referenceDate, setReferenceDate] = useState(() => localDateStr(new Date()));
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const period = useMemo(() => periodFor(periodType, referenceDate), [periodType, referenceDate]);

  const { data, isLoading, isFetching } = useQuery<TrackingResponse>({
    queryKey: ["/api/factory/staff-tracking", mode, periodType, period.start, period.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: mode,
        periodType,
        periodStart: period.start,
        periodEnd: period.end,
      });
      const res = await factoryApiRequest("GET", `/api/factory/staff-tracking?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load factory tracking data");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) setRows(data.rows);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", "/api/factory/staff-tracking/bulk", {
        page: mode,
        periodType,
        periodStart: period.start,
        periodEnd: period.end,
        records: rows.map((row) => ({
          personType: row.personType,
          personId: row.personId,
          category: row.category,
          targetBales: mode === "production" ? row.targetBales : null,
          producedBales: mode === "production" ? row.producedBales : null,
          status: row.status,
          notes: mode === "attendance" ? row.notes : "",
        })),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save factory tracking data");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/staff-tracking"] });
      toast({
        title: mode === "production" ? "Production targets saved" : "Attendance register saved",
        description: `${period.start}${period.end !== period.start ? ` to ${period.end}` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const visibleRows = rows.filter((row) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return row.name.toLowerCase().includes(needle) || row.category.toLowerCase().includes(needle) || (row.code || "").toLowerCase().includes(needle);
  });

  const totals = useMemo(() => {
    const target = rows.reduce((sum, row) => sum + (row.targetBales ?? 0), 0);
    const produced = rows.reduce((sum, row) => sum + (row.producedBales ?? 0), 0);
    return {
      target,
      produced,
      difference: produced - target,
      present: rows.filter((row) => row.status === "Present").length,
      absent: rows.filter((row) => row.status === "Absent").length,
      newCount: rows.filter((row) => row.status === "New").length,
    };
  }, [rows]);

  const setRow = (index: number, patch: Partial<TrackingRow>) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const markAllPresent = () => setRows((current) => current.map((row) => ({ ...row, status: "Present" })));

  const title = mode === "production" ? "Production Targets" : "Attendance Register";
  const subtitle = mode === "production"
    ? "Set bale targets, record production and see the difference by worker category."
    : "Organize factory staff by category, mark Present / Absent / New, and add notes.";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {mode === "production" ? <Target className="h-5 w-5 text-primary" /> : <ClipboardCheck className="h-5 w-5 text-primary" />}
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Period</p>
            <Select value={periodType} onValueChange={(value) => setPeriodType(value as PeriodType)}>
              <SelectTrigger className="w-[130px]" data-testid={`select-${mode}-period-type`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Reference date</p>
            <Input type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} className="w-[155px]" />
          </div>
          {mode === "attendance" && (
            <Button variant="outline" onClick={markAllPresent} disabled={rows.length === 0}>Mark all present</Button>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={rows.length === 0 || saveMutation.isPending} data-testid={`button-save-${mode}`}>
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <CalendarDays className="mr-1.5 inline h-3.5 w-3.5" />
        {period.start}{period.end !== period.start ? ` — ${period.end}` : ""}
        {isFetching && !isLoading ? " · Refreshing…" : ""}
      </div>

      {mode === "production" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="Total Target" value={totals.target} icon={<Target className="h-5 w-5" />} />
          <SummaryTile label="Bales Produced" value={totals.produced} icon={<CheckCircle2 className="h-5 w-5" />} />
          <SummaryTile label="Difference" value={totals.difference > 0 ? `+${totals.difference}` : totals.difference} icon={<ClipboardCheck className="h-5 w-5" />} />
          <SummaryTile label="People" value={rows.length} icon={<Users className="h-5 w-5" />} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="Total People" value={rows.length} icon={<Users className="h-5 w-5" />} />
          <SummaryTile label="Present" value={totals.present} icon={<CheckCircle2 className="h-5 w-5" />} />
          <SummaryTile label="Absent" value={totals.absent} icon={<XCircle className="h-5 w-5" />} />
          <SummaryTile label="New" value={totals.newCount} icon={<UserPlus className="h-5 w-5" />} />
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or category..." className="pl-9" />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="min-w-[220px]">Person</TableHead>
              <TableHead className="min-w-[180px]">Category</TableHead>
              {mode === "production" && <TableHead className="w-[130px] text-right">Target</TableHead>}
              {mode === "production" && <TableHead className="w-[130px] text-right">Produced</TableHead>}
              {mode === "production" && <TableHead className="w-[120px] text-right">Difference</TableHead>}
              <TableHead className="w-[145px]">Status</TableHead>
              {mode === "attendance" && <TableHead className="min-w-[260px]">Notes</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={mode === "production" ? 6 : 4} className="py-12 text-center text-muted-foreground">Loading factory staff…</TableCell></TableRow>
            ) : visibleRows.length === 0 ? (
              <TableRow><TableCell colSpan={mode === "production" ? 6 : 4} className="py-12 text-center text-muted-foreground">No matching factory staff.</TableCell></TableRow>
            ) : (
              visibleRows.map((row) => {
                const sourceIndex = rows.findIndex((item) => item.personType === row.personType && item.personId === row.personId);
                return (
                  <TableRow key={`${row.personType}-${row.personId}`} className={!row.active ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{row.personType === "worker" ? "Worker" : "Employee"}</span>
                        {row.code && <span>· {row.code}</span>}
                        {!row.active && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Inactive</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input value={row.category} onChange={(e) => setRow(sourceIndex, { category: e.target.value })} placeholder="Category / station" />
                    </TableCell>
                    {mode === "production" && (
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="text-right tabular-nums"
                          value={row.targetBales ?? ""}
                          onChange={(e) => setRow(sourceIndex, { targetBales: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                      </TableCell>
                    )}
                    {mode === "production" && (
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="text-right tabular-nums"
                          value={row.producedBales ?? ""}
                          onChange={(e) => setRow(sourceIndex, { producedBales: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                      </TableCell>
                    )}
                    {mode === "production" && (
                      <TableCell className={`text-right font-semibold tabular-nums ${differenceClass(row.targetBales, row.producedBales)}`}>
                        {differenceText(row.targetBales, row.producedBales)}
                      </TableCell>
                    )}
                    <TableCell>
                      <Select value={row.status} onValueChange={(value) => setRow(sourceIndex, { status: value as TrackingStatus })}>
                        <SelectTrigger className="w-[125px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Present">Present</SelectItem>
                          <SelectItem value="Absent">Absent</SelectItem>
                          <SelectItem value="New">New</SelectItem>
                        </SelectContent>
                      </Select>
                      <Badge className={`mt-1.5 border-0 ${statusClass(row.status)}`}>{row.status}</Badge>
                    </TableCell>
                    {mode === "attendance" && (
                      <TableCell>
                        <Input value={row.notes} onChange={(e) => setRow(sourceIndex, { notes: e.target.value })} placeholder="Notes" />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
