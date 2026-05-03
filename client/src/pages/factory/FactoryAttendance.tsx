import { useState, useEffect, useCallback } from "react";
import * as XLSX from "@/lib/excelHelper";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  CheckCircle,
  XCircle,
  RotateCcw,
  Save,
  Printer,
  FileDown,
  Users,
  UserCheck,
  UserX,
  Clock,
  User,
  Languages,
  ChevronsUpDown,
  Check,
  ChevronDown,
} from "lucide-react";

type AttendanceStatus = "Present" | "Absent" | "Late" | "Half Day" | "Leave";
type ViewMode = "daily" | "perWorker";

interface WorkerRow {
  id: number;
  fullName: string;
  employeeCode: string | null;
  department: string | null;
  position: string | null;
  shiftType: string | null;
  active?: boolean;
}

interface AttendanceRecord {
  id: number;
  workerId: number;
  attendanceDate: string;
  shift: string | null;
  status: string;
  notes: string | null;
}

const STATUS_OPTIONS: AttendanceStatus[] = ["Present", "Absent", "Late", "Half Day", "Leave"];

const STATUS_COLORS: Record<string, string> = {
  Present: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Absent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  Late: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Half Day": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Leave: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

// Format a Date as YYYY-MM-DD using local time (not UTC) to avoid
// timezone-shift bugs where toISOString() returns the previous day in UTC+ zones.
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  return localDateStr(new Date());
}

function currentMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function currentMonthEnd() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return localDateStr(last);
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cur <= endDate) {
    dates.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function getInitialMode(): ViewMode {
  const p = new URLSearchParams(window.location.search);
  return p.get("mode") === "perWorker" ? "perWorker" : "daily";
}

function setModeInUrl(mode: ViewMode) {
  const url = new URL(window.location.href);
  if (mode === "daily") {
    url.searchParams.delete("mode");
  } else {
    url.searchParams.set("mode", mode);
  }
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryAttendance() {
  const { toast } = useToast();
  const [mode, setMode] = useState<ViewMode>(getInitialMode);

  const handleSetMode = (m: ViewMode) => {
    setMode(m);
    setModeInUrl(m);
  };

  // ── Daily view state ──────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
  const [shift, setShift] = useState<string>("");

  // ── Range export state ────────────────────────────────────────
  const [rangeStart, setRangeStart] = useState<string>(todayStr());
  const [rangeEnd, setRangeEnd] = useState<string>(todayStr());
  const [isExportingRange, setIsExportingRange] = useState(false);
  const [rangePrintDialog, setRangePrintDialog] = useState<"excel" | "print" | null>(null);
  const [attendanceMap, setAttendanceMap] = useState<Record<number, AttendanceStatus>>({});
  const [notesMap, setNotesMap] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<{ workers: WorkerRow[]; attendance: AttendanceRecord[] }>({
    queryKey: [`/api/factory/attendance?date=${selectedDate}`],
  });

  useEffect(() => {
    if (!data) return;
    const newMap: Record<number, AttendanceStatus> = {};
    const newNotes: Record<number, string> = {};
    for (const w of data.workers) {
      newMap[w.id] = "Present";
    }
    for (const a of data.attendance) {
      newMap[a.workerId] = a.status as AttendanceStatus;
      newNotes[a.workerId] = a.notes || "";
    }
    setAttendanceMap(newMap);
    setNotesMap(newNotes);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (records: any[]) =>
      apiRequest("POST", "/api/factory/attendance/bulk", { records }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/attendance?date=${selectedDate}`] });
      toast({ title: "Attendance saved", description: `Saved for ${selectedDate}` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = useCallback(() => {
    if (!data?.workers.length) return;
    const records = data.workers.map((w) => ({
      workerId: w.id,
      attendanceDate: selectedDate,
      shift: shift || undefined,
      status: attendanceMap[w.id] ?? "Present",
      notes: notesMap[w.id] || undefined,
    }));
    saveMutation.mutate(records);
  }, [data, selectedDate, shift, attendanceMap, notesMap, saveMutation]);

  const markAll = (status: AttendanceStatus) => {
    if (!data?.workers) return;
    const next: Record<number, AttendanceStatus> = {};
    for (const w of data.workers) next[w.id] = status;
    setAttendanceMap(next);
  };

  const reset = () => {
    if (!data?.workers) return;
    const next: Record<number, AttendanceStatus> = {};
    for (const w of data.workers) next[w.id] = "Present";
    setAttendanceMap(next);
    setNotesMap({});
  };

  const setStatus = (workerId: number, status: AttendanceStatus) => {
    setAttendanceMap((prev) => ({ ...prev, [workerId]: status }));
  };

  const setNotes = (workerId: number, notes: string) => {
    setNotesMap((prev) => ({ ...prev, [workerId]: notes }));
  };

  const handleRangeExport = async (lang: "en" | "ar", mode: "excel" | "print") => {
    if (!rangeStart || !rangeEnd) return;
    setIsExportingRange(true);
    setRangePrintDialog(null);
    try {
      const res = await fetch(
        `/api/factory/attendance/range?startDate=${rangeStart}&endDate=${rangeEnd}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch range data");
      const { workers: rangeWorkers, attendance: rangeAttendance } = await res.json();
      const dates = generateDateRange(rangeStart, rangeEnd);
      if (mode === "excel") {
        exportRangeExcel(rangeWorkers, rangeAttendance, dates, rangeStart, rangeEnd, lang);
      } else {
        // Print should only show active workers — inactive ones have no records
        // and would incorrectly default to "Present" for every day.
        const activeOnly = (rangeWorkers as WorkerRow[]).filter((w) => w.active !== false);
        const html = generateRangePrintHtml(activeOnly, rangeAttendance, dates, rangeStart, rangeEnd, lang);
        openPrintWindow(html);
      }
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setIsExportingRange(false);
    }
  };

  const [printDialog, setPrintDialog] = useState<"blank" | "results" | "excel-blank" | "excel-results" | null>(null);

  const openPrintWindow = (html: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const handlePrintWithLang = (lang: "en" | "ar") => {
    const weekDays = getWeekDays(selectedDate);
    if (printDialog === "blank") {
      // Print only active workers — inactive ones should not appear
      const html = generateWeeklyBlankSheetHtml(workers, weekDays, shift, lang);
      openPrintWindow(html);
    } else if (printDialog === "results") {
      const html = generateWeeklyResultsSheetHtml(
        workers,           // active workers only
        attendanceMap,
        notesMap,
        weekDays,
        selectedDate,
        shift,
        lang
      );
      openPrintWindow(html);
    } else if (printDialog === "excel-blank") {
      exportWeeklyExcel(data?.workers ?? [], weekDays, shift, lang, "blank", {}, {}, selectedDate);
    } else if (printDialog === "excel-results") {
      exportWeeklyExcel(data?.workers ?? [], weekDays, shift, lang, "results", attendanceMap, notesMap, selectedDate);
    }
    // Note: data?.workers now contains all workers (active + inactive);
    // exportWeeklyExcel splits them into two sheets internally.
    setPrintDialog(null);
  };

  // All workers (active + inactive) — used only by the Excel export
  const allWorkers = data?.workers ?? [];
  // UI only shows active workers in the attendance grid, sorted by employee code (HMD001, HMD002…)
  const workers = [...allWorkers.filter((w) => w.active !== false)].sort((a, b) => {
    const codeA = a.employeeCode ?? "";
    const codeB = b.employeeCode ?? "";
    if (!codeA && !codeB) return a.fullName.localeCompare(b.fullName);
    if (!codeA) return 1;
    if (!codeB) return -1;
    // Extract trailing numeric portion for natural sort (HMD001 < HMD002 < HMD010)
    const numA = parseInt(codeA.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(codeB.replace(/\D/g, ""), 10) || 0;
    if (numA !== numB) return numA - numB;
    return codeA.localeCompare(codeB);
  });

  const counts = {
    total: workers.length,
    present: workers.filter((w) => (attendanceMap[w.id] ?? "Present") === "Present").length,
    absent: workers.filter((w) => attendanceMap[w.id] === "Absent").length,
    other: workers.filter((w) => {
      const s = attendanceMap[w.id] ?? "Present";
      return s !== "Present" && s !== "Absent";
    }).length,
  };

  return (
    <div className="space-y-4 p-1">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === "daily" ? "default" : "outline"}
          size="default"
          data-testid="button-mode-daily"
          onClick={() => handleSetMode("daily")}
        >
          <CalendarDays className="h-4 w-4 mr-2" />
          Daily View
        </Button>
        <Button
          variant={mode === "perWorker" ? "default" : "outline"}
          size="default"
          data-testid="button-mode-per-worker"
          onClick={() => handleSetMode("perWorker")}
        >
          <User className="h-4 w-4 mr-2" />
          Per Worker
        </Button>
      </div>

      {mode === "perWorker" ? (
        <PerWorkerView />
      ) : (
        <>
          {/* Filters + Actions */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="attendance-date" className="text-xs text-muted-foreground">
                    Attendance Date
                  </Label>
                  <Input
                    id="attendance-date"
                    data-testid="input-attendance-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="shift-input" className="text-xs text-muted-foreground">
                    Shift (optional)
                  </Label>
                  <Input
                    id="shift-input"
                    data-testid="input-shift"
                    placeholder="e.g. Morning"
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    className="w-36"
                    dir="auto"
                  />
                </div>

                <div className="flex gap-2 ml-auto items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="default"
                        data-testid="button-actions-dropdown"
                        disabled={!workers.length}
                      >
                        Actions
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        data-testid="menu-mark-all-present"
                        onClick={() => markAll("Present")}
                      >
                        <UserCheck className="h-4 w-4 mr-2" />
                        Mark All Present
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-mark-all-absent"
                        onClick={() => markAll("Absent")}
                      >
                        <UserX className="h-4 w-4 mr-2" />
                        Mark All Absent
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-reset"
                        onClick={reset}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reset
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid="menu-print-blank"
                        onClick={() => setPrintDialog("blank")}
                      >
                        <Printer className="h-4 w-4 mr-2" />
                        Print Blank Sheet
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-export-excel-blank"
                        onClick={() => setPrintDialog("excel-blank")}
                      >
                        <FileDown className="h-4 w-4 mr-2" />
                        Blank Excel
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-export-pdf"
                        onClick={() => setPrintDialog("results")}
                      >
                        <Printer className="h-4 w-4 mr-2" />
                        Export PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="menu-export-excel"
                        onClick={() => setPrintDialog("excel-results")}
                      >
                        <FileDown className="h-4 w-4 mr-2" />
                        Export Excel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="default"
                    data-testid="button-save-attendance"
                    onClick={handleSave}
                    disabled={!workers.length || saveMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {saveMutation.isPending ? "Saving…" : "Save Attendance"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Range Export Card */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground font-medium">Range Export</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <Input
                        type="date"
                        data-testid="input-range-start"
                        value={rangeStart}
                        onChange={(e) => setRangeStart(e.target.value)}
                        className="w-40"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <Input
                        type="date"
                        data-testid="input-range-end"
                        value={rangeEnd}
                        onChange={(e) => setRangeEnd(e.target.value)}
                        className="w-40"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 items-center flex-wrap ml-auto">
                  <Button
                    variant="outline"
                    size="default"
                    data-testid="button-range-export-excel"
                    onClick={() => setRangePrintDialog("excel")}
                    disabled={!rangeStart || !rangeEnd || isExportingRange}
                  >
                    <FileDown className="h-4 w-4 mr-1" />
                    {isExportingRange ? "Exporting…" : "Export Range Excel"}
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    data-testid="button-range-print"
                    onClick={() => setRangePrintDialog("print")}
                    disabled={!rangeStart || !rangeEnd || isExportingRange}
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print Range
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          {workers.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard icon={<Users className="h-4 w-4" />} label="Total" value={counts.total} color="text-foreground" testId="stat-total" />
              <SummaryCard icon={<CheckCircle className="h-4 w-4" />} label="Present" value={counts.present} color="text-green-600 dark:text-green-400" testId="stat-present" />
              <SummaryCard icon={<XCircle className="h-4 w-4" />} label="Absent" value={counts.absent} color="text-red-600 dark:text-red-400" testId="stat-absent" />
              <SummaryCard icon={<Clock className="h-4 w-4" />} label="Other" value={counts.other} color="text-amber-600 dark:text-amber-400" testId="stat-other" />
            </div>
          )}

          {/* Attendance Table */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                Workers — {formatDate(selectedDate)}
                {shift && <Badge variant="secondary">{shift}</Badge>}
              </CardTitle>
              {workers.length > 0 && (
                <span className="text-sm text-muted-foreground">{workers.length} worker{workers.length !== 1 ? "s" : ""}</span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-md" />
                  ))}
                </div>
              ) : workers.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  No active workers found for this company.
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-30 bg-muted/50">
                        <tr className="border-b bg-muted/40">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground w-8">#</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground w-24">Code</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Worker Name</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground w-44">Status</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workers.map((worker, idx) => {
                          const status = attendanceMap[worker.id] ?? "Present";
                          return (
                            <tr
                              key={worker.id}
                              data-testid={`row-worker-${worker.id}`}
                              className="border-b last:border-0 hover-elevate"
                            >
                              <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>
                              <td className="px-4 py-2 font-mono text-xs text-muted-foreground" data-testid={`text-worker-code-${worker.id}`}>
                                {worker.employeeCode ?? "—"}
                              </td>
                              <td
                                className="px-4 py-2 font-medium"
                                dir="auto"
                                data-testid={`text-worker-name-${worker.id}`}
                              >
                                {worker.fullName}
                              </td>
                              <td className="px-4 py-2">
                                <Select
                                  value={status}
                                  onValueChange={(v) => setStatus(worker.id, v as AttendanceStatus)}
                                >
                                  <SelectTrigger
                                    data-testid={`select-status-${worker.id}`}
                                    className={`h-8 text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {STATUS_OPTIONS.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-4 py-2">
                                <Input
                                  data-testid={`input-notes-${worker.id}`}
                                  placeholder="Optional notes"
                                  value={notesMap[worker.id] ?? ""}
                                  onChange={(e) => setNotes(worker.id, e.target.value)}
                                  className="h-8 text-xs"
                                  dir="auto"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-2 p-3">
                    {workers.map((worker, idx) => {
                      const status = attendanceMap[worker.id] ?? "Present";
                      return (
                        <div
                          key={worker.id}
                          data-testid={`card-worker-${worker.id}`}
                          className="border rounded-md p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p
                                className="font-medium text-sm"
                                dir="auto"
                                data-testid={`text-worker-name-mobile-${worker.id}`}
                              >
                                {worker.fullName}
                              </p>
                              {worker.employeeCode && (
                                <span className="text-xs font-mono text-muted-foreground" data-testid={`text-worker-code-mobile-${worker.id}`}>
                                  {worker.employeeCode}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">{idx + 1}</span>
                          </div>
                          <Select
                            value={status}
                            onValueChange={(v) => setStatus(worker.id, v as AttendanceStatus)}
                          >
                            <SelectTrigger
                              data-testid={`select-status-mobile-${worker.id}`}
                              className={`h-9 text-sm font-medium ${STATUS_COLORS[status] ?? ""}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            data-testid={`input-notes-mobile-${worker.id}`}
                            placeholder="Notes (optional)"
                            value={notesMap[worker.id] ?? ""}
                            onChange={(e) => setNotes(worker.id, e.target.value)}
                            className="h-8 text-xs"
                            dir="auto"
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={printDialog !== null} onOpenChange={(open) => { if (!open) setPrintDialog(null); }}>
        <DialogContent className="max-w-xs" data-testid="dialog-print-language">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Languages className="h-4 w-4" />
              {printDialog?.startsWith("excel") ? "Choose Export Language" : "Choose Print Language"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={() => handlePrintWithLang("en")}
              data-testid="button-print-english"
            >
              English
            </Button>
            <Button
              variant="outline"
              onClick={() => handlePrintWithLang("ar")}
              data-testid="button-print-arabic"
              dir="rtl"
            >
              العربية
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rangePrintDialog !== null} onOpenChange={(open) => { if (!open) setRangePrintDialog(null); }}>
        <DialogContent className="max-w-xs" data-testid="dialog-range-language">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Languages className="h-4 w-4" />
              {rangePrintDialog === "excel" ? "Choose Export Language" : "Choose Print Language"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={() => handleRangeExport("en", rangePrintDialog!)}
              data-testid="button-range-english"
            >
              English
            </Button>
            <Button
              variant="outline"
              onClick={() => handleRangeExport("ar", rangePrintDialog!)}
              data-testid="button-range-arabic"
              dir="rtl"
            >
              العربية
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Per Worker View ────────────────────────────────────────────────────────────

function PerWorkerView() {
  const { toast } = useToast();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
  const [workerComboOpen, setWorkerComboOpen] = useState(false);
  const [startDate, setStartDate] = useState<string>(todayStr());
  const [endDate, setEndDate] = useState<string>(todayStr());
  const [checkedDates, setCheckedDates] = useState<Record<string, boolean>>({});

  const { data: workersList, isLoading: loadingWorkers } = useQuery<WorkerRow[]>({
    queryKey: ["/api/factory/workers?active=true"],
  });

  const workerIdNum = selectedWorkerId ? parseInt(selectedWorkerId) : null;

  const { data: attendanceRecords, isLoading: loadingAttendance } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/factory/attendance/worker", workerIdNum, startDate, endDate],
    queryFn: async () => {
      if (!workerIdNum) return [];
      const res = await fetch(
        `/api/factory/attendance/worker/${workerIdNum}?startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load attendance");
      return res.json();
    },
    enabled: !!workerIdNum && !!startDate && !!endDate,
  });

  // Pre-fill checkboxes from DB whenever records or date range changes.
  useEffect(() => {
    const dates = generateDateRange(startDate, endDate);
    const next: Record<string, boolean> = {};
    for (const d of dates) {
      // Sunday (getDay() === 0) defaults to Present; all other days default to Absent
      const isSunday = new Date(d + "T00:00:00").getDay() === 0;
      next[d] = isSunday;
    }
    if (attendanceRecords) {
      for (const r of attendanceRecords) {
        // Any status other than Absent counts as "present" (checked):
        // Present, Late, Half Day, Leave all = checked
        next[r.attendanceDate] = r.status !== "Absent";
      }
    }
    setCheckedDates(next);
  }, [attendanceRecords, startDate, endDate]);

  const dates = generateDateRange(startDate, endDate);
  const presentCount = Object.values(checkedDates).filter(Boolean).length;
  const absentCount = dates.length - presentCount;

  const toggleDate = (date: string) => {
    setCheckedDates((prev) => ({ ...prev, [date]: !prev[date] }));
  };

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    for (const d of dates) next[d] = true;
    setCheckedDates(next);
  };

  const deselectAll = () => {
    const next: Record<string, boolean> = {};
    for (const d of dates) next[d] = false;
    setCheckedDates(next);
  };

  const saveMutation = useMutation({
    mutationFn: (records: any[]) =>
      apiRequest("POST", "/api/factory/attendance/bulk", { records }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/attendance/worker", workerIdNum, startDate, endDate],
      });
      toast({ title: "Attendance saved", description: `${dates.length} days saved for this worker.` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!workerIdNum) return;
    // Build a map of existing DB statuses so we can preserve granular statuses
    // (Late, Half Day, Leave) for dates that are checked but not newly toggled.
    const existingStatusMap: Record<string, string> = {};
    if (attendanceRecords) {
      for (const r of attendanceRecords) {
        existingStatusMap[r.attendanceDate] = r.status;
      }
    }
    const records = dates.map((d) => {
      if (checkedDates[d]) {
        // Preserve existing granular status (Late, Half Day, Leave) if the date
        // is checked; fall back to "Present" for new/previously-absent dates.
        const existing = existingStatusMap[d];
        const status = existing && existing !== "Absent" ? existing : "Present";
        return { workerId: workerIdNum, attendanceDate: d, status };
      }
      return { workerId: workerIdNum, attendanceDate: d, status: "Absent" };
    });
    saveMutation.mutate(records);
  };

  const selectedWorker = (workersList ?? []).find((w) => w.id === workerIdNum);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Worker</Label>
              <Popover open={workerComboOpen} onOpenChange={setWorkerComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={workerComboOpen}
                    data-testid="select-worker"
                    className="w-56 justify-between font-normal"
                  >
                    <span className="truncate" dir="auto">
                      {selectedWorker
                        ? `${selectedWorker.fullName}${selectedWorker.employeeCode ? ` (${selectedWorker.employeeCode})` : ""}`
                        : loadingWorkers
                        ? "Loading…"
                        : "Select worker"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search worker…" data-testid="input-worker-search" />
                    <CommandList>
                      <CommandEmpty>No workers found.</CommandEmpty>
                      <CommandGroup>
                        {(workersList ?? []).map((w) => (
                          <CommandItem
                            key={w.id}
                            value={`${w.fullName} ${w.employeeCode ?? ""}`}
                            onSelect={() => {
                              setSelectedWorkerId(String(w.id));
                              setWorkerComboOpen(false);
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 shrink-0 ${selectedWorkerId === String(w.id) ? "opacity-100" : "opacity-0"}`}
                            />
                            <span dir="auto" className="truncate">
                              {w.fullName}
                              {w.employeeCode ? ` (${w.employeeCode})` : ""}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                data-testid="input-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                data-testid="input-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div className="flex gap-2 ml-auto items-center flex-wrap">
              <Button
                variant="outline"
                size="default"
                data-testid="button-select-all"
                onClick={selectAll}
                disabled={!workerIdNum || dates.length === 0}
              >
                <UserCheck className="h-4 w-4 mr-1" />
                Select All
              </Button>
              <Button
                variant="outline"
                size="default"
                data-testid="button-deselect-all"
                onClick={deselectAll}
                disabled={!workerIdNum || dates.length === 0}
              >
                <UserX className="h-4 w-4 mr-1" />
                Deselect All
              </Button>
              <Button
                size="default"
                data-testid="button-save-per-worker"
                onClick={handleSave}
                disabled={!workerIdNum || dates.length === 0 || saveMutation.isPending}
              >
                <Save className="h-4 w-4 mr-1" />
                {saveMutation.isPending ? "Saving…" : "Save Attendance"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {workerIdNum && dates.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard icon={<CalendarDays className="h-4 w-4" />} label="Days in Range" value={dates.length} color="text-foreground" testId="stat-pw-total" />
          <SummaryCard icon={<CheckCircle className="h-4 w-4" />} label="Present" value={presentCount} color="text-green-600 dark:text-green-400" testId="stat-pw-present" />
          <SummaryCard icon={<XCircle className="h-4 w-4" />} label="Absent" value={absentCount} color="text-red-600 dark:text-red-400" testId="stat-pw-absent" />
        </div>
      )}

      {/* Date checkbox table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            {selectedWorker ? selectedWorker.fullName : "Select a worker"}
            {selectedWorker?.employeeCode && (
              <Badge variant="secondary">{selectedWorker.employeeCode}</Badge>
            )}
          </CardTitle>
          {workerIdNum && dates.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {startDate} to {endDate}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!workerIdNum ? (
            <div className="text-center text-muted-foreground py-12 text-sm">
              Select a worker above to mark their attendance.
            </div>
          ) : loadingAttendance ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : dates.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">
              No dates in the selected range.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30 bg-muted/50">
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-8">#</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-24">Day</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-28">Present</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date, idx) => {
                    const dayName = new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
                    const isChecked = checkedDates[date] ?? false;
                    const isFriday = new Date(date + "T00:00:00").getDay() === 5;
                    const isSaturday = new Date(date + "T00:00:00").getDay() === 6;
                    const isSunday = new Date(date + "T00:00:00").getDay() === 0;
                    return (
                      <tr
                        key={date}
                        data-testid={`row-date-${date}`}
                        className={`border-b last:border-0 cursor-pointer hover-elevate ${(isFriday || isSaturday) ? "bg-muted/20" : isSunday ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}`}
                        onClick={() => toggleDate(date)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium">
                          {new Date(date + "T00:00:00").toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className={`px-4 py-3 text-sm ${(isFriday || isSaturday) ? "text-muted-foreground italic" : isSunday ? "text-blue-600 dark:text-blue-400 font-medium" : "text-muted-foreground"}`}>
                          {dayName}{isSunday ? " *" : ""}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              data-testid={`checkbox-date-${date}`}
                              checked={isChecked}
                              onCheckedChange={() => toggleDate(date)}
                            />
                            <span className={`text-xs font-medium ${isChecked ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                              {isChecked ? "Present" : "Absent"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  color,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center gap-3">
        <div className={`shrink-0 ${color}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`} data-testid={testId}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

type PrintLang = "en" | "ar";

interface WeekDay {
  dayName: string;
  dayNameAr: string;
  date: Date;
  iso: string;
  dayNum: number;
}

function getWeekDays(dateStr: string): WeekDay[] {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dow === 0 ? 7 : dow) - 1));
  const enNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const arNames = ["\u0627\u0644\u0627\u062B\u0646\u064A\u0646", "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621", "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621", "\u0627\u0644\u062E\u0645\u064A\u0633", "\u0627\u0644\u062C\u0645\u0639\u0629", "\u0627\u0644\u0633\u0628\u062A"];
  const days: WeekDay[] = [];
  for (let i = 0; i < 6; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    days.push({
      dayName: enNames[i],
      dayNameAr: arNames[i],
      date: cur,
      iso: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
      dayNum: cur.getDate(),
    });
  }
  return days;
}

const LABELS = {
  en: {
    title: "Weekly Attendance Sheet",
    resultTitle: "Weekly Attendance Report",
    workerName: "Worker Name",
    notes: "Notes / Signature",
    preparedBy: "Prepared By",
    supervisor: "Supervisor",
    approvedBy: "Approved By",
    totalWorkers: "Total Workers",
    week: "Week",
    shift: "Shift",
    present: "P = Present",
    absent: "A = Absent",
    mark: "Mark P / A or \u2713 / \u2717 in each cell",
  },
  ar: {
    title: "\u0643\u0634\u0641 \u0627\u0644\u062D\u0636\u0648\u0631 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064A",
    resultTitle: "\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u062D\u0636\u0648\u0631 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064A",
    workerName: "\u0627\u0633\u0645 \u0627\u0644\u0639\u0627\u0645\u0644",
    notes: "\u0645\u0644\u0627\u062D\u0638\u0627\u062A / \u062A\u0648\u0642\u064A\u0639",
    preparedBy: "\u0623\u0639\u062F\u0647",
    supervisor: "\u0627\u0644\u0645\u0634\u0631\u0641",
    approvedBy: "\u0627\u0639\u062A\u0645\u062F\u0647",
    totalWorkers: "\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0639\u0645\u0627\u0644",
    week: "\u0627\u0644\u0623\u0633\u0628\u0648\u0639",
    shift: "\u0627\u0644\u0648\u0631\u062F\u064A\u0629",
    present: "\u062D = \u062D\u0627\u0636\u0631",
    absent: "\u063A = \u063A\u0627\u0626\u0628",
    mark: "\u0636\u0639 \u062D / \u063A \u0623\u0648 \u2713 / \u2717 \u0641\u064A \u0643\u0644 \u062E\u0627\u0646\u0629",
  },
} as const;

function weekLabel(weekDays: WeekDay[]): string {
  const first = weekDays[0].date;
  const last = weekDays[weekDays.length - 1].date;
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(first)} \u2013 ${fmt(last)}, ${last.getFullYear()}`;
}

const WEEKLY_CSS = `
  @page { size: A4 landscape; margin: 10mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, 'Noto Sans Arabic', sans-serif; font-size: 7.5pt; color: #111; margin: 0; }
  h1 { font-size: 13pt; text-align: center; margin: 0 0 2px; }
  .subtitle { text-align: center; font-size: 8pt; color: #555; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  col.col-num   { width: 3%; }
  col.col-name  { width: 22%; }
  col.col-day   { width: 10%; }
  col.col-notes { width: 13%; }
  th { background: #e8e8e8; border: 1px solid #aaa; padding: 3px 2px; font-size: 7pt; text-align: center; white-space: nowrap; overflow: hidden; }
  th.name-col { text-align: left; }
  td { border: 1px solid #ccc; padding: 2px 3px; font-size: 7.5pt; vertical-align: middle; height: 17px; }
  td.num { text-align: center; color: #888; }
  td.name { text-align: left; unicode-bidi: plaintext; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.day { text-align: center; }
  td.notes { font-size: 7pt; }
  tr:nth-child(even) td { background: #f7f7f7; }
  .legend { margin-top: 6px; font-size: 7pt; color: #555; text-align: center; }
  .legend span { margin: 0 10px; }
  .footer { margin-top: 12px; display: flex; justify-content: space-between; font-size: 7.5pt; }
  .footer div { border-top: 1px solid #333; padding-top: 3px; width: 120px; text-align: center; }
  @media print { button { display: none; } }
`;

const WEEKLY_COLGROUP = `
  <colgroup>
    <col class="col-num">
    <col class="col-name">
    <col class="col-day"><col class="col-day"><col class="col-day">
    <col class="col-day"><col class="col-day"><col class="col-day">
    <col class="col-notes">
  </colgroup>
`;

function generateWeeklyBlankSheetHtml(
  workers: WorkerRow[],
  weekDays: WeekDay[],
  shift: string,
  lang: PrintLang
) {
  const L = LABELS[lang];
  const dayHeaders = weekDays.map((d) => {
    const name = lang === "ar" ? d.dayNameAr : d.dayName;
    return `<th>${name}<br/>${d.dayNum}</th>`;
  }).join("");

  const rows = workers.map((w, i) => {
    const dayCells = weekDays.map(() => `<td class="day"></td>`).join("");
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="name" dir="auto">${escHtml(w.fullName)}</td>
      ${dayCells}
      <td class="notes"></td>
    </tr>`;
  }).join("");

  const htmlLang = lang === "ar" ? "ar" : "en";

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>${L.title}</title>
  <style>
    ${WEEKLY_CSS}
  </style>
</head>
<body>
  <h1>${L.title}</h1>
  <div class="subtitle">
    ${L.week}: <strong>${weekLabel(weekDays)}</strong>
    ${shift ? `&nbsp;&nbsp;|&nbsp;&nbsp; ${L.shift}: <strong>${escHtml(shift)}</strong>` : ""}
    &nbsp;&nbsp;|&nbsp;&nbsp; ${L.totalWorkers}: <strong>${workers.length}</strong>
  </div>
  <table>
    ${WEEKLY_COLGROUP}
    <thead className="sticky top-0 z-30 bg-muted/50">
      <tr>
        <th>#</th>
        <th class="name-col">${L.workerName}</th>
        ${dayHeaders}
        <th>${L.notes}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="legend">
    <span><strong>${lang === "ar" ? "\u062D" : "P"}</strong> = ${lang === "ar" ? "\u062D\u0627\u0636\u0631" : "Present"}</span>
    <span><strong>${lang === "ar" ? "\u063A" : "A"}</strong> = ${lang === "ar" ? "\u063A\u0627\u0626\u0628" : "Absent"}</span>
    <span>${L.mark}</span>
  </div>
  <div class="footer">
    <div>${L.preparedBy}</div>
    <div>${L.supervisor}</div>
    <div>${L.approvedBy}</div>
  </div>
</body>
</html>`;
}

const STATUS_PRINT_COLORS: Record<string, string> = {
  Present: "#15803d",
  Absent: "#b91c1c",
  Late: "#b45309",
  "Half Day": "#1d4ed8",
  Leave: "#7e22ce",
};

const STATUS_MARKS: Record<string, string> = {
  Present: "\u2713",
  Absent: "\u2717",
  Late: "L",
  "Half Day": "\u00BD",
  Leave: "\u2014",
};

function generateWeeklyResultsSheetHtml(
  workers: WorkerRow[],
  attendanceMap: Record<number, AttendanceStatus>,
  notesMap: Record<number, string>,
  weekDays: WeekDay[],
  selectedDate: string,
  shift: string,
  lang: PrintLang
) {
  const L = LABELS[lang];

  const dayHeaders = weekDays.map((d) => {
    const name = lang === "ar" ? d.dayNameAr : d.dayName;
    const isSelected = d.iso === selectedDate;
    const bg = isSelected ? " style=\"background:#d0e0f0\"" : "";
    return `<th${bg}>${name}<br/>${d.dayNum}</th>`;
  }).join("");

  const present = workers.filter((w) => (attendanceMap[w.id] ?? "Present") === "Present").length;
  const absent = workers.filter((w) => attendanceMap[w.id] === "Absent").length;

  const rows = workers.map((w, i) => {
    const status = attendanceMap[w.id] ?? "Present";
    const color = STATUS_PRINT_COLORS[status] ?? "#374151";
    const mark = STATUS_MARKS[status] ?? status.charAt(0);
    const notes = escHtml(notesMap[w.id] ?? "");

    const dayCells = weekDays.map((d) => {
      if (d.iso === selectedDate) {
        return `<td class="day" style="font-weight:700;color:${color};font-size:9pt">${mark}</td>`;
      }
      return `<td class="day"></td>`;
    }).join("");

    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="name" dir="auto">${escHtml(w.fullName)}</td>
      ${dayCells}
      <td class="notes" style="color:#555">${notes}</td>
    </tr>`;
  }).join("");

  const htmlLang = lang === "ar" ? "ar" : "en";

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>${L.resultTitle}</title>
  <style>
    ${WEEKLY_CSS}
    .summary { display:flex; gap:20px; justify-content:center; margin-bottom:6px; font-size:8pt; }
    .summary span { font-weight:600; }
  </style>
</head>
<body>
  <h1>${L.resultTitle}</h1>
  <div class="subtitle">
    ${L.week}: <strong>${weekLabel(weekDays)}</strong>
    ${shift ? `&nbsp;&nbsp;|&nbsp;&nbsp; ${L.shift}: <strong>${escHtml(shift)}</strong>` : ""}
  </div>
  <div class="summary">
    <div>${L.totalWorkers}: <span>${workers.length}</span></div>
    <div>${lang === "ar" ? "\u062D\u0627\u0636\u0631" : "Present"}: <span style="color:#15803d">${present}</span></div>
    <div>${lang === "ar" ? "\u063A\u0627\u0626\u0628" : "Absent"}: <span style="color:#b91c1c">${absent}</span></div>
  </div>
  <table>
    ${WEEKLY_COLGROUP}
    <thead className="sticky top-0 z-30 bg-muted/50">
      <tr>
        <th>#</th>
        <th class="name-col">${L.workerName}</th>
        ${dayHeaders}
        <th>${L.notes}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="legend">
    <span><strong>${lang === "ar" ? "\u062D" : "P"}</strong> = ${lang === "ar" ? "\u062D\u0627\u0636\u0631" : "Present"}</span>
    <span><strong>${lang === "ar" ? "\u063A" : "A"}</strong> = ${lang === "ar" ? "\u063A\u0627\u0626\u0628" : "Absent"}</span>
  </div>
  <div class="footer">
    <div>${L.preparedBy}</div>
    <div>${L.supervisor}</div>
    <div>${L.approvedBy}</div>
  </div>
</body>
</html>`;
}

function buildWeeklySheet(
  workers: WorkerRow[],
  weekDays: WeekDay[],
  shift: string,
  lang: PrintLang,
  type: "blank" | "results",
  attendanceMap: Record<number, AttendanceStatus>,
  notesMap: Record<number, string>,
  selectedDate: string,
  sheetLabel: string
) {
  const L = LABELS[lang];
  const dayColHeaders = weekDays.map((d) =>
    `${lang === "ar" ? d.dayNameAr : d.dayName} ${d.dayNum}`
  );
  const headers = ["#", L.workerName, ...dayColHeaders, L.notes];

  const dataRows = workers.map((w, i) => {
    const dayCells = weekDays.map((d) => {
      if (type === "results" && d.iso === selectedDate) {
        const s = attendanceMap[w.id] ?? "Present";
        return STATUS_MARKS[s] ?? s.charAt(0);
      }
      return "";
    });
    const notes = type === "results" ? (notesMap[w.id] ?? "") : "";
    return [i + 1, w.fullName, ...dayCells, notes];
  });

  const totalCols = 2 + weekDays.length + 1;
  const colWidths = [
    { wch: 4 },
    { wch: 30 },
    ...weekDays.map(() => ({ wch: 10 })),
    { wch: 22 },
  ];

  const subtitle = `${sheetLabel}  |  ${L.week}: ${weekLabel(weekDays)}${shift ? `  |  ${L.shift}: ${shift}` : ""}  |  ${L.totalWorkers}: ${workers.length}`;
  const allRows = [[L.title], [subtitle], headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  ws["!cols"] = colWidths;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
  ];
  return ws;
}

async function exportWeeklyExcel(
  workers: WorkerRow[],
  weekDays: WeekDay[],
  shift: string,
  lang: PrintLang,
  type: "blank" | "results",
  attendanceMap: Record<number, AttendanceStatus>,
  notesMap: Record<number, string>,
  selectedDate: string
) {
  const wb = XLSX.utils.book_new();

  const activeWorkers   = workers.filter((w) => w.active !== false);
  const inactiveWorkers = workers.filter((w) => w.active === false);

  const activeSheet = buildWeeklySheet(activeWorkers, weekDays, shift, lang, type, attendanceMap, notesMap, selectedDate, lang === "ar" ? "العمال النشطون" : "Active Workers");
  XLSX.utils.book_append_sheet(wb, activeSheet, lang === "ar" ? "نشط" : "Active Workers");

  const inactiveSheet = buildWeeklySheet(inactiveWorkers, weekDays, shift, lang, type, {}, {}, selectedDate, lang === "ar" ? "العمال غير النشطين" : "Inactive Workers");
  XLSX.utils.book_append_sheet(wb, inactiveSheet, lang === "ar" ? "غير نشط" : "Inactive Workers");

  const weekRange = weekLabel(weekDays).replace(/[^a-z0-9]/gi, "-");
  await XLSX.writeFile(wb, `attendance-${type}-${weekRange}.xlsx`);
}

function buildRangeSheet(
  workers: WorkerRow[],
  lookup: Map<number, Map<string, string>>,
  dates: string[],
  startDate: string,
  endDate: string,
  lang: PrintLang,
  sheetTitle: string,
  useBlankDefault = false   // true for inactive workers: no record = blank cell, not Present
) {
  const dateHeaders = dates.map((d) => {
    const dt = new Date(d + "T00:00:00");
    const day = dt.getDate();
    const weekday = dt.toLocaleDateString(lang === "ar" ? "ar" : "en-US", { weekday: "short" });
    return `${day}\n${weekday}`;
  });

  const workerLabel = lang === "ar" ? "اسم العامل" : "Worker Name";
  const totalPLabel = lang === "ar" ? "الحضور" : "Present";
  const totalALabel = lang === "ar" ? "الغياب" : "Absent";
  const rangeLabel  = `${startDate}  →  ${endDate}  |  ${sheetTitle}  |  ${lang === "ar" ? "العمال" : "Workers"}: ${workers.length}`;

  const headers  = ["#", workerLabel, ...dateHeaders, totalPLabel, totalALabel];
  const dataRows = workers.map((w, i) => {
    const wMap = lookup.get(w.id) ?? new Map();
    let presentCount = 0;
    let absentCount  = 0;
    const dayCells = dates.map((d) => {
      const recorded = wMap.get(d);
      // Inactive workers: if no explicit record exists, leave cell blank.
      const status = recorded ?? (useBlankDefault ? null : "Present");
      if (!status) return "";          // blank cell for inactive with no record
      const mark = STATUS_MARKS[status] ?? status.charAt(0);
      if (status === "Absent") absentCount++;
      else presentCount++;
      return mark;
    });
    return [i + 1, w.fullName, ...dayCells, presentCount || "", absentCount || ""];
  });

  const titleLabel = lang === "ar" ? "كشف الحضور" : "Attendance Sheet";
  const totalCols  = 2 + dates.length + 2;
  const allRows = [[titleLabel], [rangeLabel], headers, ...dataRows];

  const ws = XLSX.utils.aoa_to_sheet(allRows);
  ws["!cols"] = [
    { wch: 4 },
    { wch: 28 },
    ...dates.map(() => ({ wch: 6 })),
    { wch: 9 },
    { wch: 9 },
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
  ];
  return ws;
}

async function exportRangeExcel(
  workers: WorkerRow[],
  attendance: AttendanceRecord[],
  dates: string[],
  startDate: string,
  endDate: string,
  lang: PrintLang
) {
  const wb = XLSX.utils.book_new();

  // Build lookup: workerId -> date -> status
  const lookup = new Map<number, Map<string, string>>();
  for (const r of attendance) {
    if (!lookup.has(r.workerId)) lookup.set(r.workerId, new Map());
    lookup.get(r.workerId)!.set(r.attendanceDate, r.status);
  }

  const activeWorkers   = workers.filter((w) => w.active !== false);
  const inactiveWorkers = workers.filter((w) => w.active === false);

  const activeLabel   = lang === "ar" ? "العمال النشطون"      : "Active Workers";
  const inactiveLabel = lang === "ar" ? "العمال غير النشطين" : "Inactive Workers";

  const activeSheet   = buildRangeSheet(activeWorkers,   lookup, dates, startDate, endDate, lang, activeLabel, false);
  const inactiveSheet = buildRangeSheet(inactiveWorkers, lookup, dates, startDate, endDate, lang, inactiveLabel, true);

  XLSX.utils.book_append_sheet(wb, activeSheet,   lang === "ar" ? "نشط"      : "Active Workers");
  XLSX.utils.book_append_sheet(wb, inactiveSheet, lang === "ar" ? "غير نشط" : "Inactive Workers");

  await XLSX.writeFile(wb, `attendance-range-${startDate}-to-${endDate}.xlsx`);
}

function generateRangePrintHtml(
  workers: WorkerRow[],
  attendance: AttendanceRecord[],
  dates: string[],
  startDate: string,
  endDate: string,
  lang: PrintLang
) {
  const lookup = new Map<number, Map<string, string>>();
  for (const r of attendance) {
    if (!lookup.has(r.workerId)) lookup.set(r.workerId, new Map());
    lookup.get(r.workerId)!.set(r.attendanceDate, r.status);
  }

  const titleLabel = lang === "ar" ? "كشف الحضور" : "Attendance Sheet";
  const workerLabel = lang === "ar" ? "اسم العامل" : "Worker Name";
  const totalPLabel = lang === "ar" ? "حضور" : "P";
  const totalALabel = lang === "ar" ? "غياب" : "A";

  const dateHeaders = dates.map((d) => {
    const dt = new Date(d + "T00:00:00");
    const day = dt.getDate();
    const weekday = dt.toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "short" });
    const isFri = dt.getDay() === 5;
    const isSat = dt.getDay() === 6;
    const bg = (isFri || isSat) ? ' style="background:#f0f0f0"' : '';
    return `<th${bg}>${day}<br/><span style="font-size:6pt;color:#777">${weekday}</span></th>`;
  }).join("");

  const rows = workers.map((w, i) => {
    const wMap = lookup.get(w.id) ?? new Map();
    let presentCount = 0, absentCount = 0;
    const dayCells = dates.map((d) => {
      const dt = new Date(d + "T00:00:00");
      const isFri = dt.getDay() === 5;
      const isSat = dt.getDay() === 6;
      const status = wMap.get(d) ?? "Present";
      const mark = STATUS_MARKS[status] ?? status.charAt(0);
      const color = STATUS_PRINT_COLORS[status] ?? "#374151";
      if (status === "Absent") absentCount++; else presentCount++;
      const bgStyle = (isFri || isSat) ? "background:#f7f7f7;" : "";
      return `<td class="day" style="${bgStyle}color:${color};font-weight:600">${mark}</td>`;
    }).join("");
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="name" dir="auto">${escHtml(w.fullName)}</td>
      ${dayCells}
      <td class="day" style="color:#15803d;font-weight:700">${presentCount}</td>
      <td class="day" style="color:#b91c1c;font-weight:700">${absentCount}</td>
    </tr>`;
  }).join("");

  const htmlLang = lang === "ar" ? "ar" : "en";
  const colCount = 2 + dates.length + 2;
  const dateColWidth = Math.max(3, Math.floor(70 / dates.length));

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>${titleLabel}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, 'Noto Sans Arabic', sans-serif; font-size: 7pt; color: #111; margin: 0; }
    h1 { font-size: 12pt; text-align: center; margin: 0 0 2px; }
    .subtitle { text-align: center; font-size: 8pt; color: #555; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
    th { background: #e8e8e8; border: 1px solid #aaa; padding: 2px 1px; font-size: 6.5pt; text-align: center; white-space: nowrap; overflow: hidden; }
    th.name-col { text-align: left; width: 18%; }
    th.num-col { width: 3%; }
    th.total-col { width: ${dateColWidth + 2}%; background: #dde8f0; }
    td { border: 1px solid #ccc; padding: 1px 2px; vertical-align: middle; height: 15px; }
    td.num { text-align: center; color: #888; width: 3%; }
    td.name { text-align: left; unicode-bidi: plaintext; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 18%; }
    td.day { text-align: center; width: ${dateColWidth}%; }
    tr:nth-child(even) td { background: #f9f9f9; }
    .legend { margin-top: 5px; font-size: 6.5pt; color: #555; text-align: center; }
    .legend span { margin: 0 8px; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <h1>${titleLabel}</h1>
  <div class="subtitle">${startDate} &ndash; ${endDate} &nbsp;|&nbsp; ${workers.length} ${lang === "ar" ? "عامل" : "workers"}</div>
  <table>
    <thead>
      <tr>
        <th class="num-col">#</th>
        <th class="name-col">${workerLabel}</th>
        ${dateHeaders}
        <th class="total-col">${totalPLabel}</th>
        <th class="total-col">${totalALabel}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="legend">
    <span><strong>&#10003;</strong> = ${lang === "ar" ? "حاضر" : "Present"}</span>
    <span><strong>&#10007;</strong> = ${lang === "ar" ? "غائب" : "Absent"}</span>
    <span><strong>L</strong> = ${lang === "ar" ? "متأخر" : "Late"}</span>
    <span><strong>&frac12;</strong> = ${lang === "ar" ? "نصف يوم" : "Half Day"}</span>
    <span><strong>&mdash;</strong> = ${lang === "ar" ? "إجازة" : "Leave"}</span>
  </div>
</body>
</html>`;
}

function escHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
